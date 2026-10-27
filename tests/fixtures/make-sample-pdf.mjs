// One-off generator for tests/fixtures/sample.pdf (run with: node tests/fixtures/make-sample-pdf.mjs)
// Builds a minimal but spec-correct one-page PDF with real xref offsets.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const lines = [
  "Jane Doe",
  "Frontend Engineer",
  "Skills: JavaScript, React, Node.js",
  "Experience: 5 years building web apps.",
];

const content = [
  "BT",
  "/F1 12 Tf",
  "72 720 Td",
  `(${lines[0]}) Tj`,
  ...lines.slice(1).map((l) => `0 -18 Td (${l}) Tj`),
  "ET",
].join("\n");

const objects = {
  1: `<< /Type /Catalog /Pages 2 0 R >>`,
  2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
  3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
  4: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  5: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
};

let pdf = "%PDF-1.4\n";
const offsets = {};
for (const [num, body] of Object.entries(objects)) {
  offsets[num] = Buffer.byteLength(pdf, "latin1");
  pdf += `${num} 0 obj\n${body}\nendobj\n`;
}

const xrefOffset = Buffer.byteLength(pdf, "latin1");
const count = Object.keys(objects).length + 1;
pdf += `xref\n0 ${count}\n`;
pdf += "0000000000 65535 f\r\n";
for (let i = 1; i < count; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n\r\n`;
}
pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

const target = join(dirname(fileURLToPath(import.meta.url)), "sample.pdf");
writeFileSync(target, Buffer.from(pdf, "latin1"));
console.log(`wrote ${target} (${Buffer.byteLength(pdf, "latin1")} bytes)`);
