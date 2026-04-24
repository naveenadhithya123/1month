export function chunkText(text, chunkSize = 900, overlap = 180) {
  if (!text?.trim()) {
    return [];
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const content = normalized.slice(start, end).trim();

    if (content) {
      chunks.push({ content });
    }

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - overlap, 0);
  }

  return chunks;
}
