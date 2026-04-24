const OCR_SPACE_ENDPOINT = "https://api.ocr.space/parse/image";
const OCR_SPACE_SOFT_LIMIT_BYTES = 1024 * 1024;

function getOcrApiKey() {
  return process.env.OCR_SPACE_API_KEY || "helloworld";
}

function parseOcrResponse(payload) {
  if (!payload) {
    return "";
  }

  if (payload.IsErroredOnProcessing) {
    const message = Array.isArray(payload.ErrorMessage)
      ? payload.ErrorMessage.join(", ")
      : payload.ErrorMessage || payload.ErrorDetails;
    throw new Error(message || "OCR processing failed.");
  }

  const results = payload.ParsedResults || [];
  return results
    .map((item) => item?.ParsedText || "")
    .join("\n")
    .trim();
}

export async function extractTextFromUrl(fileUrl, filetype = "PDF") {
  const formData = new FormData();
  formData.append("url", fileUrl);
  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");
  formData.append("scale", "true");
  formData.append("OCREngine", "2");
  formData.append("filetype", filetype);

  const response = await fetch(OCR_SPACE_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: getOcrApiKey(),
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OCR.space request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return parseOcrResponse(payload);
}

export async function extractTextFromBuffer(
  buffer,
  filename = "upload.pdf",
  mimeType = "application/pdf",
) {
  if (!buffer || buffer.length > OCR_SPACE_SOFT_LIMIT_BYTES) {
    throw new Error("OCR skipped for this large file.");
  }

  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });

  formData.append("file", blob, filename);
  formData.append("language", "eng");
  formData.append("isOverlayRequired", "false");
  formData.append("scale", "true");
  formData.append("OCREngine", "2");

  const response = await fetch(OCR_SPACE_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: getOcrApiKey(),
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`OCR.space upload request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return parseOcrResponse(payload);
}
