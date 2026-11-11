import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { actorName, auth, db } from './firebase';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_UPLOAD, type AttachmentParent } from './constants';
import type { Attachment } from './types';

/**
 * Lampiran disimpan di Firestore (bukan Cloud Storage) supaya jalan di paket gratis Firebase.
 * Metadata di `attachments` (ringan, untuk daftar), isi file base64 di `attachment_data`
 * (hanya diunduh saat dibuka). Foto dikompres di browser sebelum diunggah.
 */

export const ATTACHMENT_LABELS = [
  'BA bertanda tangan', 'Foto unit / instalasi', 'Resi / surat jalan', 'Laporan polisi / kehilangan',
  'Memo persetujuan', 'Invoice / dokumen pembelian', 'Lainnya',
];

const MAX_IMAGE_SIDE = 1600;

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Perkecil foto (sisi terpanjang 1600px, JPEG) sampai di bawah batas ukuran. */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  let width = Math.round(bitmap.width * scale);
  let height = Math.round(bitmap.height * scale);
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const quality = Math.max(0.45, 0.8 - attempt * 0.08);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) return blob;
    width = Math.round(width * 0.8);
    height = Math.round(height * 0.8);
  }
  throw new Error(`Foto ${file.name} terlalu besar meski sudah dikompres.`);
}

async function prepare(file: File): Promise<{ blob: Blob; name: string; mimeType: string }> {
  if (file.type.startsWith('image/')) {
    if (!ATTACHMENT_MIME_TYPES.includes(file.type) && !/heic|heif/i.test(file.type)) throw new Error(`Format ${file.name} tidak didukung.`);
    const blob = await compressImage(file);
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg' };
  }
  if (file.type !== 'application/pdf') throw new Error(`Format ${file.name} tidak didukung. Gunakan foto (JPG/PNG) atau PDF.`);
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} berukuran ${(file.size / 1024 / 1024).toFixed(1)} MB. Maksimal ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB per PDF; scan ulang dengan resolusi lebih rendah atau kirim sebagai foto.`);
  }
  return { blob: file, name: file.name, mimeType: 'application/pdf' };
}

export async function uploadAttachments(parentType: AttachmentParent, parentId: string, files: File[], label: string): Promise<number> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login berakhir. Silakan login ulang.');
  if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) throw new Error(`Maksimal ${MAX_ATTACHMENTS_PER_UPLOAD} file sekali unggah.`);
  // Siapkan semua file dulu, supaya error format/ukuran ketahuan sebelum ada yang terunggah.
  const prepared = await Promise.all(files.map(prepare));
  for (const item of prepared) {
    const ref = doc(collection(db, 'attachments'));
    const batch = writeBatch(db);
    batch.set(ref, {
      parentType, parentId, name: item.name.slice(0, 200), mimeType: item.mimeType, size: item.blob.size,
      label: label.slice(0, 100), uploadedBy: user.uid, uploadedByName: actorName(), uploadedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'attachment_data', ref.id), { data: await blobToBase64(item.blob), uploadedBy: user.uid });
    await batch.commit();
  }
  return prepared.length;
}

/** Apakah browser bisa menampilkan PDF sendiri (sebagian browser HP langsung mengunduh). */
const canShowPdf = () => (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Buka lampiran di tab baru. Tab dibuka lebih dulu (sinkron dengan klik) supaya tidak
 * diblokir popup blocker; PDF diunduh langsung bila browser tidak punya penampil PDF.
 */
export async function openAttachment(att: Attachment) {
  const inline = att.mimeType.startsWith('image/') || (att.mimeType === 'application/pdf' && canShowPdf());
  const win = inline ? window.open('', '_blank') : null;
  try {
    const snap = await getDoc(doc(db, 'attachment_data', att.id));
    if (!snap.exists()) throw new Error('Isi file tidak ditemukan.');
    const bytes = Uint8Array.from(atob(snap.data().data as string), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: att.mimeType }));
    if (win) win.location.href = url;
    else download(url, att.name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}

export async function deleteAttachment(att: Attachment) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'attachment_data', att.id));
  batch.delete(doc(db, 'attachments', att.id));
  await batch.commit();
}

export const formatBytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
