# Channel Inventory Management (CIM) - Artajasa

Aplikasi web untuk mengelola siklus hidup aset channel (perangkat EDC, SIM card, peripheral):
registrasi, alokasi ke customer B2B, pemasangan, penarikan, kontrak sewa per unit, denda, dan Berita Acara (PDF).

Stack: React 19, Vite, Tailwind CSS 4, Firebase Auth (username + password) dan Cloud Firestore.

## Menu

| Menu | Fungsi |
| --- | --- |
| Dashboard | Ringkasan armada aktif per status, hal yang perlu perhatian (QC tertunda, stok menganggur, garansi habis, kontrak berakhir, denda), pergerakan terbaru. Semua kartu bisa diklik. |
| Aset & Monitoring | Master perangkat / SIM / peripheral, penerimaan dari supplier (manual & import Excel), posisi unit (merchant, kota, region), lama di status, garansi, filter, export, detail + timeline siklus hidup. |
| Pergerakan EDC | Satu-satunya tempat status unit berubah, dari penerimaan sampai penghapusan (lihat alur di bawah). Berita Acara PDF otomatis. |
| Persetujuan | Pengajuan disposal, kehilangan, retur supplier, dan batal pengakhiran kontrak: setujui / tolak, eksekusi, bukti pendukung, riwayat. |
| Monitoring Kontrak | Kontrak per unit, ARO, kontrak yang segera berakhir, denda, pengajuan batal pengakhiran. |
| Master Data | Customer B2B, Merchant & Lokasi (outlet milik customer, gudang, service center), Supplier & Model perangkat, Part EDC. |
| User & Role | Khusus Admin: buat akun user, atur role, nonaktifkan akun. |

## Akses & role

Login memakai **username + password** (Firebase Authentication, provider Email/Password).
Username dipetakan ke email internal `username@krispo-edc.local` yang tidak pernah dikirimi apa pun.

- **Admin pertama**: buka halaman login, klik **Setup admin pertama**, lalu buat password untuk username `admin`.
  Ini hanya bisa dilakukan sekali; setelah itu username `admin` sudah terpakai.
- **User lain**: dibuat Admin di menu **User & Role** dengan password sementara. User wajib menggantinya saat login pertama.
- **Ganti password**: tombol **Ganti Password** di sidebar.
- **Lupa password**: Admin menonaktifkan akun lama dan membuatkan akun baru. Reset password oleh Admin butuh server
  (Firebase Admin SDK) dan belum tersedia.

Username admin pertama dan domain login didefinisikan di dua tempat yang harus sama:

- `BOOTSTRAP_ADMIN_USERNAME` dan `LOGIN_EMAIL_DOMAIN` di `src/lib/constants.ts`
- `isBootstrapAdmin()` dan `loginEmail()` di `firestore.rules`

| Role | Hak tulis |
| --- | --- |
| Admin | Semua, termasuk hapus data dan manajemen user |
| Operations | Aset, pergerakan, customer, lokasi, part |
| Warehouse | Aset, pergerakan, lokasi |
| Service | Update aset, pergerakan, part |
| Account Manager | Customer |
| Management | Baca semua data + menyetujui / menolak pengajuan |

Matriks ini didefinisikan di `src/lib/constants.ts` (untuk tampilan) dan ditegakkan di `firestore.rules` (yang sebenarnya menjaga data).
Kalau mengubah salah satu, ubah keduanya dan jalankan `npm run test:rules`.

## Persetujuan (maker-checker)

Pergerakan berisiko tidak bisa langsung dijalankan:

| Pengajuan | Dari |
| --- | --- |
| Penghapusan (Disposal) | Pergerakan EDC |
| Hilang / Dicuri | Pergerakan EDC |
| Retur ke Supplier (RMA) | Pergerakan EDC |
| Batal Pengakhiran Kontrak | Monitoring Kontrak |

Alurnya:

