// Katalog uji Uji AT Dashboard.
// Kolom mengikuti tabel uji asli: ID, Prioritas, Uji, Perintah/langkah, Hasil diharapkan, Catatan dokumen.
//
// `run` (opsional) = skrip yang bisa dijalankan otomatis lewat Web Serial. Sintaks per baris:
//   AT...                 kirim perintah + CR LF, tunggu OK/ERROR/FAIL (atau '>' bila baris berikut '>>')
//   >> data               kirim data mentah (escape \r \n \t \0, {FILL:n:off}, {PEM:nama}), tunggu SEND OK/OK/ERROR
//   >>! data              kirim data mentah tanpa menunggu (passthrough, +++)
//   ?? regex              tunggu teks serial yang cocok
//   ?ev regex             tunggu event di server yang cocok (bukti sisi server)
//   ~ 1000                jeda (ms)
//   !hold-push teks | !hold-close | !ws-push teks | !ws-close | !mqtt-pub <own|mosquitto|emqx> <topic> <payload>
//   @loop N ... @end      ulangi blok
//   akhiran " ;t=30000"   batas waktu khusus (ms) untuk baris itu
// Placeholder: {HOST} {T}=/t/<id> {WS}=/ws/<id> {SSID} {PASS} {MQTT_USER} {MQTT_PASS} {TOPIC}=ujiat/<id> {TOPIC_ID}=<id> {OTA_FILE} {LEN}
// `expect` = regex untuk menentukan Lulus pada seluruh keluaran serial tes.

export const SECTIONS = [
  { id: '2.1', key: 'E', title: 'Dasar' },
  { id: '2.2', key: 'W', title: 'Wi-Fi station' },
  { id: '2.3', key: 'N', title: 'NTP dan DNS' },
  { id: '2.4', key: 'T', title: 'TCP / SSL klien ke server Uji AT', note: 'Target: {HOST} lewat Cloudflare (port 80 TCP, 443 SSL). Data TCP mentah harus berupa request HTTP dengan header Host. Echo publik: tcpbin.com.' },
  { id: '2.5', key: 'H', title: 'Hotspot (SoftAP + server)', note: 'Gunakan HP untuk menyambung, jalankan urutan persis seperti STM. Tidak melibatkan server.' },
  { id: '2.6', key: 'B', title: 'Bluetooth Classic (SPP)' },
  { id: '2.7', key: 'C', title: 'Bluetooth dan hotspot berjalan bersamaan', note: 'Paling berisiko karena berbagi radio dan RAM.' },
  { id: '2.8', key: 'X', title: 'Fitur tambahan (BLE dan MQTT)' },
  { id: '2.9', key: 'D', title: 'Perintah usang yang masih dipakai STM', note: 'Sudah tidak ada di dokumentasi.' },
  { id: '2.10', key: 'R', title: 'Ketahanan' },
  { id: '3.1', key: 'S', title: 'Sertifikat (AT+SYSMFG)', note: 'Isi slot CA/cert ESP sebelum tes verifikasi SSL, MQTT scheme 3/5/8, dan mTLS. File PEM ada di tab Sertifikat.' },
  { id: '3.2', key: 'M', title: 'MQTT lengkap', note: 'Broker sendiri: wss://{HOST}/mqtt (scheme 6/7/8). Broker publik: test.mosquitto.org dan broker.emqx.io (scheme 1-5). Topik: {TOPIC}/...' },
  { id: '3.3', key: 'P', title: 'HTTP client', note: 'Endpoint: http(s)://{HOST}{T}/... . http:// butuh Always Use HTTPS dimatikan untuk path {T}/* di Cloudflare.' },
  { id: '3.4', key: 'K', title: 'WebSocket client', note: 'Butuh firmware dengan perintah AT+WS* (ESP-AT v3.2+). Endpoint: ws(s)://{HOST}{WS}' },
  { id: '3.5', key: 'O', title: 'OTA (AT+USEROTA)', note: 'Upload .bin di tab OTA dulu. File disajikan di http(s)://{HOST}/ota/{TOPIC_ID}/<file>.' },
  { id: '3.6', key: 'U', title: 'UDP', note: 'Tidak bisa lewat Cloudflare Tunnel. Butuh VPS/port forward (opsi C) atau server lokal (opsi D).' },
];

const L = [];
function t(id, prio, name, cmd, exp, note = '', extra = {}) {
  L.push({ id, prio: !!prio, name, cmd, exp, note, ...extra });
}
const R = String.raw;

// ---------- 2.1 Dasar ----------
t('E-01', 0, 'Balas AT', 'AT', 'OK', '', { run: 'AT', expect: 'OK', init: ['Lulus'] });
t('E-02', 0, 'Versi firmware', 'AT+GMR', 'Versi AT core 2d59ec6 / ESP-IDF v5.1, lalu OK', '', { run: 'AT+GMR', expect: 'OK', init: ['Lulus'] });
t('E-03', 0, 'Daftar perintah', 'AT+CMD?', 'Daftar perintah, mengandung +BTINIT, +BTSPPSEND, +BLEINIT, +MQTTCONN, +CIPSTART, +MDNS, +UART. Tidak boleh ada +WPS, +PING (dimatikan)', '', { run: 'AT+CMD? ;t=15000', expect: R`^(?=[\s\S]*BTINIT)(?=[\s\S]*BTSPPSEND)(?=[\s\S]*BLEINIT)(?=[\s\S]*MQTTCONN)(?=[\s\S]*CIPSTART)(?=[\s\S]*MDNS)(?![\s\S]*\+WPS")(?![\s\S]*\+PING")[\s\S]*\r?\nOK`, init: ['Lulus'] });
t('E-04', 0, 'Echo mati', 'ATE0 lalu AT', 'OK; perintah tidak di-echo', '', { run: 'ATE0\nAT', expect: 'OK', init: ['Lulus'] });
t('E-05', 0, 'Echo nyala', 'ATE1 lalu AT', 'AT ikut tampil (echo), lalu OK', '', { run: 'ATE1\nAT', expect: R`(^|\n)AT\s*\n[\s\S]*OK`, init: ['Lulus'] });
t('E-06', 0, 'Status SYSSTORE', 'AT+SYSSTORE?', '+SYSSTORE:1 dan OK', '', { run: 'AT+SYSSTORE?', expect: R`\+SYSSTORE:1`, init: ['Lulus'] });
t('E-07', 0, 'Ganti SYSSTORE', 'AT+SYSSTORE=0, AT+SYSSTORE=1', 'Masing-masing OK', '', { run: 'AT+SYSSTORE=0\nAT+SYSSTORE=1', expect: 'OK', init: ['Lulus'] });
t('E-08', 0, 'Baca setelan UART', 'AT+UART?', '+UART:115200,8,1,0,<flow> dan OK', '', { run: 'AT+UART?', expect: R`\+UART:115200,8,1,0`, init: ['Lulus'] });
t('E-09', 1, 'UART tersimpan di flash', 'AT+UART=115200,8,1,0,0, reset ESP, AT+UART?', 'OK; setelah reset tetap 115200,8,1,0,0 (tersimpan di flash)', '', { init: ['Lulus'] });
t('E-10', 1, 'Waktu boot setelah reset', 'AT+RST', 'OK, log boot, ready. Catat waktu dari AT+RST sampai ready', 'Harus < 3 s (STM hanya menunggu 3 s)', { run: 'AT+RST\n?? ready ;t=5000', expect: 'ready', init: ['Lulus'] });
t('E-11', 1, 'Siap tepat 3 detik', 'Setelah E-10, kirim AT tepat 3 detik setelah AT+RST', 'OK', '', { run: 'AT+RST\n~ 3000\nAT', expect: R`ready[\s\S]*OK`, init: ['Lulus'] });
t('E-12', 0, 'Tidur dalam', 'AT+GSLP=5000', 'OK; ESP diam, lalu hidup lagi (ready) sekitar 5 detik kemudian', '', { run: 'AT+GSLP=5000\n?? ready ;t=12000', expect: 'ready', init: ['Lulus'] });

