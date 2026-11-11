# Spesifikasi Keamanan - Channel Inventory Management

Semua aturan di dokumen ini ditegakkan oleh `firestore.rules` dan diuji otomatis di `tests/rules.test.ts`
(`npm run test:rules`). Tampilan aplikasi hanya menyembunyikan tombol; yang benar-benar menjaga data adalah rules.

## 1. Invarian data

- Hanya user dengan profil aktif di `/users/{uid}` yang bisa membaca atau menulis data apa pun.
- Login memakai username + password. Profil user hanya bisa dibuat oleh Admin; satu-satunya pengecualian adalah admin pertama (username `admin`) yang membuat profil Admin untuk dirinya sendiri.
- Akun yang mendaftar sendiri lewat API Firebase tidak punya profil, sehingga tidak bisa membaca atau menulis apa pun.
- Username harus unik (dijamin Firebase Auth), sesuai pola `^[a-z0-9][a-z0-9._-]{2,31}$`, dan tidak bisa diubah.
- Role dan status diri sendiri tidak bisa diubah. Admin tidak bisa mengubah atau menghapus dirinya sendiri (mencegah lockout).
- Serial number aset tidak bisa diganti setelah terdaftar. Status harus salah satu dari daftar resmi.
- Nilai uang (denda, sewa, harga part) harus angka dan tidak boleh negatif.
- Log pergerakan dicatat atas nama user yang login dengan waktu server, dan tidak bisa diedit siapa pun.
- Status akhir (Hilang, Dihapuskan, Diretur ke Supplier) dan pemulihan kontrak yang sudah diakhiri hanya bisa terjadi
  dengan pengajuan yang disetujui orang lain (maker-checker).
- Hapus data hanya oleh Admin.

## 2. Skenario serangan dan statusnya

| # | Skenario | Status |
| --- | --- | --- |
| 1 | Identity spoofing: membuat profil sendiri dengan `role: "Admin"` | Ditolak rules, teruji |
| 2 | Daftar akun sendiri lewat API Firebase lalu dapat akses | Ditolak: profil hanya dibuat Admin, teruji |
| 3 | Eskalasi role: user mengubah role-nya sendiri | Ditolak rules, teruji |
| 4 | Shadow field: menyisipkan field tak dikenal di profil (`isVerified: true`) | Ditolak (`hasOnly`), teruji |
| 5 | Kebocoran PII: user biasa membaca daftar `/users` | Ditolak, hanya Admin, teruji |
| 6 | Manipulasi harga: `price` part jadi negatif / bukan angka, atau diubah role tak berwenang | Ditolak, teruji |
| 7 | Denda negatif (`partPenaltyAmount: -5`) | Ditolak, teruji |
| 8 | Resource poisoning: serial number 1 MB | Ditolak (maks 128 karakter), teruji |
| 9 | Hapus data oleh non-admin | Ditolak, teruji |
| 10 | Movement drift: mengedit log pergerakan untuk menutupi riwayat | Ditolak untuk semua role, teruji |
| 11 | Log palsu atas nama user lain / tanggal server dipalsukan | Ditolak, teruji |
| 12 | Role read-only (Management) menulis langsung ke Firestore tanpa lewat UI | Ditolak, teruji |
| 13 | State shortcutting: mengubah status aset tanpa lewat log pergerakan | Sebagian, lihat keterbatasan |
| 15 | Disposal / hilang / retur supplier tanpa persetujuan | Ditolak rules: butuh pengajuan yang disetujui untuk unit itu, teruji |
| 16 | Menyetujui pengajuan sendiri (termasuk Admin) | Ditolak rules, teruji |
| 17 | Memakai ulang pengajuan yang sudah dieksekusi | Ditolak: pengajuan berubah Executed di batch yang sama, teruji |
| 18 | Menghapus denda dengan memulihkan kontrak diam-diam | Ditolak rules: pemulihan kontrak butuh pengajuan yang disetujui, teruji |
| 19 | Mengubah / menghapus bukti lampiran | Lampiran tidak bisa diubah; hapus hanya pengunggah (24 jam) atau Admin, teruji |
| 20 | Unggah file berbahaya / sangat besar | Hanya JPG/PNG/WEBP/PDF, maks 700 KB, divalidasi rules, teruji |
| 14 | Pemalsuan tanggal kontrak oleh role operasional | Sebagian, lihat keterbatasan |

## 3. Keterbatasan yang diketahui

Aplikasi ini tanpa backend, sehingga logika bisnis berjalan di browser user yang berwenang.

- User dengan role operasional (Operations, Warehouse, Service) secara teknis bisa menulis field aset apa pun yang lolos validasi,
  termasuk status dan field kontrak, dengan memanggil Firestore langsung. Rules membatasi **siapa** dan **bentuk data**,
  bukan kebenaran hitungan kontrak. Aplikasi sendiri selalu menulis perubahan status bersama log-nya dalam satu batch atomik.
- Keunikan serial number tidak dijamin database (dicek di aplikasi).
- **Setup admin pertama**: siapa pun yang lebih dulu mendaftarkan username `admin` menjadi Admin. Lakukan setup segera setelah
  aplikasi pertama kali di-deploy. Setelah akun `admin` ada, username itu tidak bisa didaftarkan lagi.
- Pendaftaran akun lewat API Firebase tetap terbuka (dibutuhkan Admin untuk membuat akun dari browser). Akun seperti itu tidak
  punya akses data, tapi tetap tercatat di daftar Authentication.
- Reset password oleh Admin belum ada; butuh server dengan Firebase Admin SDK (mis. Vercel Function).
- Perbaikan menyeluruh untuk dua poin di atas adalah memindahkan pergerakan dan registrasi aset ke Cloud Functions
  (rules lalu menolak semua tulis status dari client).

## 4. Rekomendasi operasional

- Batasi API key Firebase ke domain aplikasi dan aktifkan App Check.
- Aktifkan backup terjadwal Firestore (PITR / scheduled backups); fitur "Reset Data Operasional" tidak bisa dibatalkan.
- Review daftar user secara berkala; nonaktifkan akun yang tidak dipakai.
- Aktifkan *Email enumeration protection* di Firebase Console > Authentication > Settings.