1. Operator (Operations / Warehouse / Service) **mengajukan**. Unit terkunci dari pergerakan lain.
2. Admin atau Management lain (bukan pengaju) **menyetujui** atau **menolak** (alasan wajib).
3. Operator **mengeksekusi** pengajuan yang disetujui: status berubah dan Berita Acara diunduh.

Aturan ini dijaga di `firestore.rules`, bukan hanya di tampilan: status Hilang / Dihapuskan / Diretur dan pemulihan
kontrak ditolak database tanpa pengajuan yang disetujui untuk unit tersebut, dan satu pengajuan hanya bisa dieksekusi sekali.

## Lampiran

Foto dan PDF bisa dilampirkan ke pengajuan (bukti pendukung), ke tiap transaksi di riwayat pergerakan (mis. BA bertanda
tangan, foto instalasi), dan ke unit (Dokumen Unit: invoice, kartu garansi).

- Disimpan di Firestore (koleksi `attachments` dan `attachment_data`), jadi tidak butuh Cloud Storage / paket berbayar.
- Foto dikompres otomatis di browser (sisi terpanjang 1600px, biasanya 200-400 KB). PDF maksimal 700 KB.
- Kuota gratis Firestore 1 GiB cukup untuk ribuan lampiran. Jika nanti project di-upgrade ke paket Blaze,
  lampiran sebaiknya dipindah ke Cloud Storage.
- Lampiran tidak bisa diubah. Pengunggah bisa menghapusnya dalam 24 jam (salah unggah); setelah itu hanya Admin.

## Menjalankan

Prasyarat: Node.js 20+.

```bash
npm install
```

```bash
npm run dev
```

Aplikasi berjalan di http://localhost:3000 dan terhubung ke project Firebase di `firebase-applet-config.json`.

### Development dengan emulator (disarankan, tidak menyentuh data asli)

Butuh Java 11+ untuk emulator Firestore. Jalankan dua terminal:

```bash
npm run emulators
```

```bash
npm run dev:emulator
```

Di mode emulator, buat admin lewat tombol **Setup admin pertama** di halaman login seperti biasa.

## Deploy security rules (wajib setelah menarik perubahan ini)

Aturan akses ada di `firestore.rules`. Setiap kali file ini berubah, pasang ulang rules-nya; aplikasi versi baru membutuhkan rules versi yang sama
(misalnya koleksi `suppliers`, `device_models`, dan status baru).
Deploy rules lebih dulu, baru deploy aplikasinya.

```bash
npx firebase-tools login
```

```bash
npm run deploy:rules
```

Tanpa terminal, lewat Firebase Console:

1. Buka Firebase Console > **Firestore Database**.
2. Di pilihan database bagian atas, pilih database `ai-studio-cdae1dda-26df-4628-b8fa-2fac96309958` (bukan `(default)`).
3. Buka tab **Rules**, hapus semua isinya, tempel seluruh isi file `firestore.rules`, lalu klik **Publish**.

`firebase.json` sudah menunjuk ke database Firestore bernama yang dipakai aplikasi.

## Deploy ke Vercel

Project sudah menyertakan `vercel.json` (framework Vite, output `dist`), tanpa environment variable.
Setiap push ke branch `main` otomatis ter-deploy.

Setup sekali di Firebase Console (project `edc-warehouse-management`):

1. **Authentication > Sign-in method**: aktifkan provider **Email/Password** (yang "Email link" tidak perlu).
   Provider Google boleh dinonaktifkan.
2. Deploy security rules (bagian di atas).
3. Buka aplikasi, klik **Setup admin pertama**, buat password admin. Lakukan segera setelah deploy.

Login username + password tidak membutuhkan pendaftaran domain di *Authorized domains*.

