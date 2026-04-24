import pdfParse from "pdf-parse";

export async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return data.text?.trim() || "";
}
