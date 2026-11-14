/** TSV clipboard output is a spreadsheet import too. Keep text from becoming
 * formulas or extra rows/columns when the user pastes research/export data.
 */
export function spreadsheetTextLiteral(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const literal = typeof value === "string" && (/^[ \t\r\n]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) ? `'${text}` : text;
  return literal;
}

export function spreadsheetClipboardCell(value: unknown): string {
  return spreadsheetTextLiteral(value).replace(/[\t\r\n]+/g, " ");
}
