import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { movementLabel } from './constants';
import { formatIDR } from './utils';

/** jsPDF cukup besar, jadi hanya di-load saat PDF benar-benar dibuat. */
async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

const safeDate = (value: string, pattern: string) => {
  const date = new Date(value);
  return isNaN(date.getTime()) ? '-' : format(date, pattern, { locale: localeId });
};

export interface BAData {
  /** Nomor BA tersimpan di log pergerakan, sehingga unduh ulang menghasilkan nomor yang sama. */
  baNumber: string;
  /** Judul setelah "BERITA ACARA". Default: label tipe pergerakan. */
  title?: string;
  movementType: string;
  transactionDate: string;
  customerName: string;
  customerAddress: string;
  customerPIC: string;
  locationName?: string;
  devices: { sn: string; model?: string; tid?: string; mid?: string; status?: string; linked?: string }[];
  /** Baris ringkasan tambahan, mis. rincian denda saat penarikan. */
  summaryLines?: string[];
  notes?: string;
  technicianName: string;
  generatedAt: string;
}

export async function downloadBAPDF(data: BAData) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const label = data.title || movementLabel(data.movementType);
  const lastY = () => (doc as any).lastAutoTable.finalY as number;
  const ensureSpace = (y: number, needed: number) => {
    if (y + needed <= pageHeight - 20) return y;
    doc.addPage();
    return 25;
  };

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`BERITA ACARA ${label.toUpperCase()}`, pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nomor: ${data.baNumber}`, pageWidth / 2, 28, { align: 'center' });
  doc.setLineWidth(0.5);
  doc.line(20, 35, pageWidth - 20, 35);

  doc.setFontSize(11);
  const intro = `Pada hari ini, ${safeDate(data.transactionDate, 'EEEE, dd MMMM yyyy')}, telah dilakukan aktivitas ${label.toLowerCase()} perangkat dengan rincian sebagai berikut:`;
  doc.text(doc.splitTextToSize(intro, pageWidth - 40), 20, 45);

  autoTable(doc, {
    startY: 58,
    margin: { left: 20, right: 20 },
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
    body: [
      ['Nama Customer', `: ${data.customerName || '-'}`],
      ['Alamat', `: ${data.customerAddress || '-'}`],
      ['Lokasi', `: ${data.locationName || '-'}`],
      ['PIC Customer', `: ${data.customerPIC || '-'}`],
      ['Jenis Aktivitas', `: ${label}`],
      ['Tanggal Efektif', `: ${safeDate(data.transactionDate, 'dd MMMM yyyy')}`],
    ],
  });

  let y = lastY() + 10;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Daftar Perangkat (${data.devices.length} unit):`, 20, y);

  autoTable(doc, {
    startY: y + 4,
    margin: { left: 20, right: 20 },
    head: [['No', 'Serial Number', 'TID', 'MID', 'Model', 'Kelengkapan', 'Status']],
    body: data.devices.map((d, i) => [i + 1, d.sn, d.tid || '-', d.mid || '-', d.model || '-', d.linked || '-', d.status || '-']),
    theme: 'striped',
    headStyles: { fillColor: [0, 102, 204], textColor: 255 },
    styles: { fontSize: 8 },
  });
  y = lastY() + 10;

  const writeBlock = (title: string, lines: string[]) => {
    if (lines.length === 0) return;
    const wrapped = lines.flatMap(line => doc.splitTextToSize(line, pageWidth - 40) as string[]);
    y = ensureSpace(y, 8 + wrapped.length * 5);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 20, y);
    doc.setFont('helvetica', 'normal');
    doc.text(wrapped, 20, y + 5);
    y += 10 + wrapped.length * 5;
  };

  writeBlock('Rincian:', data.summaryLines || []);
  writeBlock('Catatan:', data.notes ? [data.notes] : []);

  y = ensureSpace(y + 10, 45);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Pihak Customer,', 50, y, { align: 'center' });
  doc.text('Admin / Teknisi,', pageWidth - 50, y, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text(`(${data.customerPIC || '____________________'})`, 50, y + 25, { align: 'center' });
  doc.text(`(${data.technicianName || '____________________'})`, pageWidth - 50, y + 25, { align: 'center' });
  doc.setFontSize(8);
  doc.text('Nama, Tanda Tangan & Stempel', 50, y + 30, { align: 'center' });
  doc.text('Nama & Tanda Tangan', pageWidth - 50, y + 30, { align: 'center' });

  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(
    `Dokumen di-generate oleh sistem CIM Artajasa pada ${safeDate(data.generatedAt, 'dd/MM/yyyy HH:mm')}`,
    pageWidth / 2, pageHeight - 10, { align: 'center' },
  );

  doc.save(`${data.baNumber.replace(/[^\w-]+/g, '_')}.pdf`);
}

export interface AssetReportData {
  sn: string;
  tid?: string;
  mid?: string;
  vendor?: string;
  model?: string;
  status: string;
  condition?: string;
  customerName: string;
  customerAddress: string;
  locationName: string;
  contractStatus?: string;
  contractEndDate?: string;
  monthlyRental?: number;
  penaltyAmount?: number;
  peripherals: { type: string; sn: string }[];
  history: { date: string; type: string; status: string; by: string }[];
}

export async function downloadAssetReportPDF(data: AssetReportData) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const lastY = () => (doc as any).lastAutoTable.finalY as number;

  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('LAPORAN DETAIL ASET & POSISI UNIT', pageWidth / 2, 20, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Dibuat: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: localeId })}`, pageWidth / 2, 28, { align: 'center' });

  const section = (title: string, y: number, body: (string | number)[][], head?: string[][]) => {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 102, 204);
    doc.text(title, 20, y);
    autoTable(doc, {
      startY: y + 4,
      margin: { left: 20, right: 20 },
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [71, 85, 105] },
      columnStyles: head ? {} : { 0: { fontStyle: 'bold', cellWidth: 55 } },
      head,
      body,
    });
    return lastY() + 12;
  };

  let y = section('1. SPESIFIKASI PERANGKAT', 52, [
    ['Serial Number', data.sn],
    ['Terminal ID (TID)', data.tid || '-'],
    ['Merchant ID (MID)', data.mid || '-'],
    ['Merk / Model', `${data.vendor || '-'} / ${data.model || '-'}`],
    ['Kondisi', data.condition || '-'],
  ]);
  y = section('2. POSISI & STATUS', y, [
    ['Status Saat Ini', data.status],
    ['Customer', data.customerName],
    ['Lokasi', data.locationName],
    ['Alamat Customer', data.customerAddress],
  ]);
  y = section('3. KONTRAK & DENDA', y, [
    ['Status Kontrak', data.contractStatus || 'Belum ada kontrak'],
    ['Akhir Kontrak (berlaku)', data.contractEndDate || '-'],
    ['Sewa per Bulan', formatIDR(data.monthlyRental)],
    ['Total Denda', formatIDR(data.penaltyAmount)],
  ]);
  y = section(
    '4. SIM & PERIPHERAL TERTAUT', y,
    data.peripherals.length ? data.peripherals.map(p => [p.type.toUpperCase(), p.sn]) : [['-', 'Tidak ada']],
    [['Jenis', 'Serial Number']],
  );
  if (data.history.length) {
    section('5. RIWAYAT PERGERAKAN', y, data.history.map(h => [h.date, h.type, h.status, h.by]), [['Tanggal', 'Aktivitas', 'Status', 'Oleh']]);
  }

  doc.save(`Laporan_Aset_${data.sn.replace(/[^\w-]+/g, '_')}.pdf`);
}
