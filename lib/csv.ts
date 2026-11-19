/**
 * CSV export helpers shared by the dashboard.
 *
 * Every cell is quoted, quotes are doubled, and a cell that a spreadsheet
 * would run as a formula (= + - @, tab, carriage return) is prefixed with a
 * single quote, so a customer or product name can never execute in Excel.
 * The file starts with a UTF-8 BOM so GH₵ and accented names open correctly.
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  const plainNumber = /^-?\d+(\.\d+)?$/.test(text);
  if (!plainNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

/** Money as a plain 2-decimal number (no currency sign) so spreadsheets can sum it. */
export function csvMoney(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