// ---------- 2.2 Wi-Fi station ----------
t('W-01', 0, 'Mode station', 'AT+CWMODE=1,0', 'OK', '', { run: 'AT+CWMODE=1,0', expect: 'OK', init: ['Lulus'] });
t('W-02', 0, 'Autoconnect mati', 'AT+CWAUTOCONN=0', 'OK', '', { run: 'AT+CWAUTOCONN=0', expect: 'OK', init: ['Lulus'] });
t('W-03', 0, 'Sambung Wi-Fi', 'AT+CWJAP="{SSID}","{PASS}"', 'WIFI CONNECTED, WIFI GOT IP, OK (dalam 10 detik)', '', { run: 'AT+CWJAP="{SSID}","{PASS}" ;t=25000', expect: R`WIFI GOT IP[\s\S]*OK`, init: ['Lulus'] });
t('W-04', 0, 'Cek AP tersambung', 'AT+CWJAP?', '+CWJAP:"<ssid>","<bssid>",... dan OK', '', { run: 'AT+CWJAP?', expect: R`\+CWJAP:"`, init: ['Lulus'] });
t('W-05', 0, 'Cek IP', 'AT+CIFSR', '+CIFSR:STAIP,"<ip>" (ada titik) dan OK', '', { run: 'AT+CIFSR', expect: R`STAIP,"\d+\.\d+\.\d+\.\d+"`, init: ['Lulus'] });
t('W-06', 0, 'Status sudah dapat IP', 'AT+CIPSTATUS', 'STATUS:2', '', { run: 'AT+CIPSTATUS', expect: 'STATUS:2', init: ['Lulus'] });
t('W-07', 0, 'Putus Wi-Fi', 'AT+CWQAP lalu AT+CWJAP?', 'OK; lalu No AP', '', { run: 'AT+CWQAP\nAT+CWJAP?', expect: 'OK', init: ['Lulus', 'AT+CWQAP membalas WIFI DISCONNECT lalu OK, dan AT+CWJAP? sesudahnya hanya OK.'] });
t('W-08', 0, 'Sandi salah', 'AT+CWJAP="{SSID}","salahpassword"', '+CWJAP:<kode> dan FAIL (bukan hang)', '', { run: 'AT+CWJAP="{SSID}","salahpassword" ;t=30000', expect: R`\+CWJAP:\d+[\s\S]*FAIL`, init: ['Lulus'] });
t('W-09', 0, 'SSID tidak ada', 'AT+CWJAP ke SSID yang tidak ada', '+CWJAP:1 atau +CWJAP:3 dan FAIL', '', { run: 'AT+CWJAP="ujiat-tidak-ada-xyz","12345678" ;t=30000', expect: R`\+CWJAP:[13][\s\S]*FAIL`, init: ['Lulus'] });
t('W-10', 0, 'Sambung ulang 10x', 'Sambung ulang 10x berturut-turut (W-03 lalu W-07)', 'Semua sukses; tidak ada reset sendiri', '', { run: '@loop 10\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\nAT+CWQAP\n@end', expect: 'OK', init: ['Lulus'] });
t('W-11', 0, 'Reset tanpa autoconnect', 'Reset ESP, lalu AT+CWJAP?', 'No AP (karena CWAUTOCONN=0 dan SYSSTORE)', '', { init: ['Lulus', 'Setelah reset CIFSR 0.0.0.0, tidak autoconnect, CWJAP? membalas OK saja, tanpa No AP'] });

// ---------- 2.3 NTP dan DNS ----------
t('N-01', 0, 'Atur server NTP', '(sudah tersambung Wi-Fi) AT+CIPSNTPCFG=1,0,"time.google.com","id.pool.ntp.org"', 'OK', '', { run: 'AT+CIPSNTPCFG=1,0,"time.google.com","id.pool.ntp.org"', expect: 'OK', init: ['Lulus', 'Balasan OK +TIME_UPDATED'] });
t('N-02', 1, 'Waktu NTP setelah 3 detik', 'Tunggu 3 detik, AT+CIPSNTPTIME?', '+CIPSNTPTIME:<hari bulan tanggal jam tahun> dan OK; tahun saat ini, bukan 1970', '', { run: '~ 3000\nAT+CIPSNTPTIME?', expect: R`\+CIPSNTPTIME:.*20[2-9]\d`, init: ['Lulus'] });
t('N-03', 1, 'Waktu sesaat setelah atur', 'Ulangi N-02 sesaat setelah N-01', 'Mungkin 1970; catat. STM sudah menunda 3 s', '', { init: ['Lulus'] });
t('N-04', 0, 'Server NTP cadangan', 'Pakai server NTP kedua saja (server pertama dibuat salah)', 'Tetap dapat waktu yang benar', '', { run: 'AT+CIPSNTPCFG=1,0,"ntp.salah.invalid","id.pool.ntp.org"\n~ 6000\nAT+CIPSNTPTIME?', expect: R`\+CIPSNTPTIME:.*20[2-9]\d`, init: ['Lulus'] });
t('N-05', 0, 'Zona waktu', 'Zona waktu 0 vs 7', 'Jam bergeser sesuai zona; STM menyesuaikan sendiri, cukup catat', '', { init: ['Lulus'] });
t('N-06', 0, 'DNS domain server', 'AT+CIPDOMAIN="{HOST}"', '+CIPDOMAIN:<ip> dan OK', 'IP yang keluar adalah IP Cloudflare, bukan IP server', { run: 'AT+CIPDOMAIN="{HOST}" ;t=15000', expect: R`\+CIPDOMAIN:"?\d+\.\d+`, });
t('N-07', 0, 'DNS domain tidak ada', 'AT+CIPDOMAIN="tidak-ada.ujiat.invalid"', 'ERROR (bukan hang)', '', { run: 'AT+CIPDOMAIN="tidak-ada.ujiat.invalid" ;t=20000', expect: 'ERROR' });
t('N-08', 0, 'PING dimatikan', 'AT+PING="{HOST}"', 'ERROR (perintah +PING memang dimatikan di build)', 'Lihat E-03', { run: 'AT+PING="{HOST}"', expect: 'ERROR' });

