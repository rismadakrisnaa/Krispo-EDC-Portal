/**
 * Semua akses Excel lewat file ini. Library `xlsx` di-load saat dibutuhkan saja
 * (dynamic import) supaya tidak membebani bundle awal.
 */
const loadXlsx = () => import('xlsx');

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export type Row = Record<string, unknown>;

/** Baca sheet pertama dari file Excel menjadi array baris. */
export async function readExcel(file: File): Promise<Row[]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Ukuran file melebihi 10 MB.');
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('File tidak memiliki sheet.');
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });
  if (rows.length === 0) throw new Error('Sheet kosong. Isi data mulai baris kedua sesuai template.');
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Maksimal ${MAX_IMPORT_ROWS} baris per import. File ini berisi ${rows.length} baris.`);
  return rows;
}

/** Tulis array objek ke file Excel dan langsung diunduh. */
export async function writeExcel(rows: Row[], sheetName: string, fileName: string) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31));
  XLSX.writeFile(workbook, fileName);
}

/** Ambil nilai sel sebagai string bersih, mencoba beberapa nama kolom. */
export function cell(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
