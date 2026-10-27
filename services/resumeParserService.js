// services/resumeParserService.js
// Service to extract text from various resume file formats (PDF, DOCX, TXT)

import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function ensureBuffer(file) {
  if (file?.buffer && Buffer.isBuffer(file.buffer)) {
    return file.buffer;
  }
  if (file?.path) {
    return fs.readFileSync(file.path);
  }
  return null;
}

// ── Magic-byte validation ────────────────────────────────────────────────────
// The client-supplied mimetype is NOT trusted: the actual bytes must match
// the declared type before we hand the file to a parser.

const PDF_MAGIC = Buffer.from("%PDF");

function looksLikePdf(buffer) {
  // PDF spec: the header must appear within the first 1024 bytes.
  return buffer.subarray(0, 1024).includes(PDF_MAGIC);
}

function looksLikeZip(buffer) {
  // DOCX is a ZIP container: starts with "PK" (0x50 0x4B).
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function looksLikeOle(buffer) {
  // Legacy .doc: OLE2 compound file magic D0 CF 11 E0 A1 B1 1A E1.
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1
  );
}

/**
 * Validate that the uploaded file's bytes match its declared mimetype.
 * @param {Object} file multer-style file ({ buffer, mimetype, ... })
 * @returns {{ ok: boolean, message?: string }}
 */
function validateResumeFileMagic(file) {
  const buffer = ensureBuffer(file);
  const mimetype = String(file?.mimetype || "");

  if (!buffer || buffer.length === 0) {
    return { ok: false, message: "Resume file is empty" };
  }

  if (mimetype === "application/pdf") {
    return looksLikePdf(buffer)
      ? { ok: true }
      : { ok: false, message: "File content does not match the declared PDF type (missing %PDF header)" };
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return looksLikeZip(buffer)
      ? { ok: true }
      : { ok: false, message: "File content does not match the declared DOCX type (missing PK zip header)" };
  }

  if (mimetype === "application/msword") {
    // Accept a real .doc (OLE2) or a docx that clients often mislabel.
    return looksLikeOle(buffer) || looksLikeZip(buffer)
      ? { ok: true }
      : { ok: false, message: "File content does not match the declared Word type" };
  }

  if (mimetype === "text/plain") {
    if (looksLikePdf(buffer) || looksLikeZip(buffer) || looksLikeOle(buffer)) {
      return { ok: false, message: "File is declared as text/plain but contains binary document data" };
    }
    if (buffer.subarray(0, 4096).includes(0)) {
      return { ok: false, message: "File is declared as text/plain but contains binary data" };
    }
    return { ok: true };
  }

  return {
    ok: false,
    message: `Unsupported file type: ${mimetype || "unknown"}. Please upload PDF, DOCX, or TXT.`,
  };
}

/**
 * Parses a resume file and extracts its text content.
 * Supports .pdf, .docx, and .txt files.
 *
 * @param {Object} file - The uploaded file object (from multer)
 * @returns {Promise<string>} The extracted text
 */
async function extractTextFromResume(file) {
  if (!file) {
    throw new Error("No file provided for parsing");
  }

  const mimeType = file.mimetype;
  const buffer = ensureBuffer(file);

  if (!buffer) {
    throw new Error("Resume file buffer could not be read");
  }

  try {
    let extractedText = "";

    if (mimeType === "application/pdf") {
      try {
        const pdfParseModule = require("pdf-parse");
        const PDFParseClass = pdfParseModule?.PDFParse;
        const pdfParseFn =
          typeof pdfParseModule === "function" ? pdfParseModule : null;

        if (pdfParseFn) {
          const data = await pdfParseFn(buffer);
          extractedText = data?.text || "";
        } else if (typeof PDFParseClass === "function") {
          const parser = new PDFParseClass({ data: buffer });
          try {
            const data = await parser.getText();
            extractedText = data?.text || "";
          } finally {
            if (typeof parser.destroy === "function") {
              await parser.destroy();
            }
          }
        } else {
          throw new Error("pdf-parse export is unsupported in current runtime");
        }
      } catch (err) {
        console.error(
          "pdf-parse failed to load or run:",
          err && err.message ? err.message : err,
        );
        throw new Error("PDF parsing is unavailable in this environment");
      }
    } else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      try {
        const mammoth = require("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } catch (err) {
        console.error(
          "mammoth failed to load or run:",
          err && err.message ? err.message : err,
        );
        throw new Error("DOCX parsing is unavailable in this environment");
      }
    } else if (mimeType === "text/plain") {
      extractedText = buffer.toString("utf8");
    } else {
      throw new Error(
        `Unsupported file type: ${mimeType}. Please upload PDF, DOCX, or TXT.`,
      );
    }

    extractedText = extractedText.replace(/\n\s*\n/g, "\n\n").trim();

    return extractedText;
  } catch (error) {
    console.error("Error parsing resume:", error);
    throw new Error(`Failed to parse resume file: ${error.message}`);
  }
}

export { extractTextFromResume, validateResumeFileMagic };
