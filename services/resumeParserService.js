// services/resumeParserService.js
// Service to extract text from various resume file formats (PDF, DOCX, TXT)

import fs from "fs";
import path from "path";
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

    extractedText = String(extractedText || "")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    if (!extractedText) {
      throw new Error("No readable text found in resume");
    }

    return extractedText;
  } catch (error) {
    console.error("Error parsing resume:", error);
    throw new Error(`Failed to parse resume file: ${error.message}`);
  }
}

export { extractTextFromResume };
