# Channel Inventory Management (CIM) - Artajasa

Aplikasi web untuk mengelola siklus hidup aset channel (perangkat EDC, SIM card, peripheral):
registrasi, alokasi ke customer B2B, pemasangan, penarikan, kontrak sewa per unit, denda, dan Berita Acara (PDF).

Stack: React 19, Vite, Tailwind CSS 4, Firebase Auth (Google) dan Cloud Firestore.

## Menu

| Menu | Fungsi |
| --- | --- |
| Dashboard | Ringkasan stok per status, hal yang perlu perhatian, pergerakan terbaru. Semua kartu bisa diklik. |
| Aset & Monitoring | Master perangkat / SIM / peripheral, posisi unit, filter, import & export Excel, detail + riwayat. |
| Pergerakan EDC | Satu-satunya tempat status unit berubah: alokasi, kirim, pasang, relokasi, tarik, perbaikan, kembali ke stok, write-off. |
| Monitoring Kontrak | Kontrak per unit, ARO, kontrak yang segera berakhir, denda, pembatalan pengakhiran. |
| Master Data | Customer B2B, Lokasi, Part EDC. |
| User & Role | Khusus Admin: undang user, atur role, nonaktifkan akun. |

## Akses & role

Login Google saja tidak cukup. Hanya email yang **diundang Admin** di menu User & Role yang bisa masuk.
Admin pertama (bootstrap) ditentukan di dua tempat yang harus sama:

- `BOOTSTRAP_ADMIN_EMAIL` di `src/lib/constants.ts`
- `isBootstrapAdmin()` di `firestore.rules`

| Role | Hak tulis |
| --- | --- |
| Admin | Semua, termasuk hapus data dan manajemen user |
| Operations | Aset, pergerakan, customer, lokasi, part |
| Warehouse | Aset, pergerakan, lokasi |
| Service | Update aset, pergerakan, part |
| Account Manager | Customer |
| Management | Hanya baca |

Matriks ini didefinisikan di `src/lib/constants.ts` (untuk tampilan) dan ditegakkan di `firestore.rules` (yang sebenarnya menjaga data).
Kalau mengubah salah satu, ubah keduanya dan jalankan `npm run test:rules`.

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

Di mode emulator, login tanpa popup lewat console browser: `__devSignIn('email@contoh.com')`.

## Deploy security rules (wajib setelah menarik perubahan ini)

Aturan akses ada di `firestore.rules`. Aplikasi versi ini **membutuhkan** rules versi ini (misalnya koleksi `invites`).
Deploy rules lebih dulu, baru deploy aplikasinya.

```bash
npx firebase-tools login
```

```bash
npm run deploy:rules
```

`firebase.json` sudah menunjuk ke database Firestore bernama yang dipakai aplikasi.

## Deploy ke Vercel

Project sudah menyertakan `vercel.json` (framework Vite, output `dist`), tanpa environment variable.

1. Di Vercel: **Add New > Project**, pilih repository ini, lalu **Deploy**. Setiap push berikutnya otomatis ter-deploy.
2. Di Firebase Console: **Authentication > Settings > Authorized domains**, tambahkan domain Vercel-nya
   (mis. `nama-project.vercel.app`). Tanpa ini login Google ditolak dengan `auth/unauthorized-domain`.
3. Pastikan security rules sudah ter-deploy (lihat bagian di atas).

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
    AuthContext     sesi, profil, role (klaim undangan saat login pertama)
    DataContext     satu listener data untuk semua halaman
    NavContext      routing berbasis hash (refresh & tombol back tetap di halaman yang sama)
  components/ui.tsx Modal, toast, dialog konfirmasi, badge status, dsb.
  pages/            satu file per menu
```

Aturan penting saat mengembangkan:

1. Status / customer / kontrak aset hanya boleh diubah lewat `src/lib/movements.ts`.
2. Status dan role selalu diambil dari `src/lib/constants.ts`, jangan menulis string status langsung di halaman.
3. Halaman membaca data dari `useData()`, jangan membuka listener koleksi sendiri.

## Alur status aset

```
Stok Masuk ──Kembali ke Stok──▶ Tersedia ──Alokasi──▶ Dialokasikan ──Kirim──▶ Dalam Pengiriman
                                   │  ▲                     │                        │
                                   │  └──────── Kembali ke Stok ◀────────────────────┤
                                   └───────────────── Pasang ──────────────────────▶ Terpasang ⟲ Relokasi
                                                                                      │
Tersedia ◀──Kembali ke Stok── Ditarik (Gudang) ◀──────────── Tarik ──────────────────┘
Tersedia / Ditarik ──Kirim Perbaikan──▶ Perbaikan ──Kembali ke Stok──▶ Tersedia
(selain Terpasang) ──Write-off──▶ Rusak / Hilang / Dihapuskan
```

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
