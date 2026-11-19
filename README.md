# Uji AT Dashboard

Server pasangan untuk menguji firmware ESP-AT (ESP32) ke server sungguhan lewat internet:
TCP/SSL, HTTP client, MQTT (WS/WSS + broker publik), WebSocket, OTA, dan sertifikat (`AT+SYSMFG`).
ESP tidak perlu satu jaringan dengan server. Semua lalu lintas lewat Cloudflare Tunnel.

## Fitur

- **Tamu tanpa daftar**: siapa pun bisa klik "Mulai sebagai tamu" dan mendapat ID unik, endpoint sendiri
  (`/t/<id>/…`, `/ws/<id>`, `/ota/<id>/…`), serta akun MQTT sendiri yang hanya bisa mengakses `ujiat/<id>/#`.
  Data tamu hanya di memori: hilang saat server restart atau tidak dipakai lebih dari 24 jam.
  Kode tamu bisa dipakai untuk masuk lagi dari perangkat lain.
- **Admin**: data tersimpan di disk, bisa mengatur mode uji dan melihat daftar tamu aktif.
- **Tabel uji** (189 uji, 157 bisa otomatis) dengan kolom ID, prioritas, perintah, hasil diharapkan, status, hasil aktual.
- **Runner otomatis lewat Web Serial** (Chrome/Edge): mengirim AT ke ESP yang dicolok ke laptop,
  mencocokkan balasan serial dan bukti di server, lalu mengisi Lulus/Gagal.
- **Kontrol server**: kirim teks ke koneksi TCP tertahan atau klien WebSocket, publish MQTT ke ESP, respons HTTP custom.
- **OTA**: upload `.bin`, cek magic/ukuran partisi, file rusak, putus unduhan di persentase tertentu.
- **Laporan**: halaman laporan siap cetak/PDF (ringkasan per bagian, daftar gagal, detail) dan ekspor CSV, per putaran.

## Menjalankan

```bash
cp .env.example .env      # lalu isi semua nilai (gunakan sandi acak yang panjang)
docker compose up -d --build
docker compose logs -f app
```

Satu-satunya port yang dibuka: `127.0.0.1:8900`, untuk cloudflared di host yang sama.

### Variabel `.env`

| Nama | Keterangan |
|---|---|
| `PUBLIC_HOST` | Hostname publik, mis. `ujiat.example.com` |
| `ADMIN_USER`, `ADMIN_PASS` | Login admin |
| `SESSION_SECRET` | Kunci tanda tangan cookie (acak, ≥ 32 karakter) |
| `MQTT_DEVICE_USER`, `MQTT_DEVICE_PASS` | Akun MQTT untuk ESP milik admin |
| `MQTT_INTERNAL_USER`, `MQTT_INTERNAL_PASS` | Akun admin broker yang dipakai dashboard |
| `GUEST_MAX` (opsional) | Batas tamu aktif, bawaan 300 |
| `GUEST_IDLE_HOURS` (opsional) | Tamu dihapus setelah tidak aktif, bawaan 24 |
| `GUEST_PER_IP_HOUR` (opsional) | Batas pembuatan tamu per IP per jam, bawaan 10 |

## Cloudflare Tunnel

1. Zero Trust → Networks → Tunnels → Public Hostname: `<PUBLIC_HOST>` → `http://localhost:8900`.
   Jangan aktifkan Cloudflare Access (ESP tidak bisa login).
2. Bila zona memaksa HTTPS: buat Configuration Rule untuk path `/t/`, `/ws`, `/mqtt`, `/ota/`
   → Always Use HTTPS off, Browser Integrity Check off. Bot Fight Mode harus mati.
3. Keepalive MQTT/WS ≤ 60 detik (Cloudflare memutus koneksi diam ±100 detik).

## Jalur

| Path | Untuk |
|---|---|
| `/` | Dashboard (login admin / tamu) |
| `/t/<id>/*` | Endpoint uji: hello, echo, headers, sink, size, status, redirect, delay, chunked, hold, close, custom, basic |
| `/ws/<id>` | WebSocket echo + kiriman dari dashboard |
| `/mqtt` | MQTT over WebSocket ke Mosquitto (akun per pengguna via dynamic security) |
| `/ota/<id>/<file>.bin` | File OTA (mendukung Range) |

Yang tidak bisa lewat tunnel memakai server publik: `test.mosquitto.org` (MQTT 1883/8883/8884/8886/8887),
`broker.emqx.io`, `tcpbin.com` (TCP 4242 / TLS 4243). UDP belum tercakup.

## Cara menguji

1. Colok ESP ke laptop lewat USB-TTL di UART AT (ESP32-WROOM-32: GPIO16 RX, GPIO17 TX, GND).
2. Buka dashboard di Chrome/Edge di laptop itu → panel kanan → **Hubungkan**.
3. Tab **Pengaturan**: isi SSID dan password Wi-Fi.
4. Tab **Pengujian**: **▶ Jalankan** per uji atau per bagian. Uji manual (HP, Bluetooth) diisi sendiri.
5. Klik **Laporan** → Cetak / Simpan PDF.

## Struktur

```
app/src/server.js     server HTTP, endpoint uji, WS, proxy MQTT, OTA, laporan, akun tamu
app/src/tests.js      katalog uji + skrip runner
app/public/           dashboard (HTML/CSS/JS tanpa build step)
app/certs/            CA publik (ISRG, GTS, mosquitto.org) untuk diisi ke ESP
mosquitto/            konfigurasi broker (dynamic security)
```