// ---------- 2.4 TCP / SSL ----------
t('T-01', 0, 'Mode koneksi tunggal', 'AT+CIPMUX?', '+CIPMUX:0 dan OK', '', { run: 'AT+CIPMUX?', expect: R`\+CIPMUX:0` });
t('T-02', 0, 'Sambung TCP', 'AT+CIPSTART="TCP","{HOST}",80', 'CONNECT, OK', 'Asli: ke laptop :8080. Sekarang ke server Uji AT lewat Cloudflare port 80', { run: 'AT+CIPSTART="TCP","{HOST}",80 ;t=20000', expect: 'CONNECT' });
t('T-03', 0, 'Status tersambung', 'AT+CIPSTATUS', 'STATUS:3', '', { run: 'AT+CIPSTATUS', expect: 'STATUS:3' });
t('T-04', 0, 'Kirim request (pengganti 18 byte)', 'AT+CIPSEND={LEN}, lalu kirim request HTTP ke {T}/hold', 'OK, >, Recv N bytes, SEND OK. Server menerima request (lihat log: hold)',
  'Cloudflare menolak request tanpa header Host, jadi 18 byte "GET / HTTP/1.0" diganti request lengkap. {T}/hold membuat koneksi tetap terbuka untuk T-05',
  { run: R`AT+CIPSEND={LEN}
>> GET {T}/hold HTTP/1.1\r\nHost: {HOST}\r\n\r\n
?ev hold open`, expect: 'SEND OK' });
t('T-05', 0, 'Balasan server', 'Server membalas teks (tombol "Kirim ke hold" di tab Kontrol)', 'ESP menampilkan +IPD,<len>:<teks>', '', { run: R`!hold-push Halo dari server UJIAT
?? Halo dari server`, expect: R`\+IPD,\d+:` });
t('T-06', 0, 'Tutup koneksi', 'AT+CIPCLOSE', 'CLOSED, OK', '', { run: 'AT+CIPCLOSE', expect: 'CLOSED' });
t('T-07', 0, 'Status setelah tutup', 'AT+CIPSTATUS setelah T-06', 'STATUS:4 atau STATUS:2', '', { run: 'AT+CIPSTATUS', expect: 'STATUS:[24]' });
t('T-08', 0, 'Kirim 1900 byte', 'Buka TCP, kirim header POST {T}/sink, lalu AT+CIPSEND=1900 dengan 1900 byte pola', 'SEND OK; server membalas RECV 1900 UTUH', 'Ukuran potongan maksimal STM. Server memeriksa pola byte per byte',
  { run: R`AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 1900\r\nConnection: close\r\n\r\n
AT+CIPSEND=1900
>> {FILL:1900:0}
?? RECV 1900 UTUH ;t=15000`, expect: 'RECV 1900 UTUH' });
t('T-09', 1, 'Kirim 4 x 1900 byte', 'Kirim 4 potongan x 1900 byte berurutan dalam satu request (Content-Length 7600)', 'Semua SEND OK, server membalas RECV 7600 UTUH', '',
  { run: R`AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 7600\r\nConnection: close\r\n\r\n
AT+CIPSEND=1900
>> {FILL:1900:0}
AT+CIPSEND=1900
>> {FILL:1900:1900}
AT+CIPSEND=1900
>> {FILL:1900:3800}
AT+CIPSEND=1900
>> {FILL:1900:5700}
?? RECV 7600 UTUH ;t=15000`, expect: 'RECV 7600 UTUH' });
t('T-10', 0, 'Host tidak ada', 'AT+CIPSTART="TCP","192.0.2.1",80', 'ERROR atau CLOSED dalam waktu wajar (bukan hang)', '192.0.2.1 = alamat TEST-NET yang tidak bisa dijangkau', { run: 'AT+CIPSTART="TCP","192.0.2.1",80 ;t=40000', expect: 'ERROR|CLOSED' });
t('T-11', 0, 'Port tertutup', 'AT+CIPSTART="TCP","{HOST}",81', 'ERROR / CLOSED', 'Cloudflare tidak melayani port 81', { run: 'AT+CIPSTART="TCP","{HOST}",81 ;t=40000', expect: 'ERROR|CLOSED' });
t('T-12', 0, 'Server menutup koneksi', 'Buka TCP, GET {T}/hold (Connection: close), lalu server menutup dari dashboard', 'ESP menampilkan CLOSED; AT+CIPSTATUS = STATUS:4', '',
  { run: R`AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> GET {T}/hold HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?ev hold open
~ 1000
!hold-close
?? CLOSED ;t=15000
AT+CIPSTATUS`, expect: R`CLOSED[\s\S]*STATUS:[24]` });
t('T-13', 0, 'Sambung SSL', 'AT+CIPSTART="SSL","{HOST}",443', 'CONNECT, OK (bisa 3 sampai 8 detik)', '', { run: 'AT+CIPSTART="SSL","{HOST}",443 ;t=25000', expect: 'CONNECT' });
t('T-14', 1, 'GET lewat SSL', 'Kirim request GET {T}/hello lewat CIPSEND di koneksi SSL', 'SEND OK, balasan +IPD... berisi HTTP/1.1 200', '',
  { run: R`AT+CIPSEND={LEN}
>> GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? HTTP/1.1 200 ;t=15000`, expect: 'HTTP/1.1 200' });
t('T-15', 0, 'Sertifikat bermasalah', 'AT+CIPSTART="SSL","test.mosquitto.org",8887 (sertifikat sengaja kedaluwarsa)', 'Tetap CONNECT (karena verifikasi server tidak aktif), catat', 'Pakai server publik test.mosquitto.org:8887',
  { run: 'AT+CIPSSLCCONF=0\nAT+CIPSTART="SSL","test.mosquitto.org",8887 ;t=25000\n~ 500\nAT+CIPCLOSE', expect: 'CONNECT' });
t('T-16', 1, 'SSL 20x berulang', 'Buka SSL, kirim, tutup, ulang 20x', 'Semua sukses, tidak ada kebocoran memori (AT+SYSRAM? stabil)', 'Bandingkan SYSRAM awal dan akhir',
  { run: R`AT+SYSRAM?
@loop 20
AT+CIPSTART="SSL","{HOST}",443 ;t=25000
AT+CIPSEND={LEN}
>> GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? CLOSED ;t=15000
@end
AT+SYSRAM?`, expect: 'SYSRAM' });
t('T-17', 0, 'SSL dengan SNI', 'AT+CIPSSLCSNI="{HOST}" lalu CIPSTART SSL', 'CONNECT', '', { run: 'AT+CIPSSLCSNI="{HOST}"\nAT+CIPSTART="SSL","{HOST}",443 ;t=25000\nAT+CIPCLOSE', expect: 'CONNECT' });
t('T-18', 0, 'SSL dengan ALPN', 'AT+CIPSSLCALPN=1,"http/1.1" lalu CIPSTART SSL', 'CONNECT', '', { run: 'AT+CIPSSLCALPN=1,"http/1.1"\nAT+CIPSTART="SSL","{HOST}",443 ;t=25000\nAT+CIPCLOSE', expect: 'CONNECT' });
t('T-19', 1, 'SSL verifikasi server (CA benar)', 'AT+CIPSSLCCONF=2,0,0 lalu CIPSTART SSL ke {HOST}', 'CONNECT (CA bundle di slot client_ca.0)', 'Butuh S-02. Kembalikan dengan AT+CIPSSLCCONF=0',
  { run: 'AT+CIPSSLCCONF=2,0,0\nAT+CIPSTART="SSL","{HOST}",443 ;t=25000\nAT+CIPCLOSE\nAT+CIPSSLCCONF=0', expect: 'CONNECT' });
t('T-20', 0, 'SSL verifikasi gagal (cert kedaluwarsa)', 'AT+CIPSSLCCONF=2,0,1 lalu SSL ke test.mosquitto.org:8887', 'ERROR / CLOSED (ditolak, bukan hang)', 'Butuh S-03 (CA mosquitto.org di slot 1)',
  { run: 'AT+CIPSSLCCONF=2,0,1\nAT+CIPSTART="SSL","test.mosquitto.org",8887 ;t=25000\nAT+CIPSSLCCONF=0', expect: 'ERROR|CLOSED' });
t('T-21', 0, 'Passthrough (CIPMODE=1)', 'AT+CIPMODE=1, CIPSTART, AT+CIPSEND, kirim request, +++ keluar', 'Balasan hello muncul, setelah +++ kembali ke mode perintah', '',
  { run: R`AT+CIPMODE=1
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND
>>! GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? hello ;t=15000
~ 1200
>>! +++
~ 1200
AT+CIPMODE=0`, expect: 'hello' });
t('T-22', 0, 'Terima pasif (CIPRECVMODE=1)', 'AT+CIPRECVMODE=1, GET {T}/size/3000, AT+CIPRECVLEN?, AT+CIPRECVDATA', '+CIPRECVLEN:<n> lalu +CIPRECVDATA:<len>,...', '',
  { run: R`AT+CIPRECVMODE=1
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> GET {T}/size/3000 HTTP/1.1\r\nHost: {HOST}\r\n\r\n
~ 2500
AT+CIPRECVLEN?
AT+CIPRECVDATA=1460
AT+CIPCLOSE
AT+CIPRECVMODE=0`, expect: R`\+CIPRECVDATA:` });
t('T-23', 0, 'TCP echo publik', 'AT+CIPSTART="TCP","tcpbin.com",4242, kirim teks', '+IPD berisi teks yang sama', 'Port selain 80/443 memakai server publik tcpbin.com',
  { run: R`AT+CIPSTART="TCP","tcpbin.com",4242 ;t=20000
AT+CIPSEND={LEN}
>> halo ujiat\n
?? \+IPD ;t=10000
AT+CIPCLOSE`, expect: R`\+IPD,\d+:halo ujiat` });
t('T-24', 0, 'SSL echo publik', 'AT+CIPSTART="SSL","tcpbin.com",4243, kirim teks', '+IPD berisi teks yang sama', '',
  { run: R`AT+CIPSTART="SSL","tcpbin.com",4243 ;t=25000
AT+CIPSEND={LEN}
>> halo ssl\n
?? \+IPD ;t=10000
AT+CIPCLOSE`, expect: R`\+IPD,\d+:halo ssl` });

