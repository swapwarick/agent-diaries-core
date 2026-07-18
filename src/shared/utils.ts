export function normalizeSignature(title: string): string {
  return (title || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function computeSignature(
  title: string,
  hashFn?: (title: string) => string,
): string {
  return hashFn ? hashFn(title) : normalizeSignature(title);
}
