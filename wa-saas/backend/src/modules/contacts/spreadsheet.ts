import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export interface Sheet { headers: string[]; rows: Record<string, string>[] }

export const MAX_IMPORT_ROWS = 100_000;

export async function parseSheet(buf: Buffer, mime: string, maxRows = MAX_IMPORT_ROWS): Promise<Sheet> {
  if (mime === 'text/csv') {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', preview: maxRows, transformHeader: (h) => h.trim() });
    return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = String(cell.text ?? '').trim(); });
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, idx) => {
    if (idx === 1 || rows.length >= maxRows) return;
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) r[h] = String(row.getCell(i + 1).text ?? '').trim(); });
    if (Object.values(r).some((v) => v)) rows.push(r);
  });
  return { headers: headers.filter(Boolean), rows };
}

/** Prevents CSV formula injection when users open exports in spreadsheet apps. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