// ---------- 2.5 Hotspot ----------
t('H-01', 0, 'Echo dan SYSSTORE mati', 'ATE0, AT+SYSSTORE=0', 'Masing-masing OK', '', { run: 'ATE0\nAT+SYSSTORE=0', expect: 'OK' });
t('H-02', 0, 'Mode SoftAP', 'AT+CWMODE=2', 'OK', '', { run: 'AT+CWMODE=2', expect: 'OK' });
t('H-03', 0, 'Atur SSID hotspot', 'AT+CWSAP="MERTANI-TEST","mertani123",6,3,2', 'OK', '', { run: 'AT+CWSAP="MERTANI-TEST","mertani123",6,3,2', expect: 'OK' });
t('H-04', 0, 'Atur IP AP', 'AT+CIPAP="192.168.4.1","192.168.4.1","255.255.255.0"', 'OK', '', { run: 'AT+CIPAP="192.168.4.1","192.168.4.1","255.255.255.0"', expect: 'OK' });
t('H-05', 0, 'Multi koneksi', 'AT+CIPMUX=1', 'OK', '', { run: 'AT+CIPMUX=1', expect: 'OK' });
t('H-06', 0, 'Tanpa info IP di IPD', 'AT+CIPDINFO=0', 'OK', '', { run: 'AT+CIPDINFO=0', expect: 'OK' });
t('H-07', 0, 'Mode terima pasif', 'AT+CIPRECVMODE=1', 'OK', '', { run: 'AT+CIPRECVMODE=1', expect: 'OK' });
t('H-08', 0, 'Batas koneksi server', 'AT+CIPSERVERMAXCONN=4', 'OK', 'Harus sebelum CIPSERVER', { run: 'AT+CIPSERVERMAXCONN=4', expect: 'OK' });
t('H-09', 0, 'Nyalakan server', 'AT+CIPSERVER=1,80', 'OK', '', { run: 'AT+CIPSERVER=1,80', expect: 'OK' });
t('H-10', 0, 'Batas waktu koneksi', 'AT+CIPSTO=90', 'OK', '', { run: 'AT+CIPSTO=90', expect: 'OK' });
t('H-11', 0, 'Nama mDNS', 'AT+MDNS=1,"mertani","_http",80', 'OK', '', { run: 'AT+MDNS=1,"mertani","_http",80', expect: 'OK' });
t('H-12', 0, 'HP melihat SSID', 'HP mencari Wi-Fi', 'SSID MERTANI-TEST terlihat, kanal 6, WPA2');
t('H-13', 0, 'HP menyambung', 'HP menyambung dengan sandi mertani123', 'ESP menampilkan +STA_CONNECTED:"<mac>"');
t('H-14', 0, 'Buka halaman', 'HP membuka http://192.168.4.1', 'ESP menampilkan 0,CONNECT lalu +IPD,0,<len>');
t('H-15', 0, 'Panjang data masuk', 'AT+CIPRECVLEN?', '+CIPRECVLEN:<len>,0,0,0,0 dan OK', '', { run: 'AT+CIPRECVLEN?', expect: R`\+CIPRECVLEN:` });
t('H-16', 0, 'Baca data masuk', 'AT+CIPRECVDATA=0,1024', '+CIPRECVDATA:<len>,GET / HTTP/1.1... dan OK', '', { run: 'AT+CIPRECVDATA=0,1024', expect: R`\+CIPRECVDATA:\d+,GET` });
t('H-17', 0, 'Kirim 60 byte ke HP', 'AT+CIPSEND=0,60, kirim 60 byte', '>, lalu SEND OK; HP menerima', '', { run: 'AT+CIPSEND=0,60\n>> {FILL:60:0}', expect: 'SEND OK' });
t('H-18', 1, 'Kirim 2048 byte ke HP', 'AT+CIPSEND=0,2048, kirim 2048 byte', 'SEND OK', 'Ukuran potongan maksimal STM', { run: 'AT+CIPSEND=0,2048\n>> {FILL:2048:0}', expect: 'SEND OK' });
t('H-19', 0, 'Tutup koneksi', 'AT+CIPCLOSE=0', '0,CLOSED, OK', '', { run: 'AT+CIPCLOSE=0', expect: '0,CLOSED' });
t('H-20', 0, 'Batas jumlah HP', 'HP kedua menyambung (batas MAXSTA=2), HP ketiga', 'HP ketiga ditolak');
t('H-21', 0, 'Koneksi diam 90 detik', 'Biarkan koneksi diam 90 detik', 'ESP menutup sendiri (0,CLOSED) karena CIPSTO=90');
t('H-22', 0, 'Akses lewat mDNS', 'http://mertani.local dari HP/laptop yang mendukung mDNS', 'Terbuka (tidak wajib di semua Android)');
t('H-23', 0, 'Matikan hotspot', 'AT+CIPSERVER=0,1, AT+CIPSERVERMAXCONN, AT+CIPMUX=0, AT+CWMODE=0, ATE1, AT+SYSSTORE=1', 'Semuanya OK; SSID hilang dari daftar Wi-Fi', '',
  { run: 'AT+CIPSERVER=0,1\nAT+CIPMUX=0\nAT+CWMODE=0\nATE1\nAT+SYSSTORE=1', expect: 'OK' });
t('H-24', 0, 'Nyala-mati 10x', 'Ulangi H-01 sampai H-11 lalu H-23 sebanyak 10x (nyalakan lalu matikan)', 'Selalu sukses');

// ---------- 2.6 Bluetooth Classic ----------
t('B-01', 0, 'Init Bluetooth', 'AT+BTINIT=1', 'OK', 'Kalau ERROR, BT Classic tidak ter-build', { run: 'AT+BTINIT=1', expect: 'OK' });
t('B-02', 0, 'Init SPP slave', 'AT+BTSPPINIT=2', 'OK', '', { run: 'AT+BTSPPINIT=2', expect: 'OK' });
t('B-03', 0, 'Mulai SPP', 'AT+BTSPPSTART', 'OK', '', { run: 'AT+BTSPPSTART', expect: 'OK' });
t('B-04', 0, 'Atur nama', 'AT+BTNAME="TEST-BT"', 'OK', '', { run: 'AT+BTNAME="TEST-BT"', expect: 'OK' });
t('B-05', 0, 'Baca nama', 'AT+BTNAME?', '+BTNAME:"TEST-BT" dan OK', '', { run: 'AT+BTNAME?', expect: R`\+BTNAME:"TEST-BT"` });
t('B-06', 0, 'Bisa ditemukan', 'AT+BTSCANMODE=2', 'OK', '', { run: 'AT+BTSCANMODE=2', expect: 'OK' });
t('B-07', 0, 'Atur PIN', 'AT+BTSECPARAM=3,1,"1234"', 'OK', '', { run: 'AT+BTSECPARAM=3,1,"1234"', expect: 'OK' });
t('B-08', 0, 'HP menemukan perangkat', 'HP mencari perangkat Bluetooth', 'TEST-BT terlihat');
t('B-09', 0, 'Pairing dan sambung SPP', 'HP pairing dengan PIN 1234, lalu sambung SPP', 'ESP menampilkan +BTSPPCONN:0,"<mac>"');
t('B-10', 0, 'Cek koneksi SPP', 'AT+BTSPPCONN?', '+BTSPPCONN:0,"<mac>" dan OK', '', { run: 'AT+BTSPPCONN?', expect: R`\+BTSPPCONN:0,"` });
t('B-11', 0, 'Data dari HP', 'Ketik teks di HP', 'ESP menampilkan teksnya (+BTDATA:<len>,<teks>)');
t('B-12', 0, 'Masuk passthrough', 'AT+BTSPPSEND', '>');
t('B-13', 0, 'Kirim data dan keluar', 'Ketik teks HALO, tunggu 1 detik, kirim +++ (tanpa CR/LF)', 'HP menerima HALO; ESP kembali ke mode perintah');
t('B-14', 0, 'Perintah setelah passthrough', 'AT setelah B-13', 'OK');
t('B-15', 1, 'Blok besar 20 KB', 'Kirim blok besar sekitar 20 KB (seperti isi BLUETOOTH_DAT.TXT) lewat passthrough', 'HP menerima utuh, urutan benar');
t('B-16', 0, 'HP memutus koneksi', 'HP memutus koneksi', 'ESP menampilkan +BTSPPDISCONN:0,"<mac>"');
t('B-17', 0, 'Sambung ulang', 'HP menyambung lagi tanpa re-init', 'Berhasil');
t('B-18', 0, 'Matikan Bluetooth', 'AT+BTINIT=0', 'OK; TEST-BT hilang dari pencarian HP', '', { run: 'AT+BTINIT=0', expect: 'OK' });
t('B-19', 0, 'Nyala-mati 10x', 'Ulangi B-01 sampai B-07, lalu B-18, sebanyak 10x', 'Selalu sukses');
t('B-20', 0, 'PIN salah', 'Salah PIN saat pairing', 'Pairing gagal, ESP tidak hang');

