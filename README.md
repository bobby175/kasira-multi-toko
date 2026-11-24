# Kasira — Aplikasi Kasir (POS) Modern Open Source

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Kasira** adalah aplikasi kasir (Point of Sale) berbasis web yang ringan, cepat, dan gratis untuk HP, tablet, dan PC. Mendukung **QRIS dinamis otomatis** (dari QRIS statis toko Anda), **transfer bank**, **layar pelanggan real-time**, **cetak struk thermal 58/80 mm**, serta **konfirmasi pembayaran otomatis dari notifikasi Android**.

Tidak membutuhkan MySQL/PostgreSQL — seluruh data disimpan rapi menggunakan **SQLite bawaan Node.js**.

---

## Fitur Utama

- **Kasir (POS) Responsif**: grid produk dengan kategori & pencarian, keranjang real-time, nyaman di HP (portrait & landscape), tablet, maupun PC.
- **QRIS Statis → Dinamis Otomatis**: cukup unggah foto/gambar QRIS statis toko sekali; setiap transaksi otomatis menghasilkan QRIS berisi nominal sehingga pelanggan tidak perlu mengetik nominal manual.
- **Transfer Bank**: menampilkan daftar rekening toko beserta nominal transfer dengan rapi.
- **Konfirmasi Manual & Otomatis**: transaksi berstatus *Menunggu* hingga dikonfirmasi staf, atau dikonfirmasi otomatis dari notifikasi aplikasi merchant QRIS / m-banking (opsional).
- **Real-time Multi-Perangkat**: transaksi yang dibuat di HP langsung muncul di PC/tablet lain, dan status pembayaran tersinkronisasi instan via Socket.IO.
- **Layar Pelanggan (Customer Display)**: menampilkan daftar pesanan, kode QRIS/rekening, hingga animasi *"Pembayaran Berhasil"* secara *read-only* (tanpa tombol konfirmasi).
- **Manajemen Produk & Hak Akses**: hanya **Admin** yang dapat mengubah produk/harga dan pengaturan (divalidasi di server); total transaksi selalu dihitung oleh server.
- **Cetak Struk & Riwayat**: mendukung printer thermal 58 mm / 80 mm serta rekap pendapatan harian (QRIS vs transfer).

---

## Persyaratan Sistem

- **Node.js versi `22.13` atau lebih baru** (direkomendasikan Node.js 22 LTS / Node.js 24, karena menggunakan modul `node:sqlite` bawaan).
- **Git** (opsional, untuk clone repositori).

---

## Cara Instalasi

Pilih salah satu cara instalasi di bawah ini sesuai perangkat yang ingin dijadikan server.

### Opsi 1: Di PC / Laptop (Windows, macOS, Linux)

