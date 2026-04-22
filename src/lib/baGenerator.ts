import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

export interface BAData {
  movementType: string;
  transactionDate: string;
  customerName: string;
  customerAddress: string;
  customerPIC: string;
  devices: {
    sn: string;
    model: string;
    tid?: string;
    mid?: string;
    status?: string;
  }[];
  notes?: string;
  technicianName: string;
  generatedAt: string;
}

export const generateBAPDF = (data: BAData) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const title = `BERITA ACARA ${data.movementType.toUpperCase()}`;
  doc.text(title, pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const subTitle = `Nomor: BA/${data.movementType.substring(0, 3).toUpperCase()}/${format(new Date(), 'yyyyMMdd')}/${Math.floor(1000 + Math.random() * 9000)}`;
  doc.text(subTitle, pageWidth / 2, 28, { align: 'center' });

  // Divider
  doc.setLineWidth(0.5);
  doc.line(20, 35, pageWidth - 20, 35);

  // Content Paragraph
  doc.setFontSize(11);
  const introText = `Pada hari ini, ${format(new Date(data.transactionDate), 'EEEE, dd MMMM yyyy')}, bertempat di ${data.customerName || 'Lokasi Terkait'}, telah dilakukan aktivitas pergerakan perangkat EDC dengan rincian sebagai berikut:`;
  const splitIntro = doc.splitTextToSize(introText, pageWidth - 40);
  doc.text(splitIntro, 20, 45);

  // Customer Table
  autoTable(doc, {
    startY: 55,
    margin: { left: 20 },
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
    body: [
      ['Nama Merchant', `: ${data.customerName}`],
      ['Alamat', `: ${data.customerAddress || '-'}`],
      ['PIC Merchant', `: ${data.customerPIC || '-'}`],
      ['Jenis Aktivitas', `: ${data.movementType}`],
      ['Tanggal Efektif', `: ${format(new Date(data.transactionDate), 'dd MMM yyyy')}`],
    ],
  });

  // Device Table
  const tableStartY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Daftar Perangkat EDC:', 20, tableStartY);

  autoTable(doc, {
    startY: tableStartY + 5,
    head: [['No', 'Serial Number', 'Terminal ID', 'Model', 'Status Baru']],
    body: data.devices.map((d, i) => [
      i + 1,
      d.sn,
      d.tid || '-',
      d.model,
      data.movementType === 'Install' ? 'Active' : d.status || '-'
    ]),
    theme: 'striped',
    headStyles: { fillColor: [0, 102, 204], textColor: 255 },
    styles: { fontSize: 9 },
  });

  // Notes
  const notesStartY = (doc as any).lastAutoTable.finalY + 10;
  if (data.notes) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Catatan Tambahan:', 20, notesStartY);
    doc.setFont('helvetica', 'normal');
    const splitNotes = doc.splitTextToSize(data.notes, pageWidth - 40);
    doc.text(splitNotes, 20, notesStartY + 5);
  }

  // Footer / Signatures
  const footerStartY = (doc as any).lastAutoTable.finalY + 30;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  
  doc.text('Pihak Merchant,', 40, footerStartY, { align: 'center' });
  doc.text('Admin/Teknisi,', pageWidth - 40, footerStartY, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text('(____________________)', 40, footerStartY + 25, { align: 'center' });
  doc.text(`(${data.technicianName})`, pageWidth - 40, footerStartY + 25, { align: 'center' });
  
  doc.setFontSize(8);
  doc.text('Nama & Stempel', 40, footerStartY + 30, { align: 'center' });
  doc.text('Tanda Tangan', pageWidth - 40, footerStartY + 30, { align: 'center' });

  // Metadata Footer
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`Dokumen ini di-generate otomatis oleh CIM ArtaJasa System pada ${format(new Date(data.generatedAt), 'dd/MM/yyyy HH:mm:ss')}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });

  return doc;
};

export interface AssetReportData {
  sn: string;
  tid?: string;
  mid?: string;
  vendor: string;
  model: string;
  status: string;
  condition: string;
  customerName: string;
  customerAddress: string;
  locationName: string;
  contractStatus?: string;
  contractEndDate?: string;
  penaltyAmount?: number;
  peripherals: { type: string; sn: string }[];
  generatedAt: string;
}

export const generateAssetReportPDF = (data: AssetReportData) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header Box
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('LAPORAN DETIL ASET & POSISI UNIT', pageWidth / 2, 20, { align: 'center' });
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${format(new Date(data.generatedAt), 'dd MMMM yyyy HH:mm')}`, pageWidth / 2, 28, { align: 'center' });

  // 1. Technical Specification
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 102, 204);
  doc.text('1. SPESIFIKASI TEKNIS PERANGKAT', 20, 55);
  
  autoTable(doc, {
    startY: 60,
    margin: { left: 20 },
    theme: 'striped',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    body: [
      ['Serial Number (S/N)', data.sn],
      ['Terminal ID (TID)', data.tid || '-'],
      ['Merchant ID (MID)', data.mid || '-'],
      ['Merk / Vendor', data.vendor],
      ['Model / Type', data.model],
      ['Kondisi Fisik', data.condition],
    ],
  });

  // 2. Current Position & Status
  const posStartY = (doc as any).lastAutoTable.finalY + 15;
  doc.setFont('helvetica', 'bold');
  doc.text('2. POSISI UNIT & STATUS OPERASIONAL', 20, posStartY);
  
  autoTable(doc, {
    startY: posStartY + 5,
    margin: { left: 20 },
    theme: 'grid',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    body: [
      ['Status Saat Ini', data.status],
      ['Pemegang Aset (Merchant)', data.customerName],
      ['Lokasi Penempatan', data.locationName],
      ['Alamat Merchant', data.customerAddress],
    ],
  });

  // 3. Contract & Financial Info
  const contractStartY = (doc as any).lastAutoTable.finalY + 15;
  doc.text('3. INFORMASI KONTRAK & PENALTI', 20, contractStartY);
  
  autoTable(doc, {
    startY: contractStartY + 5,
    margin: { left: 20 },
    theme: 'plain',
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    body: [
      ['Status Kontrak', data.contractStatus || 'N/A'],
      ['Estimasi Selesai Kontrak', data.contractEndDate || '-'],
      ['Akumulasi Denda (Jika Ada)', `Rp ${Number(data.penaltyAmount || 0).toLocaleString()}`],
    ],
  });

  // 4. Integrated Peripherals
  const pStartY = (doc as any).lastAutoTable.finalY + 15;
  doc.text('4. PERIPHERAL TERINTEGRASI', 20, pStartY);
  
  autoTable(doc, {
    startY: pStartY + 5,
    margin: { left: 20 },
    head: [['Jenis Komponen', 'Serial Number']],
    body: data.peripherals.map(p => [p.type.toUpperCase(), p.sn]),
    theme: 'striped',
    headStyles: { fillColor: [71, 85, 105] },
    styles: { fontSize: 9 },
  });

  // Footer Metadata
  const finalY = (doc as any).lastAutoTable.finalY + 20;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('--- Dokumen ini merupakan laporan resmi status aset dari Sistem CIM ArtaJasa ---', pageWidth / 2, finalY, { align: 'center' });

  return doc;
};