// ---------- 2.7 BT + hotspot ----------
t('C-01', 1, 'Nyalakan keduanya', 'Jalankan B-01 sampai B-07, lalu H-02 sampai H-11 (tanpa AT+RST di antaranya)', 'Semua OK');
t('C-02', 0, 'Dua HP sekaligus', 'HP-A menyambung Bluetooth, HP-B menyambung hotspot dan membuka halaman', 'Keduanya jalan, tidak ada reset');
t('C-03', 0, 'Data besar bersamaan', 'Kirim data besar lewat Bluetooth sambil HP-B memuat halaman', 'Tidak ada data hilang atau reset');
t('C-04', 0, 'Matikan BT, hotspot tetap', 'AT+BTINIT=0 saat hotspot masih menyala', 'OK; hotspot tetap jalan');
t('C-05', 0, 'Matikan hotspot, BT tetap', 'Matikan hotspot (H-23) saat Bluetooth masih tersambung', 'OK; Bluetooth tetap tersambung', 'Catat bila ada masalah');
t('C-06', 0, 'Stabil 10 menit', 'Biarkan keduanya menyala 10 menit', 'Stabil, tidak ada reset sendiri');
t('C-07', 1, 'Sisa RAM', 'AT+SYSRAM? saat keduanya menyala', '+SYSRAM:<sisa> > 20 KB; catat angkanya', '', { run: 'AT+SYSRAM?', expect: R`\+SYSRAM:` });

