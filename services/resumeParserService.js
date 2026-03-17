// services/resumeParserService.js
// Service to extract text from various resume file formats (PDF, DOCX, TXT)

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParseImport = require("pdf-parse");
const pdfParse =
  pdfParseImport && pdfParseImport.default
    ? pdfParseImport.default
    : pdfParseImport;
const mammoth = require("mammoth");

function resolveMimeType(file) {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (mimeType && mimeType !== "application/octet-stream") {
    return mimeType;
  }

  const ext = path.extname(file?.originalname || "").toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".doc") return "application/msword";
  if (ext === ".txt") return "text/plain";

  return mimeType;
}

function normalizeExtractedText(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw.text === "string") return raw.text;
  if (raw.text && typeof raw.text.text === "string") return raw.text.text;
  if (raw.text && Array.isArray(raw.text.pages)) {
    return raw.text.pages
      .map((page) => (page && page.text ? page.text : ""))
      .join("\n");
  }
  if (Array.isArray(raw)) return raw.join("\n");
  return String(raw);
}

async function extractPdfText(buffer) {
  if (typeof pdfParse === "function") {
    const parsed = await pdfParse(buffer);
    return normalizeExtractedText(parsed);
  }

  if (pdfParse && pdfParse.PDFParse) {
    const PDFParse = pdfParse.PDFParse;
    const parser = new PDFParse(new Uint8Array(buffer));
    await parser.load();
    const parsedText = await parser.getText();
    return normalizeExtractedText(parsedText);
  }

  throw new Error("Unsupported pdf-parse API shape");
}

function ensureBuffer(file) {
  if (file?.buffer && Buffer.isBuffer(file.buffer)) {
    return file.buffer;
  }
  if (file?.path) {
    return fs.readFileSync(file.path);
  }
  return null;
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

  const mimeType = resolveMimeType(file);
  const buffer = ensureBuffer(file);

  if (!buffer) {
    throw new Error("Resume file buffer could not be read");
  }

  try {
    let extractedText = "";

    if (mimeType === "application/pdf") {
      extractedText = await extractPdfText(buffer);
    } else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (mimeType === "text/plain") {
      extractedText = buffer.toString("utf8");
    } else {
      throw new Error(
        `Unsupported file type: ${mimeType}. Please upload PDF, DOCX, or TXT.`,
      );
    }

    extractedText = String(extractedText || "")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    if (!extractedText) {
      throw new Error("No readable text found in resume");
    }

    return extractedText;
  } catch (error) {
    console.error("Error parsing resume:", error);
    throw new Error(error?.message || "Failed to parse resume file");
  }
}

export { extractTextFromResume };
