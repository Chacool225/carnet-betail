/**
 * Export CSV pour Excel : séparateur « ; », fin de ligne CRLF, BOM UTF-8 (accents corrects).
 * Une cellule de texte qui commence par = + - @ ou une tabulation est préfixée d'une apostrophe :
 * sans cela, Excel l'exécuterait comme une formule (injection CSV).
 */
export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = typeof v === 'boolean' ? (v ? 'oui' : 'non') : v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