// ---------- 2.8 BLE dan MQTT ----------
t('X-01', 0, 'Init BLE', 'AT+BLEINIT=2', 'OK', '', { run: 'AT+BLEINIT=2', expect: 'OK' });
t('X-02', 0, 'Iklan BLE', 'AT+BLEADVSTART', 'OK; terlihat di aplikasi scanner BLE', '', { run: 'AT+BLEADVSTART', expect: 'OK' });
t('X-03', 0, 'Matikan BLE', 'AT+BLEINIT=0', 'OK', '', { run: 'AT+BLEINIT=0', expect: 'OK' });
t('X-04', 0, 'Konfigurasi MQTT', 'AT+MQTTUSERCFG=0,1,"esp32","","",0,0,""', 'OK', 'Scheme 1 (TCP) ke broker publik', { run: 'AT+MQTTUSERCFG=0,1,"esp32-{TOPIC_ID}","","",0,0,""', expect: 'OK' });
t('X-05', 0, 'Sambung broker', 'AT+MQTTCONN=0,"test.mosquitto.org",1883,1', '+MQTTCONNECTED:0,1,... dan OK', 'Broker publik (TCP 1883 tidak bisa lewat tunnel)', { run: 'AT+MQTTCONN=0,"test.mosquitto.org",1883,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('X-06', 0, 'Publish MQTT', 'AT+MQTTPUB=0,"{TOPIC}/test","halo",1,0', 'OK; broker menerima (terlihat di log server)', '', { run: 'AT+MQTTPUB=0,"{TOPIC}/test","halo",1,0\n?ev mqtt mosquitto .*\\/test halo ;t=15000', expect: 'OK' });
t('X-07', 0, 'Subscribe MQTT', 'AT+MQTTSUB=0,"{TOPIC}/test",1 lalu publish dari dashboard', '+MQTTSUBRECV:0,"{TOPIC}/test",4,halo', '',
  { run: 'AT+MQTTSUB=0,"{TOPIC}/test",1\n~ 1000\n!mqtt-pub mosquitto {TOPIC}/test halo\n?? \\+MQTTSUBRECV ;t=15000', expect: R`\+MQTTSUBRECV:0,"[^"]+",4,halo` });
t('X-08', 0, 'Bersihkan MQTT', 'AT+MQTTCLEAN=0', 'OK', '', { run: 'AT+MQTTCLEAN=0', expect: 'OK' });
t('X-09', 0, 'HTTP GET (opsional)', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/get",,,2', '+HTTPCLIENT:<len>,<data> dan OK', 'Hanya jika HTTP dinyalakan', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/get",,,2 ;t=30000', expect: R`\+HTTPCLIENT:\d+,` });
t('X-10', 0, 'HTTP POST (opsional)', 'AT+HTTPCLIENT=3,0,"https://{HOST}{T}/post",,,2,"a=1"', '+HTTPCLIENT:... dan OK; server menerima body', 'Hanya jika HTTP dinyalakan', { run: 'AT+HTTPCLIENT=3,0,"https://{HOST}{T}/post",,,2,"a=1" ;t=30000\n?ev http POST {T}/post', expect: R`a=1` });

// ---------- 2.9 Usang ----------
t('D-01', 1, 'AT+UART lama', 'AT+UART=115200,8,1,0,0', 'OK', 'Pengganti: AT+UART_DEF', { run: 'AT+UART=115200,8,1,0,0', expect: 'OK' });
t('D-02', 1, 'AT+CIPSTATUS lama', 'AT+CIPSTATUS', 'STATUS:<angka>', 'Pengganti: AT+CIPSTATE?', { run: 'AT+CIPSTATUS', expect: R`STATUS:\d` });
t('D-03', 1, 'AT+CIPRECVMODE lama', 'AT+CIPRECVMODE=1, AT+CIPRECVMODE=0', 'OK', 'Pengganti: AT+CIPRECVTYPE', { run: 'AT+CIPRECVMODE=1\nAT+CIPRECVMODE=0', expect: 'OK' });

// ---------- 2.10 Ketahanan ----------
t('R-01', 0, 'Perintah salah', 'Kirim perintah salah, misalnya AT+ASAL', 'ERROR; perintah berikutnya tetap jalan', '', { run: 'AT+ASAL\nAT', expect: R`ERROR[\s\S]*OK` });
t('R-02', 0, '100 perintah AT', 'Kirim 100 perintah AT beruntun, jeda 100 ms', '100x OK', '', { run: '@loop 100\nAT\n~ 100\n@end', expect: 'OK' });
t('R-03', 0, 'Perintah panjang', 'Kirim perintah panjang (sekitar 250 karakter)', 'OK atau ERROR, tidak hang', '', { run: 'AT+CWJAP="' + 'x'.repeat(230) + '","12345678" ;t=30000\nAT', expect: 'OK' });
t('R-04', 0, 'Cabut-pasang listrik', 'Cabut dan pasang listrik 10x', 'Selalu hidup dan menjawab AT');
t('R-05', 0, 'Uji 1 jam', 'Wi-Fi + TCP + CIPSEND terus-menerus selama 1 jam (ke {T}/sink)', 'Tidak ada reset sendiri; AT+SYSRAM? tidak turun terus', 'Skrip: 360 putaran x 10 detik',
  { run: R`AT+SYSRAM?
@loop 360
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 1900\r\nConnection: close\r\n\r\n
AT+CIPSEND=1900
>> {FILL:1900:0}
?? CLOSED ;t=15000
AT+SYSRAM?
~ 8000
@end`, expect: 'SYSRAM' });
t('R-06', 1, 'Ukuran esp-at.bin', 'Cek ukuran build/esp-at.bin (tab OTA menampilkan ukuran file yang di-upload)', '< 1.572.864 byte; catat sisa');

// ---------- 3.1 Sertifikat ----------
t('S-01', 0, 'Lihat namespace sertifikat', 'AT+SYSMFG?', 'Daftar namespace (client_ca, client_cert, client_key, ...) dan OK', 'Butuh firmware dengan AT+SYSMFG (ESP-AT v3.x+)', { run: 'AT+SYSMFG?', expect: 'client_ca' });
t('S-02', 1, 'Tulis CA bundle Cloudflare ke slot 0', 'AT+SYSMFG=2,"client_ca","client_ca.0",8,{LEN} lalu kirim PEM bundle', 'OK', 'Bundle: ISRG Root X1/X2 + GTS Root R1/R4 (sertifikat yang dipakai Cloudflare). Menimpa CA bawaan Espressif',
  { run: 'AT+SYSMFG=2,"client_ca","client_ca.0",8,{LEN}\n>> {PEM:ca_bundle}', expect: 'OK' });
t('S-03', 0, 'Tulis CA mosquitto.org ke slot 1', 'AT+SYSMFG=2,"client_ca","client_ca.1",8,{LEN} lalu kirim PEM', 'OK', 'Untuk test.mosquitto.org port 8883/8884/8887',
  { run: 'AT+SYSMFG=2,"client_ca","client_ca.1",8,{LEN}\n>> {PEM:mosquitto_org}', expect: 'OK' });
t('S-04', 0, 'Tulis client cert ke slot 0', 'AT+SYSMFG=2,"client_cert","client_cert.0",8,{LEN} lalu kirim PEM', 'OK', 'Buat dulu di tab Sertifikat (ditandatangani test.mosquitto.org)',
  { run: 'AT+SYSMFG=2,"client_cert","client_cert.0",8,{LEN}\n>> {PEM:client_cert}', expect: 'OK' });
t('S-05', 0, 'Tulis client key ke slot 0', 'AT+SYSMFG=2,"client_key","client_key.0",8,{LEN} lalu kirim PEM', 'OK', '',
  { run: 'AT+SYSMFG=2,"client_key","client_key.0",8,{LEN}\n>> {PEM:client_key}', expect: 'OK' });
t('S-06', 0, 'Baca balik CA slot 0', 'AT+SYSMFG=1,"client_ca","client_ca.0"', 'Isi PEM sama dengan yang ditulis', '', { run: 'AT+SYSMFG=1,"client_ca","client_ca.0" ;t=15000', expect: 'BEGIN CERTIFICATE' });

// ---------- 3.2 MQTT ----------
const own7 = 'AT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=25000';
t('M-01', 1, 'Broker sendiri WSS (scheme 7)', own7.replace('\n', ', '), '+MQTTCONNECTED:0,7,... dan OK; server mencatat klien baru', 'Lewat tunnel. Keepalive default 120 s; Cloudflare memutus WS diam ~100 s, jadi atur M-12',
  { run: 'AT+MQTTCLEAN=0\n' + own7 + '\n?ev mqttlog .*ujiat-', expect: R`\+MQTTCONNECTED:0` });
t('M-02', 1, 'Publish QoS 0/1/2', 'AT+MQTTPUB=0,"{TOPIC}/up","q0",0,0 ... q1 ... q2', 'Tiga kali OK; dashboard menerima q0, q1, q2', '',
  { run: 'AT+MQTTPUB=0,"{TOPIC}/up","q0",0,0\nAT+MQTTPUB=0,"{TOPIC}/up","q1",1,0\nAT+MQTTPUB=0,"{TOPIC}/up","q2",2,0\n?ev mqtt own .*\\/up q2', expect: 'OK' });
t('M-03', 1, 'Subscribe + kiriman dari server', 'AT+MQTTSUB=0,"{TOPIC}/down",1, lalu dashboard publish', '+MQTTSUBRECV:0,"{TOPIC}/down",<len>,halo-esp', '',
  { run: 'AT+MQTTSUB=0,"{TOPIC}/down",1\n~ 800\n!mqtt-pub own {TOPIC}/down halo-esp\n?? \\+MQTTSUBRECV ;t=15000', expect: R`\+MQTTSUBRECV:0,"[^"]+",8,halo-esp` });
t('M-04', 0, 'Retain', 'AT+MQTTPUB=0,"{TOPIC}/retain","tetap",1,1', 'OK; event server bertanda retain saat subscribe ulang', '', { run: 'AT+MQTTPUB=0,"{TOPIC}/retain","tetap",1,1\n?ev mqtt own .*\\/retain tetap', expect: 'OK' });
t('M-05', 1, 'PUBRAW payload besar 2000 byte', 'AT+MQTTPUBRAW=0,"{TOPIC}/raw",2000,1,0 lalu kirim 2000 byte', '+MQTTPUB:OK; server menerima 2000 byte, pola UTUH', '',
  { run: 'AT+MQTTPUBRAW=0,"{TOPIC}/raw",2000,1,0\n>> {FILL:2000:0}\n?ev mqtt own .*\\/raw \\[2000 B UTUH\\]', expect: R`\+MQTTPUB:OK|OK` });
t('M-06', 0, 'Unsubscribe', 'AT+MQTTUNSUB=0,"{TOPIC}/down"', 'OK; kiriman berikutnya tidak diterima ESP', '', { run: 'AT+MQTTUNSUB=0,"{TOPIC}/down"', expect: 'OK' });
t('M-07', 0, 'Lihat koneksi & sub', 'AT+MQTTCONN? dan AT+MQTTSUB?', 'Status koneksi dan daftar topik', '', { run: 'AT+MQTTCONN?\nAT+MQTTSUB?', expect: R`\+MQTTCONN:0` });
t('M-08', 1, 'Last Will (LWT)', 'MQTTCONNCFG LWT "offline", sambung, lalu AT+RST tanpa disconnect', 'Dashboard menerima {TOPIC}/status offline (~30 s)', 'keepalive 20 s → broker menyatakan mati setelah 1,5x',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONNCFG=0,20,0,"{TOPIC}/status","offline",1,0\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=25000\nAT+MQTTPUB=0,"{TOPIC}/status","online",1,0\n~ 1000\nAT+RST\n?? ready ;t=8000\n?ev mqtt own .*\\/status offline ;t=60000', expect: 'ready' });
t('M-09', 0, 'Broker sendiri WS tanpa TLS (scheme 6)', 'AT+MQTTUSERCFG=0,6,...,"/mqtt", AT+MQTTCONN=0,"{HOST}",80,1', '+MQTTCONNECTED', 'Butuh Always Use HTTPS dimatikan untuk /mqtt',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,6,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONN=0,"{HOST}",80,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-10', 1, 'Broker sendiri WSS verifikasi (scheme 8)', 'AT+MQTTUSERCFG=0,8,...,0,0,"/mqtt" (CA slot 0)', '+MQTTCONNECTED', 'Butuh S-02',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,8,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-11', 0, 'Sandi MQTT salah', 'Scheme 7 dengan sandi salah', 'Gagal sambung (ERROR / +MQTTDISCONNECTED), tidak hang', '',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","salah",0,0,"/mqtt"\nAT+MQTTCONN=0,"{HOST}",443,0 ;t=25000', expect: R`ERROR|DISCONNECTED` });
t('M-12', 0, 'Keepalive 60 s (aman untuk Cloudflare)', 'AT+MQTTCONNCFG=0,60,1,"","",0,0 sebelum MQTTCONN, lalu diam 3 menit', 'Tetap tersambung, tidak ada +MQTTDISCONNECTED', '',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONNCFG=0,60,1,"","",0,0\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=25000\n~ 180000\nAT+MQTTCONN?', expect: R`\+MQTTCONN:0,[4-6]` });
t('M-13', 0, 'Sambung ulang otomatis', 'Saat tersambung, AT+CWQAP lalu sambung Wi-Fi lagi', '+MQTTDISCONNECTED lalu +MQTTCONNECTED sendiri (reconnect=1)', '',
  { run: 'AT+CWQAP\n?? MQTTDISCONNECTED ;t=20000\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\n?? \\+MQTTCONNECTED ;t=60000', expect: R`\+MQTTCONNECTED` });
t('M-14', 0, 'Publik TCP (scheme 1)', 'test.mosquitto.org:1883', '+MQTTCONNECTED; pub terlihat di dashboard', '',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,1,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",1883,1 ;t=25000\nAT+MQTTPUB=0,"{TOPIC}/s1","tcp",1,0\n?ev mqtt mosquitto .*\\/s1 tcp', expect: R`\+MQTTCONNECTED:0` });
t('M-15', 0, 'Publik TLS tanpa verifikasi (scheme 2)', 'test.mosquitto.org:8883', '+MQTTCONNECTED', '',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,2,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8883,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-16', 0, 'Publik TLS verifikasi (scheme 3)', 'test.mosquitto.org:8886 (cert Let\'s Encrypt, CA slot 0)', '+MQTTCONNECTED', 'Butuh S-02',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,3,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8886,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-17', 1, 'Publik mTLS client cert (scheme 4)', 'test.mosquitto.org:8884 dengan client cert slot 0', '+MQTTCONNECTED', 'Butuh S-04 dan S-05',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,4,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8884,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-18', 0, 'Publik mTLS + verifikasi (scheme 5)', 'test.mosquitto.org:8884, cert slot 0, CA slot 1', '+MQTTCONNECTED', 'Butuh S-03, S-04, S-05',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,5,"ujiat-{TOPIC_ID}","","",0,1,""\nAT+MQTTCONN=0,"test.mosquitto.org",8884,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-19', 0, 'Verifikasi menolak cert kedaluwarsa', 'scheme 3, CA slot 1, test.mosquitto.org:8887', 'Gagal sambung (bukan hang)', 'Butuh S-03',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,3,"ujiat-{TOPIC_ID}","","",0,1,""\nAT+MQTTCONN=0,"test.mosquitto.org",8887,0 ;t=25000', expect: R`ERROR|DISCONNECTED` });
t('M-20', 0, 'Broker cadangan (EMQX)', 'broker.emqx.io:1883 scheme 1', '+MQTTCONNECTED; pub terlihat di dashboard', '',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,1,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"broker.emqx.io",1883,1 ;t=25000\nAT+MQTTPUB=0,"{TOPIC}/emqx","ok",1,0\n?ev mqtt emqx .*\\/emqx ok', expect: R`\+MQTTCONNECTED:0` });
t('M-21', 0, 'SNI dan ALPN MQTT', 'AT+MQTTSNI=0,"{HOST}" dan AT+MQTTALPN=0,1,"mqtt" sebelum MQTTCONN', 'OK; tetap tersambung', 'Perintah opsional, tergantung build',
  { run: 'AT+MQTTCLEAN=0\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTSNI=0,"{HOST}"\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=25000', expect: R`\+MQTTCONNECTED:0` });
t('M-22', 0, 'Bersihkan', 'AT+MQTTCLEAN=0', 'OK', '', { run: 'AT+MQTTCLEAN=0', expect: 'OK' });

// ---------- 3.3 HTTP client ----------
t('P-01', 0, 'GET http://', 'AT+HTTPCLIENT=2,0,"http://{HOST}{T}/hello",,,1', '+HTTPCLIENT:5,hello', 'Butuh Always Use HTTPS dimatikan untuk {T}/*', { run: 'AT+HTTPCLIENT=2,0,"http://{HOST}{T}/hello",,,1 ;t=30000', expect: R`\+HTTPCLIENT:5,hello` });
t('P-02', 1, 'GET https://', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/hello",,,2', '+HTTPCLIENT:5,hello', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/hello",,,2 ;t=30000', expect: R`\+HTTPCLIENT:5,hello` });
t('P-03', 1, 'POST form', 'AT+HTTPCLIENT=3,0,"https://{HOST}{T}/echo",,,2,"a=1&b=2"', 'Balasan echo berisi a=1&b=2; server mencatat POST', '', { run: 'AT+HTTPCLIENT=3,0,"https://{HOST}{T}/echo",,,2,"a=1&b=2" ;t=30000\n?ev http POST {T}/echo', expect: 'a=1&b=2' });
t('P-04', 0, 'PUT JSON', 'AT+HTTPCLIENT=4,1,"https://{HOST}{T}/echo",,,2,"{\\"x\\":1}"', 'Echo berisi PUT dan {"x":1}', '', { run: 'AT+HTTPCLIENT=4,1,"https://{HOST}{T}/echo",,,2,"{\\"x\\":1}" ;t=30000', expect: 'PUT' });
t('P-05', 0, 'DELETE', 'AT+HTTPCLIENT=5,0,"https://{HOST}{T}/echo",,,2', 'Echo berisi DELETE', '', { run: 'AT+HTTPCLIENT=5,0,"https://{HOST}{T}/echo",,,2 ;t=30000', expect: 'DELETE' });
t('P-06', 0, 'HEAD', 'AT+HTTPCLIENT=1,0,"https://{HOST}{T}/hello",,,2', 'OK tanpa body', '', { run: 'AT+HTTPCLIENT=1,0,"https://{HOST}{T}/hello",,,2 ;t=30000', expect: 'OK' });
t('P-07', 0, 'Ukuran resource', 'AT+HTTPGETSIZE="https://{HOST}{T}/size/4096"', '+HTTPGETSIZE:4096', '', { run: 'AT+HTTPGETSIZE="https://{HOST}{T}/size/4096" ;t=30000', expect: R`\+HTTPGETSIZE:4096` });
t('P-08', 1, 'Unduh 10 KB (HTTPCGET)', 'AT+HTTPCGET="https://{HOST}{T}/size/10000"', 'Beberapa +HTTPCGET:<len>,... lalu OK', '', { run: 'AT+HTTPCGET="https://{HOST}{T}/size/10000" ;t=40000', expect: R`\+HTTPCGET:\d+,[\s\S]*OK` });
t('P-09', 1, 'Upload 1900 byte (HTTPCPOST)', 'AT+HTTPCPOST="https://{HOST}{T}/sink",1900 lalu kirim 1900 byte', 'SEND OK; server: sink 1900 B UTUH', '',
  { run: 'AT+HTTPCPOST="https://{HOST}{T}/sink",1900 ;t=30000\n>> {FILL:1900:0}\n?ev sink 1900 B UTUH', expect: 'SEND OK' });
t('P-10', 0, 'Upload PUT (HTTPCPUT)', 'AT+HTTPCPUT="https://{HOST}{T}/sink",1000 lalu kirim 1000 byte', 'SEND OK; server: sink 1000 B UTUH', 'Perintah ada di ESP-AT v3.x+',
  { run: 'AT+HTTPCPUT="https://{HOST}{T}/sink",1000 ;t=30000\n>> {FILL:1000:0}\n?ev sink 1000 B UTUH', expect: 'SEND OK' });
t('P-11', 0, 'Header custom (HTTPCHEAD)', 'AT+HTTPCHEAD={LEN} lalu "X-Ujiat: 123", kemudian GET {T}/headers', 'Balasan berisi x-ujiat: 123', '',
  { run: 'AT+HTTPCHEAD={LEN}\n>> X-Ujiat: 123\nAT+HTTPCLIENT=2,0,"https://{HOST}{T}/headers",,,2 ;t=30000\nAT+HTTPCHEAD=0', expect: 'x-ujiat: 123' });
t('P-12', 0, 'Redirect 2x', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/redirect/2",,,2', 'Mengikuti redirect, akhirnya hello', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/redirect/2",,,2 ;t=30000', expect: 'hello' });
t('P-13', 0, 'Status 404', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/status/404",,,2', 'ERROR (bukan hang)', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/status/404",,,2 ;t=30000', expect: 'ERROR' });
t('P-14', 0, 'Status 500', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/status/500",,,2', 'ERROR (bukan hang)', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/status/500",,,2 ;t=30000', expect: 'ERROR' });
t('P-15', 0, 'Respons lambat 5 s', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/delay/5000",,,2', 'Tetap menerima hello', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/delay/5000",,,2 ;t=40000', expect: 'hello' });
t('P-16', 0, 'Respons sangat lambat 40 s', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/delay/40000",,,2', 'ERROR (timeout) atau hello; catat waktunya, tidak hang', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/delay/40000",,,2 ;t=90000', expect: 'ERROR|hello' });
t('P-17', 0, 'Chunked', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/chunked",,,2', 'Data chunk-1 sampai chunk-5', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/chunked",,,2 ;t=30000', expect: 'chunk-5' });
t('P-18', 0, 'Basic auth', 'AT+HTTPCHEAD Authorization: Basic ..., GET {T}/basic', 'AUTH OK', 'user ujiat / sandi ujiat123',
  { run: 'AT+HTTPCHEAD={LEN}\n>> Authorization: Basic dWppYXQ6dWppYXQxMjM=\nAT+HTTPCLIENT=2,0,"https://{HOST}{T}/basic",,,2 ;t=30000\nAT+HTTPCHEAD=0', expect: 'AUTH OK' });
t('P-19', 0, 'URL panjang (HTTPURLCFG)', 'AT+HTTPURLCFG={LEN} lalu URL 300+ karakter, kemudian AT+HTTPCGET=""', 'Echo berisi query panjang', '',
  { run: 'AT+HTTPURLCFG={LEN}\n>> https://{HOST}{T}/echo?q={FILL:300:0}\nAT+HTTPCGET="" ;t=30000', expect: 'q=0123' });
t('P-20', 0, 'Respons custom', 'Atur status/body di tab Kontrol, lalu GET {T}/custom', 'Sesuai yang diatur di dashboard', '', { run: 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/custom",,,2 ;t=30000', expect: R`\+HTTPCLIENT:` });

// ---------- 3.4 WebSocket ----------
t('K-01', 0, 'Konfigurasi WS', 'AT+WSCFG=0,30,60,4096', 'OK', '', { run: 'AT+WSCFG=0,30,60,4096', expect: 'OK' });
t('K-02', 1, 'Buka ws://', 'AT+WSOPEN=0,"ws://{HOST}{WS}"', '+WS_CONNECTED:0', 'Butuh Always Use HTTPS dimatikan untuk /ws', { run: 'AT+WSOPEN=0,"ws://{HOST}{WS}" ;t=25000', expect: R`\+WS_CONNECTED:0` });
t('K-03', 1, 'Kirim & echo', 'AT+WSSEND=0,{LEN} lalu "halo ws"', '+WS_DATA:0,<len>,ECHO:halo ws', '', { run: 'AT+WSSEND=0,{LEN}\n>> halo ws\n?? WS_DATA ;t=10000', expect: R`\+WS_DATA:0,\d+,ECHO:halo ws` });
t('K-04', 0, 'Kiriman dari server', 'Tombol "Kirim ke WS" di tab Kontrol', '+WS_DATA:0,<len>,Halo dari server', '', { run: '!ws-push Halo dari server\n?? Halo dari server ;t=10000', expect: R`\+WS_DATA:0` });
t('K-05', 0, 'Frame 2000 byte', 'AT+WSSEND=0,2000 lalu 2000 byte', 'Server: ws 2000 B UTUH', '', { run: 'AT+WSSEND=0,2000\n>> {FILL:2000:0}\n?ev ws .*2000 B UTUH', expect: 'OK' });
t('K-06', 0, 'Server menutup WS', 'Tombol "Tutup WS" di tab Kontrol', '+WS_DISCONNECTED / +WS_CLOSED', '', { run: '!ws-close\n?? WS_(DIS)?C ;t=15000', expect: R`\+WS_(DISCONNECTED|CLOSED)` });
t('K-07', 1, 'Buka wss://', 'AT+WSOPEN=0,"wss://{HOST}{WS}"', '+WS_CONNECTED:0', '', { run: 'AT+WSOPEN=0,"wss://{HOST}{WS}" ;t=25000', expect: R`\+WS_CONNECTED:0` });
t('K-08', 0, 'Header custom (WSHEAD)', 'AT+WSHEAD={LEN} lalu "X-Ujiat-WS: 7", kemudian WSOPEN', 'Log server menampilkan header x-ujiat-ws', '',
  { run: 'AT+WSCLOSE=0\nAT+WSHEAD={LEN}\n>> X-Ujiat-WS: 7\nAT+WSOPEN=0,"wss://{HOST}{WS}" ;t=25000\n?ev ws open .*x-ujiat-ws', expect: R`\+WS_CONNECTED:0` });
t('K-09', 0, 'Tutup dari ESP', 'AT+WSCLOSE=0', 'OK / +WS_CLOSED:0', '', { run: 'AT+WSCLOSE=0', expect: 'OK|WS_CLOSED' });

// ---------- 3.5 OTA ----------
t('O-01', 1, 'Siapkan firmware', 'Upload esp-at.bin (aplikasi, bukan factory) di tab OTA dan pilih sebagai file aktif', 'File tampil, magic 0xE9, ukuran < 1.572.864 byte');
t('O-02', 1, 'OTA lewat HTTPS', 'AT+USEROTA={LEN} lalu URL https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}', 'Unduhan 100% di log server, ESP restart, ready', 'Cek sintaks di dokumentasi versi firmware',
  { run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ready ;t=300000\n?ev ota .*selesai', expect: 'ready' });
t('O-03', 0, 'OTA lewat HTTP', 'AT+USEROTA={LEN} lalu URL http://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}', 'Unduhan 100%, ESP restart', 'Butuh Always Use HTTPS dimatikan untuk /ota/*',
  { run: 'AT+USEROTA={LEN}\n>> http://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ready ;t=300000', expect: 'ready' });
t('O-04', 0, 'File rusak', 'Buat file rusak di tab OTA, lalu AT+USEROTA ke rusak.bin', 'ERROR; ESP tetap jalan dengan firmware lama', '',
  { run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/rusak.bin\n?? ERROR|FAIL ;t=120000\nAT', expect: 'ERROR|FAIL' });
t('O-05', 0, 'Unduhan terputus', 'Atur "Putus OTA di 50%" di tab OTA, lalu OTA', 'ERROR; ESP tetap firmware lama', 'Kembalikan ke 0% setelah selesai',
  { run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ERROR|FAIL ;t=300000\nAT', expect: 'ERROR|FAIL' });
t('O-06', 0, 'Versi setelah OTA', 'AT+GMR', 'Versi sesuai firmware baru', '', { run: 'AT+GMR', expect: 'OK' });

// ---------- 3.6 UDP ----------
t('U-01', 0, 'UDP kirim/terima', 'AT+CIPSTART="UDP","<server>",<port>', 'Tidak bisa diuji lewat tunnel', 'Butuh opsi C (VPS) atau D (server lokal)');

export const TESTS = L;