## Test

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:rules
```

- `npm test`: logika kontrak, denda, ARO, dan aturan pergerakan (`tests/contract.test.ts`).
- `npm run test:rules`: security rules terhadap emulator Firestore (`tests/rules.test.ts`).

## Struktur kode

```
src/
  lib/
    constants.ts    status, tipe pergerakan, role & hak akses (satu sumber kebenaran)
    contract.ts     logika kontrak, ARO, dan denda (fungsi murni, teruji)
    movements.ts    semua perubahan status aset + log + Berita Acara (atomik)
    assets.ts       registrasi, edit, tautan SIM/peripheral, hapus, import
    baGenerator.ts  PDF Berita Acara & laporan aset
    excel.ts        baca / tulis Excel
  context/
    AuthContext     sesi, profil, role, wajib ganti password sementara
    DataContext     satu listener data untuk semua halaman
    NavContext      routing berbasis hash (refresh & tombol back tetap di halaman yang sama)
  components/ui.tsx Modal, toast, dialog konfirmasi, badge status, dsb.
  pages/            satu file per menu
```

Aturan penting saat mengembangkan:

1. Status / customer / kontrak aset hanya boleh diubah lewat `src/lib/movements.ts`.
2. Status dan role selalu diambil dari `src/lib/constants.ts`, jangan menulis string status langsung di halaman.
3. Halaman membaca data dari `useData()`, jangan membuka listener koleksi sendiri.

## Alur status aset (hulu ke hilir)

| Tahap | Pergerakan | Dari → Ke | BA |
| --- | --- | --- | --- |
| Pengadaan | Penerimaan dari supplier (registrasi / import) | baru → Stok Masuk (QC) atau Tersedia | |
| | Lolos QC | Stok Masuk → Tersedia | |
| | Retur ke Supplier (RMA) | stok / rusak / perbaikan → Diretur ke Supplier | ya |
| Persiapan | Staging / konfigurasi (TID/MID per unit) | Tersedia / Ditarik → Siap Pasang | |
| | Mutasi antar gudang | status tetap, pindah gudang | ya |
| Distribusi | Alokasi | stok → Dialokasikan | |
| | Kirim ke merchant | stok / dialokasikan → Dalam Pengiriman | ya |
| | Pasang (Install), kontrak mulai | → Terpasang | ya |
| Operasional | Relokasi ke merchant lain (customer sama) | Terpasang → Terpasang | ya |
| | Kunjungan / maintenance | status tetap | ya |
| | Tukar unit (swap): kontrak, merchant, TID/MID pindah ke unit pengganti tanpa denda | Terpasang ↔ stok | ya |
| Service | Kirim perbaikan (no. tiket, vendor, biaya) | stok / rusak → Perbaikan | |
| | Kembali ke stok / refurbish (kondisi baru, biaya) | → Tersedia | |
| Akhir masa pakai | Tarik (kontrak diakhiri, denda otomatis) | Terpasang → Ditarik | ya |
| | Tandai rusak | → Rusak | |
| | Hilang / dicuri (kontrak diakhiri jika terpasang) | → Hilang | ya |
| | Penghapusan / disposal (wajib pernyataan hapus key) | stok / rusak → Dihapuskan | ya |

Status akhir (Hilang, Diretur ke Supplier, Dihapuskan) tidak bisa digerakkan lagi dan disembunyikan dari daftar aset secara default.
SIM dan peripheral yang tertaut ke perangkat selalu ikut status, customer, dan lokasi perangkat induknya.

## Catatan yang perlu diketahui

- Library `xlsx` versi npm (0.18.5) punya advisory keamanan yang belum ada perbaikannya di registry npm.
  Risikonya terbatas pada file Excel yang sengaja dibuat berbahaya dan di-upload oleh user yang sudah login.
  Perbaikan resminya memasang dari CDN SheetJS:
  `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
- Kontrak melekat pada dokumen unit, jadi satu unit menyimpan satu kontrak terakhir.
  Rincian denda tiap penarikan tetap tersimpan permanen di log pergerakan.
- Keunikan serial number dicek di aplikasi (bukan di database). Dua user yang mendaftarkan SN yang sama
  pada detik yang sama masih bisa lolos.
- `firebase-applet-config.json` berisi konfigurasi web Firebase, yang memang bukan rahasia. Yang menjaga data adalah `firestore.rules`.
  Disarankan juga membatasi API key ke domain aplikasi di Google Cloud Console dan mengaktifkan App Check.