1. **Install Node.js**  
   Unduh dan pasang Node.js versi **22.13+** dari [nodejs.org](https://nodejs.org/).  
   Pastikan terpasang dengan menjalankan:
   ```bash
   node -v
   ```

2. **Clone repositori**
   ```bash
   git clone https://github.com/bobby175/kasira.git
   cd kasira
   ```
   *(Atau klik tombol **Code → Download ZIP** di GitHub lalu ekstrak).*

3. **Install dependensi & build frontend**
   ```bash
   npm install
   npm run build
   ```

4. **Jalankan server**
   ```bash
   npm start
   ```

5. **Buka aplikasi**  
   Terminal akan menampilkan alamat server, contohnya:
   ```text
   Komputer ini   : http://localhost:3000
   HP / Tablet    : http://192.168.1.10:3000
   ```
   - Di PC/laptop server: buka `http://localhost:3000`.
   - Di HP/tablet kasir atau layar pelanggan: sambungkan ke **Wi-Fi yang sama**, lalu buka alamat `http://192.168.x.x:3000`.
   - **Pengguna Windows:** saat pertama kali menjalankan `npm start`, jika muncul jendela **Windows Defender Firewall**, izinkan akses untuk jaringan **Private** agar HP/tablet bisa terhubung.

---

### Opsi 2: Di HP / Tablet Android (Termux + Dukungan Tailscale)

Karena Kasira hanya memakai dependensi JavaScript murni (`express` & `socket.io`) dan SQLite bawaan Node.js, servernya bisa langsung berjalan di Android tanpa PC.

1. **Install Termux** dari [F-Droid](https://f-droid.org/packages/com.termux/) atau [GitHub Releases](https://github.com/termux/termux-app/releases) *(jangan dari Play Store karena versi lama).*
2. **Update paket & install Git + Node.js**:
   ```bash
   pkg update && pkg upgrade -y
   pkg install git nodejs -y
   node -v
   ```
   *(Pastikan versi Node minimal `v22.13`).*
3. **Clone & install dependensi server** *(folder `dist/` sudah disertakan, jadi cukup install dependensi produksi)*:
   ```bash
   git clone https://github.com/bobby175/kasira.git ~/kasira
   cd ~/kasira
   npm install --omit=dev
   ```
   > **Penting:** Simpan proyek di direktori internal Termux (`~/kasira`), **jangan** di `/sdcard/`, agar database SQLite (mode WAL) berjalan stabil.
4. **Jalankan server**:
   ```bash
   termux-wake-lock
   npm start
   ```
   Buka `http://localhost:3000` di Chrome HP tersebut (atau `http://<IP-WiFi-HP>:3000` dari perangkat lain di Wi-Fi yang sama).
5. **Agar tetap hidup di latar belakang (opsional tapi disarankan)**:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name kasira --node-args="--disable-warning=ExperimentalWarning"
   pm2 save
   ```
   Matikan optimasi baterai Android (*Unrestricted*) untuk aplikasi **Termux** (dan **Tailscale** jika dipakai).
6. **Akses dari luar Wi-Fi / HP lain via Tailscale (opsional)**:
   - Install aplikasi **Tailscale** di HP server dan di perangkat lain (misalnya HP pemilik yang memegang aplikasi merchant QRIS / DANA Bisnis), lalu login akun yang sama.
   - Hubungkan keduanya di Tailscale, lalu akses Kasira menggunakan IP Tailscale HP server: `http://100.x.x.x:3000`.

---

### Opsi 3: Di VPS Linux (Ubuntu / Debian) dengan HTTPS

1. Install **Node.js 22+**, clone repositori, lalu jalankan build:
   ```bash
   git clone https://github.com/bobby175/kasira.git
   cd kasira
   npm install
   npm run build
   ```
2. Jalankan menggunakan **PM2** dengan `TRUST_PROXY=1`:
   ```bash
   npm install -g pm2
   TRUST_PROXY=1 PORT=3000 pm2 start server/index.js --name kasira --node-args="--disable-warning=ExperimentalWarning"
   pm2 save
   pm2 startup
   ```
3. Pasang reverse proxy HTTPS seperti **Caddy** atau **Nginx** mengarah ke `127.0.0.1:3000` (pastikan dukungan WebSocket untuk Socket.IO aktif).

---

## Langkah Setup Awal (Pertama Kali Buka)

1. Buka aplikasi di browser, lalu isi halaman **Setup Awal** (nama toko dan akun **Admin**).
2. Buka menu **Produk** → tambahkan daftar produk, kategori, harga, dan foto.
3. Buka **Pengaturan → QRIS** → klik **Unggah gambar QRIS** (foto stiker QRIS atau gambar dari aplikasi merchant). Periksa nama merchant yang terbaca lalu simpan.
4. Buka **Pengaturan → Rekening Bank** → tambahkan rekening bank toko (jika menerima transfer).
5. Buka **Pengaturan → Pengguna** → buat akun untuk kasir dengan peran **Karyawan**.

---

## Panduan Penggunaan Fitur

### Layar Pelanggan (Tampilan Ganda)
Klik menu **Layar Pelanggan** (ikon monitor), lalu pilih salah satu:
- Scan kode QR yang muncul menggunakan kamera tablet/HP yang dijadikan layar pelanggan, **atau**
- Buka `http://<alamat-server>:3000/display` lalu masukkan **kode layar**, **atau**
- Di PC dengan 2 monitor: klik **Buka di perangkat ini**, pindahkan jendela ke monitor pelanggan, lalu tekan **F11**.

Admin dapat menekan **Ganti kode** kapan saja untuk memutus semua layar pelanggan yang sedang terhubung.

### Alur Pembayaran
1. Kasir memilih produk → keranjang otomatis tampil *live* di layar pelanggan.
2. Kasir menekan **Bayar Sekarang** lalu memilih **QRIS** atau **Transfer Bank**.
3. Layar pelanggan menampilkan QRIS dinamis (sudah berisi nominal) atau info rekening.
4. Setelah pembayaran masuk, staf menekan **Konfirmasi Pembayaran Diterima** (atau otomatis lunas jika menggunakan fitur *Konfirmasi Otomatis*).
5. Layar pelanggan menampilkan **"Pembayaran Berhasil"**, dan kasir bisa langsung **Cetak Struk** atau memulai **Transaksi Baru**.

### HP Posisi Landscape
Saat HP dimiringkan, tata letak otomatis menyesuaikan (menu ke sisi kiri, produk dan keranjang berdampingan):
- **Android (Chrome)**: ketuk ikon HP miring di bilah atas untuk layar penuh + kunci orientasi landscape.
- **iPhone**: matikan *Kunci Rotasi* di Control Center lalu miringkan HP.

### Cetak Struk Thermal
- **PC**: pasang driver printer thermal, atur lebar kertas (`58 mm` atau `80 mm`) di **Pengaturan → Toko & Struk**, lalu matikan opsi *Headers and footers* di dialog cetak Chrome/Edge.
- **Android**: gunakan aplikasi layanan cetak thermal Bluetooth seperti **RawBT**, lalu pilih sebagai printer saat mencetak dari Chrome.

### Konfirmasi Otomatis dari Notifikasi Android (Opsional)
Kasira dapat mengonfirmasi pembayaran secara otomatis berdasarkan notifikasi aplikasi merchant QRIS (seperti DANA Bisnis, GoPay Merchant, BCA Merchant, dll.) atau m-banking yang diteruskan dari HP Android.

1. Masuk sebagai **Admin** → **Pengaturan → Konfirmasi Otomatis**.
2. Aktifkan toggle **Aktifkan konfirmasi otomatis** dan salin **Alamat webhook** rahasia.
3. Di HP Android penerima notifikasi, install **MacroDroid** dari Play Store, lalu buat Macro baru:
   - **Trigger**: `Notification → Notification Received` → pilih **hanya** aplikasi merchant QRIS / m-banking Anda (berikan izin *Notification Access*, tidak perlu mengaktifkan *Accessibility*).
   - **Action**: `HTTP Request` metode `POST`, URL = alamat webhook Kasira, Content Type = `text/plain`, isi body:
     ```text
     {not_app_name}
     {not_title}
     {notification} {not_text_big}
     {not_timestamp}
     ```
4. Uji lewat **Test actions** di MacroDroid hingga muncul status **`Tes koneksi OK`** di Kasira, lalu uji format teks notifikasi melalui kolom **Uji teks notifikasi**.

> **Keamanan & Batasan:**
> - Hanya mendukung **Android** (iOS tidak mengizinkan aplikasi membaca notifikasi aplikasi lain).
> - Jika ada 2 atau lebih transaksi menunggu dengan nominal yang sama, Kasira **tidak menebak** dan akan meminta staf mengonfirmasi secara manual.
> - Notifikasi yang mengandung kata di daftar abaikan (*keluar, debit, gagal, refund*, dll.) otomatis dilewati.
> - Jika HP penerima notifikasi berada di luar Wi-Fi toko, gunakan alamat **Tailscale** atau server **HTTPS**.

---

## Hak Akses

| Fitur | Admin | Karyawan | Layar Pelanggan |
|---|:-:|:-:|:-:|
| Transaksi jual & buat pembayaran | ✓ | ✓ | – |
| Konfirmasi / batalkan pembayaran | ✓ | ✓ | – |
| Riwayat & cetak struk | ✓ | ✓ | – |
| Tambah / edit harga / hapus produk | ✓ | – | – |
| Pengaturan toko, QRIS, rekening, pengguna, auto-confirm | ✓ | – | – |
| Melihat pembayaran yang sedang berjalan | ✓ | ✓ | ✓ *(hanya baca)* |

---

## Variabel Lingkungan (Opsional)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server HTTP |
| `HOST` | `0.0.0.0` | Alamat antarmuka jaringan yang didengarkan |
| `DATA_DIR` | `./data` | Lokasi database SQLite (`kasira.db`) dan folder `uploads/` |
| `TRUST_PROXY` | – | Isi `1` jika dijalankan di belakang reverse proxy HTTPS (Nginx/Caddy/Cloudflare) |

---

## Backup & Restore Data

Seluruh data aplikasi tersimpan di folder `data/` (`data/kasira.db` dan `data/uploads/`).
- **Backup**: hentikan server terlebih dahulu, lalu salin seluruh folder `data/` ke tempat aman (flashdisk/Google Drive).
- **Restore**: hentikan server, timpa folder `data/` dengan hasil backup, lalu jalankan server kembali.

---

## Pengembangan & Pengujian

```bash
npm run dev    # jalankan server + Vite (hot reload) di http://localhost:3000
npm run build  # build frontend ke folder dist/
npm test       # jalankan uji konversi QRIS & parser notifikasi
```

**Struktur Proyek:**
- `server/` — Backend Express 5, Socket.IO, SQLite (`node:sqlite`), generator QRIS dinamis, & webhook notifikasi.
- `src/` — Frontend React 19 + Tailwind CSS v4 (Vite).
- `scripts/` — Skrip pengujian (`test-qris.mjs`, `test-notify.mjs`, `smoke-test.mjs`).

---

## Catatan QRIS

Kasira mengubah QRIS statis Anda menjadi QRIS dinamis secara lokal dengan menyisipkan nominal transaksi dan menghitung ulang checksum CRC16. Dana tetap masuk langsung ke akun merchant QRIS Anda sendiri. Coba terlebih dahulu dengan nominal kecil di beberapa aplikasi e-wallet / m-banking sebelum digunakan untuk operasional harian.

---

## Kontribusi & Lisensi

Kontribusi, laporan bug, dan saran fitur sangat diterima melalui [Issues](https://github.com/bobby175/kasira/issues) atau Pull Request.

Proyek ini dirilis dengan lisensi **MIT** — lihat berkas [LICENSE](LICENSE) untuk detail lengkap.
