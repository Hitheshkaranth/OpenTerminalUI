export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), filename);
}

/** Preserve server bytes for integrity-hashed exports (JSON parse/stringify changes numbers). */
export function downloadBlob(value: Blob, filename: string): void {
  const url = URL.createObjectURL(value);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
