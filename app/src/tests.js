// Katalog uji Uji AT Dashboard (umum untuk firmware ESP-AT ESP32).
//
// Kolom: ID, prioritas (★), uji, perintah/langkah, hasil diharapkan, catatan.
// Kunci tambahan:
//   run       skrip runner (sintaks di app/public/assets/runner.js)
//   expect    regex penentu Lulus atas keluaran serial uji
//   requires  ID uji prasyarat; bila prasyarat Gagal/Lewati, uji ini otomatis Lewati
//   human     uji butuh tindakan orang (HP, cabut daya, dsb.) -> dilewati saat "Jalankan semua" kecuali dipilih
//   long      uji > 1 menit -> dilewati saat "Jalankan semua" kecuali dipilih
//   needs     'net' (Wi-Fi + internet) / 'wifi' -> runner memastikan koneksi dulu (otomatis bila tidak diisi)
//   precheck  'otaFile' | 'cert:<key>'
// Placeholder: {HOST} {T}=/t/<id> {WS}=/ws/<id> {TOPIC}=ujiat/<id> {TOPIC_ID} {MQTT_USER} {MQTT_PASS}
//              {SSID} {PASS} {BT_NAME} {BT_PIN} {AP_SSID} {AP_PASS} {AP_CH} {BLE_NAME} {MDNS} {OTA_FILE} {LEN}

export const SECTIONS = [
  { id: '1', key: 'E', title: 'Dasar & sistem' },
  { id: '2', key: 'F', title: 'Deteksi fitur firmware', note: 'Memeriksa AT+CMD?. Bila sebuah fitur tidak ada (Gagal), semua uji yang bergantung padanya otomatis Lewati.' },
  { id: '3', key: 'W', title: 'Wi-Fi station' },
  { id: '4', key: 'N', title: 'Waktu (SNTP) & DNS' },
  { id: '5', key: 'T', title: 'TCP & SSL klien', note: 'Target: {HOST} lewat Cloudflare (TCP port 80, SSL port 443). Data TCP mentah berupa request HTTP berheader Host. Port lain memakai server publik tcpbin.com.' },
  { id: '6', key: 'U', title: 'UDP', note: 'Memakai server NTP publik (UDP port 123) sebagai lawan bicara.' },
  { id: '7', key: 'S', title: 'Sertifikat (AT+SYSMFG)', note: 'SSL klien (CIPSTART) memakai namespace client_*, MQTT memakai mqtt_*. PEM ditulis dengan akhiran \\0.' },
  { id: '8', key: 'M', title: 'MQTT', note: 'Broker server ini: wss://{HOST}/mqtt (scheme 6/7/8). Broker publik: test.mosquitto.org dan broker.emqx.io (scheme 1-5). Topik: {TOPIC}/...' },
  { id: '9', key: 'P', title: 'HTTP client', note: 'Endpoint: http(s)://{HOST}{T}/...' },
  { id: '10', key: 'K', title: 'WebSocket client', note: 'Endpoint: ws(s)://{HOST}{WS}' },
  { id: '11', key: 'MD', title: 'mDNS' },
  { id: '12', key: 'PS', title: 'Hemat daya' },
  { id: '13', key: 'H', title: 'Hotspot (SoftAP) & server TCP lokal', note: 'SSID {AP_SSID}. Uji bertanda "butuh HP" memerlukan HP/laptop yang menyambung ke hotspot ESP.' },
  { id: '14', key: 'L', title: 'Bluetooth LE' },
  { id: '15', key: 'B', title: 'Bluetooth Classic (SPP)', note: 'Nama {BT_NAME}, PIN {BT_PIN}.' },
  { id: '16', key: 'C', title: 'Bluetooth + hotspot bersamaan', note: 'Berbagi radio dan RAM: paling berisiko.' },
  { id: '17', key: 'FS', title: 'Sistem berkas (FATFS)' },
  { id: '18', key: 'O', title: 'OTA (AT+USEROTA)', note: 'Upload .bin di tab OTA dulu. File disajikan di http(s)://{HOST}/ota/{TOPIC_ID}/<file>. OTA mengganti firmware ESP.' },
  { id: '19', key: 'D', title: 'Perintah lama (kompatibilitas)', note: 'Perintah yang sudah tidak ada di dokumentasi terbaru tapi mungkin masih dipakai host lama.' },
  { id: '20', key: 'R', title: 'Ketahanan' },
];

const L = [];
function t(id, prio, name, cmd, exp, note = '', extra = {}) {
  L.push({ id, prio: !!prio, name, cmd, exp, note, ...extra });
}
const R = String.raw;
const HP = 'HP/laptop menyambung ke hotspot ESP';
const CLEAN_TCP = '- AT+CIPCLOSE\n- AT+CIPMODE=0';
const CLEAN_MQTT = '- AT+MQTTCLEAN=0';
// Sambung ke broker server ini (WSS, keepalive 60 s aman untuk Cloudflare)
const OWN_WSS = `${CLEAN_MQTT}
AT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"
AT+MQTTCONNCFG=0,60,1,"","",0,0
AT+MQTTCONN=0,"{HOST}",443,1 ;t=30000`;
const feat = (cmdName) => ({ run: 'AT+CMD? ;t=15000', expect: `"AT\\+${cmdName}"` });

// ======================================================================= 1. Dasar & sistem
t('E-01', 1, 'Balas AT', 'AT', 'OK', '', { run: 'AT', expect: 'OK' });
t('E-02', 1, 'Versi firmware', 'AT+GMR', 'AT version, SDK version, compile time, lalu OK', 'Versi dicatat di laporan', { run: 'AT+GMR', expect: 'AT version:' });
t('E-03', 0, 'Daftar perintah', 'AT+CMD?', 'Daftar +CMD:<n>,"AT...",... lalu OK', 'Dipakai bagian Deteksi fitur', { run: 'AT+CMD? ;t=15000', expect: R`\+CMD:\d+,"AT"[\s\S]*\nOK` });
t('E-04', 0, 'Echo mati', 'ATE0 lalu AT', 'OK; perintah tidak di-echo', '', { run: 'ATE0\nAT', expect: R`OK[\s\S]*OK` });
t('E-05', 0, 'Echo nyala', 'ATE1 lalu AT', 'AT ikut tampil (echo), lalu OK', '', { run: 'ATE1\nAT', expect: R`(^|\n)AT\s*\n[\s\S]*OK` });
t('E-06', 0, 'Status penyimpanan setelan', 'AT+SYSSTORE?', '+SYSSTORE:<0|1> dan OK', '', { run: 'AT+SYSSTORE?', expect: R`\+SYSSTORE:[01]` });
t('E-07', 0, 'Ganti penyimpanan setelan', 'AT+SYSSTORE=0, AT+SYSSTORE=1', 'Masing-masing OK', '', { run: 'AT+SYSSTORE=0\nAT+SYSSTORE=1', expect: R`OK[\s\S]*OK` });
t('E-08', 0, 'Setelan UART sekarang', 'AT+UART_CUR?', '+UART_CUR:<baud>,8,1,0,<flow>', 'Baud bisa tampil sedikit beda (mis. 115201) karena pembulatan clock', { run: 'AT+UART_CUR?', expect: R`\+UART_CUR:\d+,8,1,0,\d` });
t('E-09', 0, 'Setelan UART tersimpan', 'AT+UART_DEF?', '+UART_DEF:<baud>,8,1,0,<flow>', '', { run: 'AT+UART_DEF?', expect: R`\+UART_DEF:\d+,8,1,0,\d` });
t('E-10', 1, 'Restart & waktu boot', 'AT+RST', 'OK, log boot, ready', 'Durasi tercatat di hasil aktual; bandingkan dengan batas tunggu host-mu', { run: 'AT+RST\n?? ready ;t=8000', expect: 'ready' });
t('E-11', 1, 'Siap 3 detik setelah restart', 'AT+RST, tunggu 3 s, kirim AT', 'ready lalu OK', '', { run: 'AT+RST\n~ 3000\nAT', expect: R`ready[\s\S]*OK` });
t('E-12', 0, 'Deep sleep 5 detik', 'AT+GSLP=5000', 'OK; ESP diam lalu boot ulang (ready) ±5 s kemudian', '', { run: 'AT+GSLP=5000\n?? ready ;t=15000', expect: 'ready' });
t('E-13', 1, 'Sisa RAM', 'AT+SYSRAM?', '+SYSRAM:<sisa>,<minimum>', 'Catat angkanya', { run: 'AT+SYSRAM?', expect: R`\+SYSRAM:\d+` });
t('E-14', 0, 'Partisi flash', 'AT+SYSFLASH?', 'Daftar partisi +SYSFLASH:...', '', { run: 'AT+SYSFLASH?', expect: R`\+SYSFLASH:` });
t('E-15', 0, 'Mode pesan sistem', 'AT+SYSMSG?', '+SYSMSG:<n>', '', { run: 'AT+SYSMSG?', expect: R`\+SYSMSG:\d` });
t('E-16', 0, 'Daya RF', 'AT+RFPOWER?', '+RFPOWER:<wifi>,<ble>,<bt>', '', { run: 'AT+RFPOWER?', expect: R`\+RFPOWER:` });
t('E-17', 0, 'Log error', 'AT+SYSLOG?', '+SYSLOG:<0|1>', '', { run: 'AT+SYSLOG?', expect: R`\+SYSLOG:[01]` });
t('E-18', 0, 'Timestamp sistem', 'AT+SYSTIMESTAMP?', '+SYSTIMESTAMP:<detik>', '', { run: 'AT+SYSTIMESTAMP?', expect: R`\+SYSTIMESTAMP:\d+` });
t('E-19', 0, 'RAM pengguna', 'AT+USERRAM?', '+USERRAM:<ukuran> atau ERROR bila tidak didukung', 'Opsional', { run: 'AT+USERRAM?', expect: R`\+USERRAM:|ERROR` });
t('E-20', 0, 'Kembali ke setelan pabrik', 'AT+RESTORE', 'OK lalu ready; semua setelan tersimpan terhapus', 'Menghapus setelan Wi-Fi, UART, dll.', { run: 'AT+RESTORE\n?? ready ;t=10000', expect: 'ready', human: 'menghapus semua setelan tersimpan' });

// ======================================================================= 2. Deteksi fitur
t('F-01', 1, 'Fitur Wi-Fi', 'AT+CMD? berisi AT+CWMODE', 'Ada', '', feat('CWMODE'));
t('F-02', 1, 'Fitur TCP/IP', 'AT+CMD? berisi AT+CIPSTART', 'Ada', '', feat('CIPSTART'));
t('F-03', 0, 'Fitur SSL', 'AT+CMD? berisi AT+CIPSSLCCONF', 'Ada', '', feat('CIPSSLCCONF'));
t('F-04', 1, 'Fitur MQTT', 'AT+CMD? berisi AT+MQTTCONN', 'Ada', '', feat('MQTTCONN'));
t('F-05', 1, 'Fitur HTTP client', 'AT+CMD? berisi AT+HTTPCLIENT', 'Ada', '', feat('HTTPCLIENT'));
t('F-06', 0, 'Fitur WebSocket', 'AT+CMD? berisi AT+WSOPEN', 'Ada', '', feat('WSOPEN'));
t('F-07', 0, 'Fitur BLE', 'AT+CMD? berisi AT+BLEINIT', 'Ada', '', feat('BLEINIT'));
t('F-08', 0, 'Fitur Bluetooth Classic', 'AT+CMD? berisi AT+BTINIT', 'Ada', '', feat('BTINIT'));
t('F-09', 0, 'Fitur BT SPP', 'AT+CMD? berisi AT+BTSPPINIT', 'Ada', '', feat('BTSPPINIT'));
t('F-10', 0, 'Fitur mDNS', 'AT+CMD? berisi AT+MDNS', 'Ada', '', feat('MDNS'));
t('F-11', 0, 'Fitur SNTP', 'AT+CMD? berisi AT+CIPSNTPCFG', 'Ada', '', feat('CIPSNTPCFG'));
t('F-12', 0, 'Fitur PING', 'AT+CMD? berisi AT+PING', 'Ada', 'Sebagian build sengaja mematikannya', feat('PING'));
t('F-13', 0, 'Fitur sistem berkas', 'AT+CMD? berisi AT+FS', 'Ada', '', feat('FS'));
t('F-14', 0, 'Fitur penyimpanan sertifikat', 'AT+CMD? berisi AT+SYSMFG', 'Ada', '', feat('SYSMFG'));
t('F-15', 0, 'Fitur OTA dari URL', 'AT+CMD? berisi AT+USEROTA', 'Ada', '', feat('USEROTA'));
t('F-16', 0, 'Fitur WPS', 'AT+CMD? berisi AT+WPS', 'Ada', 'Sebagian build sengaja mematikannya', feat('WPS'));
t('F-17', 0, 'Fitur SmartConfig', 'AT+CMD? berisi AT+CWSTARTSMART', 'Ada', '', feat('CWSTARTSMART'));
t('F-18', 0, 'Fitur Web server', 'AT+CMD? berisi AT+WEBSERVER', 'Ada', '', feat('WEBSERVER'));
t('F-19', 0, 'Fitur hemat daya', 'AT+CMD? berisi AT+SLEEP', 'Ada', '', feat('SLEEP'));
t('F-20', 0, 'Fitur Ethernet', 'AT+CMD? berisi AT+CIPETH', 'Ada', 'Hanya build dengan PHY Ethernet', feat('CIPETH'));

// ======================================================================= 3. Wi-Fi station
const W = { requires: ['F-01'] };
t('W-01', 0, 'Mode station', 'AT+CWMODE=1,0', 'OK', '', { ...W, run: 'AT+CWMODE=1,0', expect: 'OK' });
t('W-02', 0, 'Autoconnect mati', 'AT+CWAUTOCONN=0', 'OK', '', { ...W, run: 'AT+CWAUTOCONN=0', expect: 'OK' });
t('W-03', 0, 'Pindai jaringan', 'AT+CWLAP', 'Daftar +CWLAP:(...)', '', { ...W, run: 'AT+CWLAP ;t=20000', expect: R`\+CWLAP:\(` });
t('W-04', 0, 'Pindai SSID tertentu', 'AT+CWLAP="{SSID}"', '+CWLAP berisi "{SSID}"', '', { ...W, run: 'AT+CWLAP="{SSID}" ;t=20000', expect: R`\+CWLAP:\(\d+,"{SSID}"` });
t('W-05', 1, 'Sambung Wi-Fi', 'AT+CWJAP="{SSID}","{PASS}"', 'WIFI CONNECTED, WIFI GOT IP, OK', '', { ...W, run: 'AT+CWJAP="{SSID}","{PASS}" ;t=25000', expect: R`WIFI GOT IP[\s\S]*OK` });
t('W-06', 0, 'Cek AP tersambung', 'AT+CWJAP?', '+CWJAP:"{SSID}",...', '', { ...W, needs: 'wifi', run: 'AT+CWJAP?', expect: R`\+CWJAP:"{SSID}"` });
t('W-07', 0, 'Status Wi-Fi', 'AT+CWSTATE?', '+CWSTATE:2,"{SSID}"', '2 = tersambung dan dapat IP', { ...W, needs: 'wifi', run: 'AT+CWSTATE?', expect: R`\+CWSTATE:2` });
t('W-08', 0, 'Alamat IP', 'AT+CIFSR', '+CIFSR:STAIP,"<ip>"', '', { ...W, needs: 'wifi', run: 'AT+CIFSR', expect: R`STAIP,"(?!0\.0\.0\.0)\d+\.\d+\.\d+\.\d+"` });
t('W-09', 0, 'IP, gateway, netmask', 'AT+CIPSTA?', '+CIPSTA:ip / gateway / netmask', '', { ...W, needs: 'wifi', run: 'AT+CIPSTA?', expect: R`\+CIPSTA:gateway:"\d` });
t('W-10', 0, 'MAC station', 'AT+CIPSTAMAC?', '+CIPSTAMAC:"xx:xx:..."', '', { ...W, run: 'AT+CIPSTAMAC?', expect: R`\+CIPSTAMAC:"[0-9a-f:]{17}"` });
t('W-11', 0, 'Hostname', 'AT+CWHOSTNAME="ujiat-esp", lalu AT+CWHOSTNAME?', '+CWHOSTNAME:ujiat-esp', '', { ...W, run: 'AT+CWHOSTNAME="ujiat-esp"\nAT+CWHOSTNAME?', expect: R`\+CWHOSTNAME:"?ujiat-esp` });
t('W-12', 0, 'Kode negara', 'AT+CWCOUNTRY?', '+CWCOUNTRY:...', '', { ...W, run: 'AT+CWCOUNTRY?', expect: R`\+CWCOUNTRY:` });
t('W-13', 0, 'Status DHCP', 'AT+CWDHCP?', '+CWDHCP:<n>', '', { ...W, run: 'AT+CWDHCP?', expect: R`\+CWDHCP:\d` });
t('W-14', 0, 'Setelan sambung ulang', 'AT+CWRECONNCFG?', '+CWRECONNCFG:<interval>,<repeat>', '', { ...W, run: 'AT+CWRECONNCFG?', expect: R`\+CWRECONNCFG:\d+,\d+` });
t('W-15', 0, 'Status koneksi (lama)', 'AT+CIPSTATUS', 'STATUS:2 saat sudah dapat IP', '', { ...W, needs: 'wifi', run: `${CLEAN_TCP}\nAT+CIPSTATUS`, expect: R`STATUS:[24]` });
t('W-16', 0, 'Putus Wi-Fi', 'AT+CWQAP, lalu AT+CWJAP?', 'OK; CWJAP? tidak menunjukkan AP (No AP atau hanya OK)', 'Uji berikutnya yang butuh internet akan menyambung ulang otomatis', { ...W, run: 'AT+CWQAP\nAT+CWJAP?', expect: R`AT\+CWJAP\?(?![\s\S]*\+CWJAP:")[\s\S]*OK|No AP` });
t('W-17', 0, 'Sandi salah', 'AT+CWJAP="{SSID}","sandi-salah-xyz"', '+CWJAP:<kode> lalu FAIL/ERROR (tidak hang)', '', { ...W, run: '- AT+CWQAP\nAT+CWJAP="{SSID}","sandi-salah-xyz" ;t=30000', expect: R`\+CWJAP:\d+[\s\S]*(FAIL|ERROR)` });
t('W-18', 0, 'SSID tidak ada', 'AT+CWJAP ke SSID yang tidak ada', '+CWJAP:1/3 lalu FAIL/ERROR', '', { ...W, run: 'AT+CWJAP="ujiat-tidak-ada-xyz","12345678" ;t=30000', expect: R`\+CWJAP:[134][\s\S]*(FAIL|ERROR)` });
t('W-19', 0, 'Sambung-putus 10x', 'AT+CWJAP lalu AT+CWQAP, 10 kali', 'Semua sukses, tidak restart sendiri', '', { ...W, run: '@loop 10\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\nAT+CWQAP\n@end', expect: R`WIFI GOT IP`, long: true });
t('W-20', 0, 'Restart tanpa autoconnect', 'AT+CWAUTOCONN=0, AT+RST, AT+CWJAP?', 'Setelah ready tidak tersambung otomatis', '', { ...W, run: 'AT+CWAUTOCONN=0\nAT+RST\n?? ready ;t=8000\n~ 3000\nAT+CWJAP?', expect: R`ready(?![\s\S]*WIFI GOT IP)[\s\S]*AT\+CWJAP\?(?![\s\S]*\+CWJAP:")` });
t('W-21', 0, 'Restart dengan autoconnect', 'Sambung, AT+CWAUTOCONN=1, AT+RST', 'Setelah ready muncul WIFI GOT IP sendiri; lalu autoconnect dimatikan lagi', 'Butuh AT+SYSSTORE=1', { ...W, run: 'AT+SYSSTORE=1\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\nAT+CWAUTOCONN=1\nAT+RST\n?? WIFI GOT IP ;t=25000\nAT+CWAUTOCONN=0', expect: R`ready[\s\S]*WIFI GOT IP` });
t('W-22', 0, 'Opsi tampilan pindai', 'AT+CWLAPOPT=1,31', 'OK', '', { ...W, run: 'AT+CWLAPOPT=1,31', expect: 'OK' });
t('W-23', 0, 'SmartConfig', 'AT+CWSTARTSMART lalu kirim kredensial dari aplikasi EspTouch', '+SCRD / WIFI GOT IP; AT+CWSTOPSMART', '', { requires: ['F-17'], human: 'aplikasi EspTouch di HP', run: 'AT+CWMODE=1\nAT+CWSTARTSMART\n?? WIFI GOT IP ;t=90000\nAT+CWSTOPSMART', expect: 'WIFI GOT IP' });
t('W-24', 0, 'WPS', 'AT+WPS=1 lalu tekan tombol WPS router', 'WIFI GOT IP', '', { requires: ['F-16'], human: 'tekan tombol WPS di router', run: 'AT+CWMODE=1\nAT+WPS=1\n?? WIFI GOT IP ;t=120000', expect: 'WIFI GOT IP' });

// ======================================================================= 4. SNTP & DNS
const N = { requires: ['F-02'], needs: 'net' };
t('N-01', 0, 'Atur server SNTP', 'AT+CIPSNTPCFG=1,0,"pool.ntp.org","time.google.com"', 'OK', '', { ...N, requires: ['F-11'], run: 'AT+CIPSNTPCFG=1,0,"pool.ntp.org","time.google.com"', expect: 'OK' });
t('N-02', 1, 'Waktu tersinkron', 'Atur SNTP, tunggu +TIME_UPDATED, AT+CIPSNTPTIME?', 'Tahun sekarang, bukan 1970', '', { ...N, requires: ['F-11'], run: 'AT+CIPSNTPCFG=1,0,"pool.ntp.org","time.google.com"\n?? TIME_UPDATED ;t=25000\nAT+CIPSNTPTIME?', expect: R`\+CIPSNTPTIME:.*20[2-9]\d` });
t('N-03', 0, 'Waktu sesaat setelah restart', 'AT+RST, sambung Wi-Fi, langsung AT+CIPSNTPTIME?', 'Biasanya masih 1970 (belum sinkron); catat', 'Untuk host: tunggu +TIME_UPDATED sebelum memakai jam', { ...N, requires: ['F-11'], run: 'AT+RST\n?? ready ;t=8000\n!wifi\nAT+CIPSNTPTIME?', expect: R`\+CIPSNTPTIME:` });
t('N-04', 0, 'Server SNTP cadangan', 'Restart, server pertama salah, server kedua benar', 'Tetap tersinkron (tahun sekarang)', '', { ...N, requires: ['F-11'], run: 'AT+RST\n?? ready ;t=8000\n!net\nAT+CIPSNTPCFG=1,0,"ntp.salah.invalid","pool.ntp.org"\n?? TIME_UPDATED ;t=40000\nAT+CIPSNTPTIME?', expect: R`\+CIPSNTPTIME:.*20[2-9]\d` });
t('N-05', 0, 'Zona waktu +7', 'AT+CIPSNTPCFG=1,7,"pool.ntp.org", AT+CIPSNTPTIME?', 'Waktu lokal WIB; dikembalikan ke 0', 'Bandingkan jam dengan jam laptop', { ...N, requires: ['F-11'], run: 'AT+CIPSNTPCFG=1,7,"pool.ntp.org"\n?? TIME_UPDATED ;t=25000\nAT+CIPSNTPTIME?\n- AT+CIPSNTPCFG=1,0,"pool.ntp.org"', expect: R`\+CIPSNTPTIME:.*20[2-9]\d` });
t('N-06', 0, 'Interval sinkron', 'AT+CIPSNTPINTV?', '+CIPSNTPINTV:<detik>', '', { requires: ['F-11'], needs: undefined, run: 'AT+CIPSNTPINTV?', expect: R`\+CIPSNTPINTV:\d+` });
t('N-07', 1, 'DNS domain server uji', 'AT+CIPDOMAIN="{HOST}"', '+CIPDOMAIN:<ip>', 'IP yang keluar milik Cloudflare', { ...N, run: 'AT+CIPDOMAIN="{HOST}" ;t=20000', expect: R`\+CIPDOMAIN:"?\d+\.\d+` });
t('N-08', 0, 'DNS domain tidak ada', 'AT+CIPDOMAIN="tidak-ada.ujiat.invalid"', 'ERROR (tidak hang)', '', { ...N, run: 'AT+CIPDOMAIN="tidak-ada.ujiat.invalid" ;t=30000', expect: 'ERROR' });
t('N-09', 0, 'Server DNS', 'AT+CIPDNS?', '+CIPDNS:<enable>,"<dns1>",...', '', { ...N, needs: 'wifi', run: 'AT+CIPDNS?', expect: R`\+CIPDNS:` });
t('N-10', 0, 'PING domain', 'AT+PING="{HOST}"', '+PING:<ms>', '', { ...N, requires: ['F-12'], run: 'AT+PING="{HOST}" ;t=20000', expect: R`\+PING:\d+` });
t('N-11', 0, 'PING alamat IP', 'AT+PING="1.1.1.1"', '+PING:<ms>', '', { ...N, requires: ['F-12'], run: 'AT+PING="1.1.1.1" ;t=20000', expect: R`\+PING:\d+` });

// ======================================================================= 5. TCP & SSL
const T = { requires: ['F-02'], needs: 'net' };
const TS = { requires: ['F-03'], needs: 'net' };
t('T-01', 0, 'Mode koneksi tunggal', 'AT+CIPMUX=0, AT+CIPMUX?', '+CIPMUX:0', '', { requires: ['F-02'], run: `${CLEAN_TCP}\n- AT+CIPSERVER=0,1\nAT+CIPMUX=0\nAT+CIPMUX?`, expect: R`\+CIPMUX:0` });
t('T-02', 1, 'Sambung TCP', 'AT+CIPSTART="TCP","{HOST}",80', 'CONNECT, OK', '', { ...T, run: `${CLEAN_TCP}\nAT+CIPSTART="TCP","{HOST}",80 ;t=20000`, expect: 'CONNECT' });
t('T-03', 0, 'Status tersambung', 'AT+CIPSTATUS', 'STATUS:3', '', { requires: ['T-02'], run: 'AT+CIPSTATUS', expect: 'STATUS:3' });
t('T-04', 0, 'Kirim request', 'AT+CIPSEND=<n>, kirim GET {T}/hold', 'Recv <n> bytes, SEND OK; server mencatat hold', 'Cloudflare butuh header Host. /hold menahan koneksi untuk T-05', { requires: ['T-02'], run: R`AT+CIPSEND={LEN}
>> GET {T}/hold HTTP/1.1\r\nHost: {HOST}\r\n\r\n
?ev hold open`, expect: 'SEND OK' });
t('T-05', 0, 'Terima kiriman server', 'Server mengirim teks ke koneksi', '+IPD,<len>:... berisi teks', 'Cloudflare menambahkan ukuran chunk di depan teks', { requires: ['T-04'], run: '!hold-push Halo dari server UJIAT\n?? Halo dari server', expect: R`\+IPD,\d+` });
t('T-06', 0, 'Tutup koneksi', 'AT+CIPCLOSE', 'CLOSED, OK', '', { requires: ['T-02'], run: 'AT+CIPCLOSE', expect: 'CLOSED' });
t('T-07', 0, 'Status setelah tutup', 'AT+CIPSTATUS', 'STATUS:4 atau 2', '', { requires: ['F-02'], run: 'AT+CIPSTATUS', expect: 'STATUS:[24]' });
t('T-08', 1, 'Kirim 1900 byte', 'Header POST {T}/sink, lalu AT+CIPSEND=1900', 'Server membalas RECV 1900 UTUH', 'Server memeriksa pola byte per byte', { ...T, run: R`${CLEAN_TCP}
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 1900\r\nConnection: close\r\n\r\n
AT+CIPSEND=1900
>> {FILL:1900:0}
?? RECV 1900 UTUH ;t=15000`, expect: 'RECV 1900 UTUH' });
t('T-09', 1, 'Kirim 4 x 1900 byte', 'Empat CIPSEND berurutan dalam satu request', 'RECV 7600 UTUH', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
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
t('T-10', 0, 'Kirim 8192 byte sekali', 'AT+CIPSEND=8192 (batas maksimum satu CIPSEND)', 'RECV 8192 UTUH', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 8192\r\nConnection: close\r\n\r\n
AT+CIPSEND=8192
>> {FILL:8192:0}
?? RECV 8192 UTUH ;t=20000`, expect: 'RECV 8192 UTUH' });
t('T-11', 0, 'Host tidak terjangkau', 'AT+CIPSTART="TCP","192.0.2.1",9', 'ERROR/CLOSED dalam waktu wajar (tidak hang)', 'Jaringan dengan proxy transparan bisa membuat ini CONNECT; catat', { ...T, run: `${CLEAN_TCP}\nAT+CIPSTART="TCP","192.0.2.1",9 ;t=40000\n- AT+CIPCLOSE`, expect: R`AT\+CIPSTART[^\n]*\n[\s\S]*?(ERROR|CLOSED)` });
t('T-12', 0, 'Port tertutup', 'AT+CIPSTART="TCP","{HOST}",81', 'ERROR/CLOSED', 'Cloudflare tidak melayani port 81', { ...T, run: `${CLEAN_TCP}\nAT+CIPSTART="TCP","{HOST}",81 ;t=40000\n- AT+CIPCLOSE`, expect: R`AT\+CIPSTART[^\n]*\n[\s\S]*?(ERROR|CLOSED)` });
t('T-13', 0, 'Server menutup koneksi', 'GET {T}/hold (Connection: close), lalu server menutup', 'CLOSED; AT+CIPSTATUS = STATUS:4', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> GET {T}/hold HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?ev hold open
~ 800
!hold-close
?? CLOSED ;t=15000
AT+CIPSTATUS`, expect: R`CLOSED[\s\S]*STATUS:[24]` });
t('T-14', 1, 'Sambung SSL', 'AT+CIPSTART="SSL","{HOST}",443', 'CONNECT (bisa 3-8 detik)', '', { ...TS, run: `${CLEAN_TCP}\n- AT+CIPSSLCCONF=0\nAT+CIPSTART="SSL","{HOST}",443 ;t=30000`, expect: 'CONNECT' });
t('T-15', 1, 'GET lewat SSL', 'Kirim GET {T}/hello di koneksi SSL', '+IPD berisi HTTP/1.1 200 dan hello', '', { requires: ['T-14'], run: R`AT+CIPSEND={LEN}
>> GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? hello ;t=15000`, expect: R`HTTP/1\.1 200[\s\S]*hello` });
t('T-16', 0, 'SSL ke sertifikat kedaluwarsa (tanpa verifikasi)', 'AT+CIPSTART="SSL","test.mosquitto.org",8887', 'Tetap CONNECT karena verifikasi mati', '', { ...TS, run: `${CLEAN_TCP}\n- AT+CIPSSLCCONF=0\nAT+CIPSTART="SSL","test.mosquitto.org",8887 ;t=30000\n- AT+CIPCLOSE`, expect: 'CONNECT' });
t('T-17', 1, 'SSL 20x berulang', 'Buka SSL, GET, tutup; 20 kali', 'Semua sukses; SYSRAM awal dan akhir tidak turun jauh', 'Bandingkan dua angka SYSRAM', { ...TS, long: true, run: R`${CLEAN_TCP}
AT+SYSRAM?
@loop 20
AT+CIPSTART="SSL","{HOST}",443 ;t=30000
AT+CIPSEND={LEN}
>> GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? CLOSED ;t=15000
@end
AT+SYSRAM?`, expect: R`SYSRAM[\s\S]*SYSRAM` });
t('T-18', 0, 'SSL dengan SNI', 'AT+CIPSSLCSNI="{HOST}" lalu CIPSTART SSL', 'CONNECT', '', { ...TS, run: `${CLEAN_TCP}\nAT+CIPSSLCSNI="{HOST}"\nAT+CIPSTART="SSL","{HOST}",443 ;t=30000\n- AT+CIPCLOSE`, expect: 'CONNECT' });
t('T-19', 0, 'SSL dengan ALPN', 'AT+CIPSSLCALPN=1,"http/1.1" lalu CIPSTART SSL', 'CONNECT', '', { ...TS, run: `${CLEAN_TCP}\nAT+CIPSSLCALPN=1,"http/1.1"\nAT+CIPSTART="SSL","{HOST}",443 ;t=30000\n- AT+CIPCLOSE`, expect: 'CONNECT' });
t('T-20', 1, 'SSL verifikasi server (CA benar)', 'AT+CIPSSLCCONF=2,0,0 lalu CIPSTART SSL ke {HOST}', 'CONNECT', 'Butuh S-02', { ...TS, requires: ['F-03', 'S-02'], run: `${CLEAN_TCP}\nAT+CIPSSLCCONF=2,0,0\nAT+CIPSTART="SSL","{HOST}",443 ;t=30000\n- AT+CIPCLOSE\n- AT+CIPSSLCCONF=0`, expect: 'CONNECT' });
t('T-21', 0, 'SSL verifikasi menolak cert kedaluwarsa', 'AT+CIPSSLCCONF=2,0,1 lalu SSL ke test.mosquitto.org:8887', 'ERROR/CLOSED (ditolak)', 'Butuh S-03', { ...TS, requires: ['F-03', 'S-03'], run: `${CLEAN_TCP}\nAT+CIPSSLCCONF=2,0,1\nAT+CIPSTART="SSL","test.mosquitto.org",8887 ;t=30000\n- AT+CIPCLOSE\n- AT+CIPSSLCCONF=0`, expect: R`AT\+CIPSTART[^\n]*\n[\s\S]*?(ERROR|CLOSED)` });
t('T-22', 0, 'Passthrough (CIPMODE=1)', 'CIPMODE=1, CIPSTART, CIPSEND, kirim request, +++', 'Balasan hello; setelah +++ kembali ke mode perintah', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPMODE=1
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND
>>! GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? hello ;t=15000
~ 1200
>>! +++
~ 1200
AT+CIPMODE=0`, expect: R`hello[\s\S]*OK` });
t('T-23', 0, 'Terima pasif (CIPRECVMODE=1)', 'CIPRECVMODE=1, GET 3000 byte, CIPRECVLEN?, CIPRECVDATA', '+CIPRECVDATA:<len>,...', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPRECVMODE=1
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> GET {T}/size/3000 HTTP/1.1\r\nHost: {HOST}\r\n\r\n
~ 2500
AT+CIPRECVLEN?
AT+CIPRECVDATA=1460
- AT+CIPCLOSE
- AT+CIPRECVMODE=0`, expect: R`\+CIPRECVDATA:` });
t('T-24', 0, 'TCP echo port lain', 'AT+CIPSTART="TCP","tcpbin.com",4242', '+IPD berisi teks yang sama', '', { ...T, run: R`${CLEAN_TCP}
AT+CIPSTART="TCP","tcpbin.com",4242 ;t=20000
AT+CIPSEND={LEN}
>> halo ujiat\n
?? \+IPD ;t=10000
- AT+CIPCLOSE`, expect: R`\+IPD,\d+:halo ujiat` });
t('T-25', 0, 'SSL echo port lain', 'AT+CIPSTART="SSL","tcpbin.com",4243', '+IPD berisi teks yang sama', '', { ...TS, run: R`${CLEAN_TCP}
- AT+CIPSSLCCONF=0
AT+CIPSTART="SSL","tcpbin.com",4243 ;t=30000
AT+CIPSEND={LEN}
>> halo ssl\n
?? \+IPD ;t=10000
- AT+CIPCLOSE`, expect: R`\+IPD,\d+:halo ssl` });
t('T-26', 0, 'Status koneksi (baru)', 'AT+CIPSTATE?', 'OK (berisi +CIPSTATE bila ada koneksi)', '', { requires: ['F-02'], run: 'AT+CIPSTATE?', expect: 'OK' });
t('T-27', 0, 'Info IP remote di +IPD', 'AT+CIPDINFO=1, GET, lihat +IPD', '+IPD,<len>,"<ip>",<port>:...', 'Dikembalikan ke CIPDINFO=0', { ...T, run: R`${CLEAN_TCP}
AT+CIPDINFO=1
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> GET {T}/hello HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n
?? \+IPD ;t=15000
- AT+CIPDINFO=0`, expect: R`\+IPD,\d+,"\d+\.\d+\.\d+\.\d+",80` });
t('T-28', 0, 'Koneksi TCP cepat 30x', 'Buka-tutup TCP 30 kali', 'Semua CONNECT/CLOSED, tidak restart', '', { ...T, long: true, run: `${CLEAN_TCP}\n@loop 30\nAT+CIPSTART="TCP","{HOST}",80 ;t=20000\nAT+CIPCLOSE\n@end\nAT+SYSRAM?`, expect: R`CONNECT[\s\S]*SYSRAM` });

// ======================================================================= 6. UDP
const U = { requires: ['F-02'], needs: 'net' };
const NTP_REQ = R`>> \x1b{ZERO:47}`;
t('U-01', 1, 'UDP kirim/terima', 'CIPSTART UDP ke pool.ntp.org:123, kirim permintaan NTP 48 byte', '+IPD,48 (balasan NTP)', '', { ...U, run: `${CLEAN_TCP}\nAT+CIPSTART="UDP","pool.ntp.org",123 ;t=20000\nAT+CIPSEND=48\n${NTP_REQ}\n?? \\+IPD,48 ;t=10000\n- AT+CIPCLOSE`, expect: R`\+IPD,48` });
t('U-02', 0, 'UDP dengan info IP remote', 'AT+CIPDINFO=1 lalu U-01', '+IPD,48,"<ip>",123', '', { ...U, run: `${CLEAN_TCP}\nAT+CIPDINFO=1\nAT+CIPSTART="UDP","pool.ntp.org",123 ;t=20000\nAT+CIPSEND=48\n${NTP_REQ}\n?? \\+IPD ;t=10000\n- AT+CIPCLOSE\n- AT+CIPDINFO=0`, expect: R`\+IPD,48,"\d+\.\d+\.\d+\.\d+",123` });
t('U-03', 0, 'UDP dengan port lokal tetap', 'AT+CIPSTART="UDP","pool.ntp.org",123,11123,0', '+IPD,48', '', { ...U, run: `${CLEAN_TCP}\nAT+CIPSTART="UDP","pool.ntp.org",123,11123,0 ;t=20000\nAT+CIPSEND=48\n${NTP_REQ}\n?? \\+IPD,48 ;t=10000\n- AT+CIPCLOSE`, expect: R`\+IPD,48` });
t('U-04', 0, 'UDP 10x berulang', 'U-01 sebanyak 10 kali', 'Semua dapat +IPD,48', '', { ...U, run: `${CLEAN_TCP}\n@loop 10\nAT+CIPSTART="UDP","pool.ntp.org",123 ;t=20000\nAT+CIPSEND=48\n${NTP_REQ}\n?? \\+IPD,48 ;t=10000\nAT+CIPCLOSE\n@end`, expect: R`\+IPD,48` });

// ======================================================================= 7. Sertifikat
const S = { requires: ['F-14'] };
const mfgWrite = (ns, key, pem) => `AT+SYSMFG=2,"${ns}","${key}",8,{LEN}\n>> {PEMZ:${pem}}`;
t('S-01', 0, 'Daftar namespace', 'AT+SYSMFG?', 'Berisi client_ca, client_cert, client_key (dan mqtt_* bila ada)', '', { ...S, run: 'AT+SYSMFG?', expect: 'client_ca' });
t('S-02', 1, 'CA Cloudflare untuk SSL', 'AT+SYSMFG=2,"client_ca","client_ca.0",8,<len>', 'OK', 'ISRG Root X1/X2 + GTS Root R1/R4; menimpa CA bawaan', { ...S, run: mfgWrite('client_ca', 'client_ca.0', 'ca_bundle'), expect: 'OK' });
t('S-03', 0, 'CA mosquitto.org untuk SSL', 'client_ca.1', 'OK', '', { ...S, run: mfgWrite('client_ca', 'client_ca.1', 'mosquitto_org'), expect: 'OK' });
t('S-04', 0, 'Client cert untuk SSL', 'client_cert.0', 'OK', 'Buat dulu di tab Sertifikat', { ...S, precheck: 'cert:client_cert', run: mfgWrite('client_cert', 'client_cert.0', 'client_cert'), expect: 'OK' });
t('S-05', 0, 'Client key untuk SSL', 'client_key.0', 'OK', '', { ...S, precheck: 'cert:client_key', run: mfgWrite('client_key', 'client_key.0', 'client_key'), expect: 'OK' });
t('S-06', 0, 'Baca balik CA SSL', 'AT+SYSMFG=1,"client_ca","client_ca.0"', 'Isi PEM sama dengan yang ditulis', '', { ...S, run: 'AT+SYSMFG=1,"client_ca","client_ca.0" ;t=15000', expect: 'BEGIN CERTIFICATE' });
t('S-07', 0, 'CA Cloudflare untuk MQTT', 'mqtt_ca.0', 'OK (ERROR bila firmware tidak punya namespace mqtt_ca)', '', { ...S, run: mfgWrite('mqtt_ca', 'mqtt_ca.0', 'ca_bundle'), expect: 'OK' });
t('S-08', 0, 'CA mosquitto.org untuk MQTT', 'mqtt_ca.1', 'OK', '', { ...S, run: mfgWrite('mqtt_ca', 'mqtt_ca.1', 'mosquitto_org'), expect: 'OK' });
t('S-09', 0, 'Client cert untuk MQTT', 'mqtt_cert.0', 'OK', '', { ...S, precheck: 'cert:client_cert', run: mfgWrite('mqtt_cert', 'mqtt_cert.0', 'client_cert'), expect: 'OK' });
t('S-10', 0, 'Client key untuk MQTT', 'mqtt_key.0', 'OK', '', { ...S, precheck: 'cert:client_key', run: mfgWrite('mqtt_key', 'mqtt_key.0', 'client_key'), expect: 'OK' });
t('S-11', 0, 'Hapus client cert/key SSL', 'AT+SYSMFG=0,"client_cert","client_cert.0" dan key', 'OK', 'Bila HTTPS/SSL bermasalah setelah client cert ditulis', { ...S, run: 'AT+SYSMFG=0,"client_cert","client_cert.0"\nAT+SYSMFG=0,"client_key","client_key.0"', expect: 'OK' });

// ======================================================================= 8. MQTT
const M = { requires: ['F-04'], needs: 'net' };
const MO = { requires: ['F-04', 'M-02'], needs: 'net' };
t('M-01', 1, 'Jalur ke broker publik (diagnosis)', 'AT+CIPSTART="TCP","test.mosquitto.org",1883', 'CONNECT. Bila gagal, jaringan memblokir port 1883', 'Membedakan masalah jaringan dari masalah MQTT', { requires: ['F-02'], needs: 'net', run: `${CLEAN_TCP}\nAT+CIPSTART="TCP","test.mosquitto.org",1883 ;t=20000\n- AT+CIPCLOSE`, expect: 'CONNECT' });
t('M-02', 1, 'Broker server ini (WSS, scheme 7)', 'MQTTUSERCFG scheme 7 path /mqtt, MQTTCONN {HOST}:443', '+MQTTCONNECTED; server mencatat klien', '', { ...M, run: `${OWN_WSS}\n?ev mqttlog .*ujiat-`, expect: R`\+MQTTCONNECTED:0` });
t('M-03', 1, 'Publish QoS 0/1/2', 'AT+MQTTPUB ke {TOPIC}/up dengan QoS 0, 1, 2', 'Tiga OK; server menerima q2', '', { ...MO, run: 'AT+MQTTPUB=0,"{TOPIC}/up","q0",0,0\nAT+MQTTPUB=0,"{TOPIC}/up","q1",1,0\nAT+MQTTPUB=0,"{TOPIC}/up","q2",2,0\n?ev mqtt own .*/up q2', expect: R`OK[\s\S]*OK[\s\S]*OK` });
t('M-04', 1, 'Subscribe + kiriman server', 'AT+MQTTSUB {TOPIC}/down, server publish', '+MQTTSUBRECV:0,"{TOPIC}/down",8,halo-esp', '', { ...MO, run: 'AT+MQTTSUB=0,"{TOPIC}/down",1\n~ 800\n!mqtt-pub own {TOPIC}/down halo-esp\n?? \\+MQTTSUBRECV ;t=15000', expect: R`\+MQTTSUBRECV:0,"[^"]+",8,halo-esp` });
t('M-05', 0, 'Retain', 'AT+MQTTPUB ... retain=1', 'OK; server menerima', '', { ...MO, run: 'AT+MQTTPUB=0,"{TOPIC}/retain","tetap",1,1\n?ev mqtt own .*/retain tetap', expect: 'OK' });
t('M-06', 1, 'Payload 2000 byte (PUBRAW)', 'AT+MQTTPUBRAW ... 2000', '+MQTTPUB:OK; server: 2000 B UTUH', '', { ...MO, run: 'AT+MQTTPUBRAW=0,"{TOPIC}/raw",2000,1,0\n>> {FILL:2000:0}\n?ev mqtt own .*/raw \\[2000 B UTUH\\]', expect: R`\+MQTTPUB:OK|OK` });
t('M-07', 0, 'Unsubscribe', 'AT+MQTTUNSUB=0,"{TOPIC}/down"', 'OK', '', { ...MO, run: 'AT+MQTTUNSUB=0,"{TOPIC}/down"', expect: 'OK' });
t('M-08', 0, 'Lihat koneksi & langganan', 'AT+MQTTCONN?, AT+MQTTSUB?', '+MQTTCONN:0,<state 3..6>', '', { ...MO, run: 'AT+MQTTCONN?\nAT+MQTTSUB?', expect: R`\+MQTTCONN:0,[3-6]` });
t('M-09', 1, 'Last Will (LWT)', 'LWT "offline", sambung, lalu AT+RST', 'Server menerima {TOPIC}/status offline', 'keepalive 20 s → broker menyatakan putus ±30 s', { ...MO, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONNCFG=0,20,0,"{TOPIC}/status","offline",1,0\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=30000\nAT+MQTTPUB=0,"{TOPIC}/status","online",1,0\n~ 1000\nAT+RST\n?? ready ;t=8000\n?ev mqtt own .*/status offline ;t=60000`, expect: 'ready' });
t('M-10', 0, 'Broker server ini tanpa TLS (WS, scheme 6)', 'scheme 6, port 80', '+MQTTCONNECTED', '', { ...M, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,6,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONNCFG=0,60,1,"","",0,0\nAT+MQTTCONN=0,"{HOST}",80,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-11', 0, 'Broker server ini dengan verifikasi (scheme 8)', 'scheme 8, CA mqtt_ca.0', '+MQTTCONNECTED', 'Butuh S-07', { ...M, requires: ['F-04', 'S-07'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,8,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTCONNCFG=0,60,1,"","",0,0\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-12', 0, 'Sandi MQTT salah', 'scheme 7 dengan sandi salah', 'Gagal sambung (ERROR / +MQTTDISCONNECTED), tidak hang', '', { ...M, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","salah",0,0,"/mqtt"\nAT+MQTTCONN=0,"{HOST}",443,0 ;t=30000`, expect: R`ERROR|DISCONNECTED` });
t('M-13', 0, 'Bertahan diam 3 menit', 'Sambung dengan keepalive 60 s, diam 3 menit', 'Tetap tersambung', '', { ...MO, long: true, run: `${OWN_WSS}\n~ 180000\nAT+MQTTCONN?`, expect: R`\+MQTTCONN:0,[4-6]` });
t('M-14', 0, 'Sambung ulang otomatis', 'Saat tersambung, Wi-Fi diputus lalu disambung', '+MQTTDISCONNECTED lalu +MQTTCONNECTED sendiri', '', { ...MO, run: `${OWN_WSS}\nAT+CWQAP\n?? MQTTDISCONNECTED ;t=30000\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\n?? \\+MQTTCONNECTED ;t=60000`, expect: R`DISCONNECTED[\s\S]*\+MQTTCONNECTED` });
t('M-15', 0, 'Broker publik TCP (scheme 1)', 'test.mosquitto.org:1883', '+MQTTCONNECTED; publish terlihat di server', '', { ...M, requires: ['F-04', 'M-01'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,1,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",1883,1 ;t=30000\nAT+MQTTPUB=0,"{TOPIC}/s1","tcp",1,0\n?ev mqtt mosquitto .*/s1 tcp`, expect: R`\+MQTTCONNECTED:0` });
t('M-16', 0, 'Broker publik subscribe', 'Subscribe {TOPIC}/s1, server publish lewat test.mosquitto.org', '+MQTTSUBRECV', '', { ...M, requires: ['F-04', 'M-15'], run: 'AT+MQTTSUB=0,"{TOPIC}/s1",1\n~ 1000\n!mqtt-pub mosquitto {TOPIC}/s1 halo\n?? \\+MQTTSUBRECV ;t=15000', expect: R`\+MQTTSUBRECV:0,"[^"]+",4,halo` });
t('M-17', 0, 'Broker publik TLS (scheme 2)', 'test.mosquitto.org:8883 tanpa verifikasi', '+MQTTCONNECTED', '', { ...M, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,2,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8883,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-18', 0, 'Broker publik TLS verifikasi (scheme 3)', 'test.mosquitto.org:8886 (Let\'s Encrypt), CA mqtt_ca.0', '+MQTTCONNECTED', 'Butuh S-07', { ...M, requires: ['F-04', 'S-07'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,3,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8886,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-19', 1, 'Broker publik mTLS (scheme 4)', 'test.mosquitto.org:8884, client cert mqtt_cert.0', '+MQTTCONNECTED', 'Butuh S-09, S-10', { ...M, requires: ['F-04', 'S-09', 'S-10'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,4,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"test.mosquitto.org",8884,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-20', 0, 'Broker publik mTLS + verifikasi (scheme 5)', 'test.mosquitto.org:8884, cert slot 0, CA slot 1', '+MQTTCONNECTED', 'Butuh S-08, S-09, S-10', { ...M, requires: ['F-04', 'S-08', 'S-09', 'S-10'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,5,"ujiat-{TOPIC_ID}","","",0,1,""\nAT+MQTTCONN=0,"test.mosquitto.org",8884,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-21', 0, 'Verifikasi menolak cert kedaluwarsa', 'scheme 3, CA slot 1, test.mosquitto.org:8887', 'Gagal sambung (tidak hang)', 'Butuh S-08', { ...M, requires: ['F-04', 'S-08'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,3,"ujiat-{TOPIC_ID}","","",0,1,""\nAT+MQTTCONN=0,"test.mosquitto.org",8887,0 ;t=30000`, expect: R`ERROR|DISCONNECTED` });
t('M-22', 0, 'Broker publik WSS', 'test.mosquitto.org:8081 scheme 7', '+MQTTCONNECTED', '', { ...M, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","","",0,0,"/"\nAT+MQTTCONN=0,"test.mosquitto.org",8081,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-23', 0, 'Broker cadangan EMQX', 'broker.emqx.io:1883', '+MQTTCONNECTED; publish terlihat di server', '', { ...M, requires: ['F-04', 'M-01'], run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,1,"ujiat-{TOPIC_ID}","","",0,0,""\nAT+MQTTCONN=0,"broker.emqx.io",1883,1 ;t=30000\nAT+MQTTPUB=0,"{TOPIC}/emqx","ok",1,0\n?ev mqtt emqx .*/emqx ok`, expect: R`\+MQTTCONNECTED:0` });
t('M-24', 0, 'SNI MQTT', 'AT+MQTTSNI=0,"{HOST}" sebelum MQTTCONN', '+MQTTCONNECTED', 'Perintah opsional', { ...M, run: `${CLEAN_MQTT}\nAT+MQTTUSERCFG=0,7,"ujiat-{TOPIC_ID}","{MQTT_USER}","{MQTT_PASS}",0,0,"/mqtt"\nAT+MQTTSNI=0,"{HOST}"\nAT+MQTTCONN=0,"{HOST}",443,1 ;t=30000`, expect: R`\+MQTTCONNECTED:0` });
t('M-25', 0, 'Bersihkan', 'AT+MQTTCLEAN=0', 'OK', '', { requires: ['F-04'], run: 'AT+MQTTCLEAN=0', expect: 'OK|ERROR' });

// ======================================================================= 9. HTTP client
const P = { requires: ['F-05'], needs: 'net' };
const PG = { requires: ['F-05', 'P-02'], needs: 'net' };
const hget = (path, tr = 2, to = 30000) => `AT+HTTPCLIENT=2,0,"${tr === 2 ? 'https' : 'http'}://{HOST}{T}${path}",,,${tr} ;t=${to}`;
t('P-01', 0, 'GET http://', 'AT+HTTPCLIENT=2,0,"http://{HOST}{T}/hello",,,1', '+HTTPCLIENT:5,hello', 'Jaringan dengan proxy transparan port 80 bisa mengganggu', { ...P, run: hget('/hello', 1), expect: R`\+HTTPCLIENT:5,hello` });
t('P-02', 1, 'GET https://', 'AT+HTTPCLIENT=2,0,"https://{HOST}{T}/hello",,,2', '+HTTPCLIENT:5,hello', 'Gerbang untuk uji HTTPS lain', { ...P, run: hget('/hello'), expect: R`\+HTTPCLIENT:5,hello` });
t('P-03', 1, 'POST form', 'AT+HTTPCLIENT=3,0,".../echo",,,2,"a=1&b=2"', 'Echo berisi a=1&b=2; server mencatat POST', '', { ...PG, run: `AT+HTTPCLIENT=3,0,"https://{HOST}{T}/echo",,,2,"a=1&b=2" ;t=30000\n?ev http POST {T}/echo`, expect: 'a=1&b=2' });
t('P-04', 0, 'PUT JSON', 'AT+HTTPCLIENT=4,1,... "{\\"x\\":1}"', 'Echo berisi PUT', '', { ...PG, run: `AT+HTTPCLIENT=4,1,"https://{HOST}{T}/echo",,,2,"{\\"x\\":1}" ;t=30000`, expect: 'PUT' });
t('P-05', 0, 'DELETE', 'AT+HTTPCLIENT=5,...', 'Echo berisi DELETE', '', { ...PG, run: `AT+HTTPCLIENT=5,0,"https://{HOST}{T}/echo",,,2 ;t=30000`, expect: 'DELETE' });
t('P-06', 0, 'HEAD', 'AT+HTTPCLIENT=1,...', 'OK tanpa body', '', { ...PG, run: `AT+HTTPCLIENT=1,0,"https://{HOST}{T}/hello",,,2 ;t=30000`, expect: 'OK' });
t('P-07', 0, 'Ukuran resource', 'AT+HTTPGETSIZE=".../size/4096"', '+HTTPGETSIZE:4096', '', { ...PG, run: 'AT+HTTPGETSIZE="https://{HOST}{T}/size/4096" ;t=30000', expect: R`\+HTTPGETSIZE:4096` });
t('P-08', 1, 'Unduh 10 KB (HTTPCGET)', 'AT+HTTPCGET=".../size/10000"', 'Beberapa +HTTPCGET:<len>,... lalu OK', '', { ...PG, run: 'AT+HTTPCGET="https://{HOST}{T}/size/10000" ;t=40000', expect: R`\+HTTPCGET:\d+,[\s\S]*OK` });
t('P-09', 1, 'Upload 1900 byte (HTTPCPOST)', 'AT+HTTPCPOST=".../sink",1900', 'SEND OK; server: sink 1900 B UTUH', '', { ...PG, run: 'AT+HTTPCPOST="https://{HOST}{T}/sink",1900 ;t=30000\n>> {FILL:1900:0}\n?ev sink 1900 B UTUH', expect: 'SEND OK' });
t('P-10', 0, 'Upload PUT (HTTPCPUT)', 'AT+HTTPCPUT=".../sink",1000', 'SEND OK; server: sink 1000 B UTUH', 'Perintah ada di firmware baru', { ...PG, run: 'AT+HTTPCPUT="https://{HOST}{T}/sink",1000 ;t=30000\n>> {FILL:1000:0}\n?ev sink 1000 B UTUH', expect: 'SEND OK' });
t('P-11', 0, 'Header custom (HTTPCHEAD)', 'AT+HTTPCHEAD=<len> "X-Ujiat: 123", GET /headers', 'Balasan berisi x-ujiat: 123', '', { ...PG, run: `AT+HTTPCHEAD={LEN}\n>> X-Ujiat: 123\n${hget('/headers')}\n- AT+HTTPCHEAD=0`, expect: 'x-ujiat: 123' });
t('P-12', 0, 'Redirect 2x', '.../redirect/2', 'Akhirnya hello', '', { ...PG, run: hget('/redirect/2'), expect: 'hello' });
t('P-13', 0, 'Status 404', '.../status/404', 'ERROR (tidak hang)', '', { ...PG, run: hget('/status/404'), expect: 'ERROR' });
t('P-14', 0, 'Status 500', '.../status/500', 'ERROR (tidak hang)', '', { ...PG, run: hget('/status/500'), expect: 'ERROR' });
t('P-15', 0, 'Respons lambat 5 s', '.../delay/5000', 'Tetap hello', '', { ...PG, run: hget('/delay/5000', 2, 40000), expect: 'hello' });
t('P-16', 0, 'Respons sangat lambat 40 s', '.../delay/40000', 'ERROR (timeout) atau hello; tidak hang', '', { ...PG, long: true, run: hget('/delay/40000', 2, 90000), expect: 'ERROR|hello' });
t('P-17', 0, 'Chunked', '.../chunked', 'chunk-1 sampai chunk-5', '', { ...PG, run: hget('/chunked'), expect: 'chunk-5' });
t('P-18', 0, 'Basic auth', 'HTTPCHEAD Authorization, GET /basic', 'AUTH OK', 'user ujiat / sandi ujiat123', { ...PG, run: `AT+HTTPCHEAD={LEN}\n>> Authorization: Basic dWppYXQ6dWppYXQxMjM=\n${hget('/basic')}\n- AT+HTTPCHEAD=0`, expect: 'AUTH OK' });
t('P-19', 0, 'URL panjang (HTTPURLCFG)', 'AT+HTTPURLCFG=<len>, URL 300+ karakter, AT+HTTPCGET=""', 'Echo berisi query panjang', '', { ...PG, run: 'AT+HTTPURLCFG={LEN}\n>> https://{HOST}{T}/echo?q={FILL:300:0}\nAT+HTTPCGET="" ;t=30000', expect: 'q=0123' });
t('P-20', 0, 'Respons custom', '.../custom (atur di tab Kontrol)', 'Sesuai yang diatur', '', { ...PG, run: hget('/custom'), expect: R`\+HTTPCLIENT:|OK` });
t('P-21', 0, 'Konfigurasi HTTP', 'AT+HTTPCFG? (bila ada)', '+HTTPCFG / OK atau ERROR bila tidak didukung', 'Opsional', { requires: ['F-05'], run: 'AT+HTTPCFG?', expect: 'OK|ERROR' });

// ======================================================================= 10. WebSocket
const K = { requires: ['F-06'], needs: 'net' };
const KO = { requires: ['F-06', 'K-02'], needs: 'net' };
t('K-01', 0, 'Konfigurasi WS', 'AT+WSCFG=0,30,60,4096', 'OK', '', { requires: ['F-06'], run: 'AT+WSCFG=0,30,60,4096', expect: 'OK' });
t('K-02', 1, 'Buka wss://', 'AT+WSOPEN=0,"wss://{HOST}{WS}"', '+WS_CONNECTED:0', '', { ...K, run: '- AT+WSCLOSE=0\nAT+WSOPEN=0,"wss://{HOST}{WS}" ;t=30000', expect: R`\+WS_CONNECTED:0` });
t('K-03', 1, 'Kirim & echo', 'AT+WSSEND=0,<len> "halo ws"', '+WS_DATA:0,<len>,ECHO:halo ws', '', { ...KO, run: 'AT+WSSEND=0,{LEN}\n>> halo ws\n?? WS_DATA ;t=10000', expect: R`\+WS_DATA:0,\d+,ECHO:halo ws` });
t('K-04', 0, 'Kiriman server', 'Server mengirim frame', '+WS_DATA:0,<len>,Halo dari server', '', { ...KO, run: '!ws-push Halo dari server\n?? Halo dari server ;t=10000', expect: R`\+WS_DATA:0` });
t('K-05', 0, 'Frame 2000 byte', 'AT+WSSEND=0,2000', 'Server: 2000 B UTUH', '', { ...KO, run: 'AT+WSSEND=0,2000\n>> {FILL:2000:0}\n?ev ws .*2000 B UTUH', expect: 'OK' });
t('K-06', 0, 'Server menutup WS', 'Server menutup koneksi', '+WS_DISCONNECTED / +WS_CLOSED', '', { ...KO, run: '!ws-close\n?? WS_(DIS)?C ;t=15000', expect: R`\+WS_(DISCONNECTED|CLOSED)` });
t('K-07', 0, 'Buka ws:// (tanpa TLS)', 'AT+WSOPEN=0,"ws://{HOST}{WS}"', '+WS_CONNECTED:0', '', { ...K, run: '- AT+WSCLOSE=0\nAT+WSOPEN=0,"ws://{HOST}{WS}" ;t=30000', expect: R`\+WS_CONNECTED:0` });
t('K-08', 0, 'Header custom (WSHEAD)', 'AT+WSHEAD "X-Ujiat-WS: 7", WSOPEN', 'Server mencatat header x-ujiat-ws', '', { ...K, run: '- AT+WSCLOSE=0\nAT+WSHEAD={LEN}\n>> X-Ujiat-WS: 7\nAT+WSOPEN=0,"wss://{HOST}{WS}" ;t=30000\n?ev ws open .*x-ujiat-ws', expect: R`\+WS_CONNECTED:0` });
t('K-09', 0, 'Tutup dari ESP', 'AT+WSCLOSE=0', 'OK / +WS_CLOSED:0', '', { requires: ['F-06'], run: 'AT+WSCLOSE=0', expect: 'OK|WS_CLOSED|ERROR' });

// ======================================================================= 11. mDNS
const MDS = { requires: ['F-10'] };
t('MD-01', 0, 'mDNS di jaringan Wi-Fi', 'AT+MDNS=1,"{MDNS}","_http",80', 'OK', '', { ...MDS, needs: 'wifi', run: '- AT+MDNS=0\nAT+MDNS=1,"{MDNS}","_http",80', expect: 'OK' });
t('MD-02', 0, 'Resolve {MDNS}.local', 'ping {MDNS}.local dari laptop di jaringan yang sama', 'Terjawab dengan IP ESP', 'Tidak semua Android mendukung mDNS', { ...MDS, human: 'ping dari laptop' });
t('MD-03', 0, 'Matikan mDNS', 'AT+MDNS=0', 'OK', '', { ...MDS, run: 'AT+MDNS=0', expect: 'OK' });

// ======================================================================= 12. Hemat daya
const PSX = { requires: ['F-19'] };
t('PS-01', 0, 'Mode tidur sekarang', 'AT+SLEEP?', '+SLEEP:<n>', '', { ...PSX, run: 'AT+SLEEP?', expect: R`\+SLEEP:\d` });
t('PS-02', 0, 'Modem sleep', 'AT+SLEEP=1, AT, AT+SLEEP=0', 'OK; tetap menjawab AT', 'Butuh Wi-Fi tersambung', { ...PSX, needs: 'wifi', run: 'AT+SLEEP=1\n~ 2000\nAT\nAT+SLEEP=0', expect: R`OK[\s\S]*OK[\s\S]*OK` });
t('PS-03', 0, 'Tetap online saat modem sleep', 'AT+SLEEP=1, HTTPS GET, AT+SLEEP=0', 'hello', '', { requires: ['F-19', 'F-05'], needs: 'net', run: `AT+SLEEP=1\n${hget('/hello')}\n- AT+SLEEP=0`, expect: 'hello' });

// ======================================================================= 13. Hotspot
const H = { requires: ['F-01'] };
const CLEAN_AP = '- AT+CIPCLOSE\n- AT+CIPSERVER=0,1\n- AT+CIPMODE=0';
t('H-01', 0, 'Echo & penyimpanan mati', 'ATE0, AT+SYSSTORE=0', 'Masing-masing OK', '', { ...H, run: 'ATE0\nAT+SYSSTORE=0', expect: 'OK' });
t('H-02', 1, 'Mode SoftAP', 'AT+CWMODE=2', 'OK', '', { ...H, run: 'AT+CWMODE=2', expect: 'OK' });
t('H-03', 1, 'Atur SSID hotspot', 'AT+CWSAP="{AP_SSID}","{AP_PASS}",{AP_CH},3,2', 'OK', 'Sandi minimal 8 karakter', { ...H, requires: ['H-02'], run: 'AT+CWSAP="{AP_SSID}","{AP_PASS}",{AP_CH},3,2', expect: 'OK' });
t('H-04', 0, 'Baca setelan hotspot', 'AT+CWSAP?', '+CWSAP:"{AP_SSID}",...', '', { ...H, requires: ['H-03'], run: 'AT+CWSAP?', expect: R`\+CWSAP:"{AP_SSID}"` });
t('H-05', 0, 'Atur IP hotspot', 'AT+CIPAP="192.168.4.1","192.168.4.1","255.255.255.0"', 'OK', '', { ...H, requires: ['H-02'], run: 'AT+CIPAP="192.168.4.1","192.168.4.1","255.255.255.0"', expect: 'OK' });
t('H-06', 0, 'Baca IP hotspot', 'AT+CIPAP?', '+CIPAP:ip:"192.168.4.1"', '', { ...H, requires: ['H-02'], run: 'AT+CIPAP?', expect: R`\+CIPAP:ip:"192\.168\.4\.1"` });
t('H-07', 0, 'DHCP server hotspot', 'AT+CWDHCPS?', '+CWDHCPS:<lease>,"<start>","<end>"', '', { ...H, requires: ['H-02'], run: 'AT+CWDHCPS?', expect: R`\+CWDHCPS:` });
t('H-08', 1, 'Multi koneksi', 'AT+CIPMUX=1', 'OK', 'Didahului penutupan koneksi/server lama', { ...H, run: `${CLEAN_AP}\nAT+CIPMUX=1`, expect: 'OK' });
t('H-09', 0, 'Tanpa info IP di +IPD', 'AT+CIPDINFO=0', 'OK', '', { ...H, run: 'AT+CIPDINFO=0', expect: 'OK' });
t('H-10', 0, 'Mode terima pasif', 'AT+CIPRECVMODE=1', 'OK', '', { ...H, run: 'AT+CIPRECVMODE=1', expect: 'OK' });
t('H-11', 0, 'Batas koneksi server', 'AT+CIPSERVERMAXCONN=4', 'OK', 'Harus sebelum CIPSERVER', { ...H, requires: ['H-08'], run: 'AT+CIPSERVERMAXCONN=4', expect: 'OK' });
t('H-12', 1, 'Nyalakan server TCP', 'AT+CIPSERVER=1,80', 'OK', '', { ...H, requires: ['H-08'], run: 'AT+CIPSERVER=1,80', expect: 'OK' });
t('H-13', 0, 'Baca status server', 'AT+CIPSERVER?', '+CIPSERVER:1,80,...', '', { ...H, requires: ['H-12'], run: 'AT+CIPSERVER?', expect: R`\+CIPSERVER:1,80` });
t('H-14', 0, 'Batas waktu koneksi', 'AT+CIPSTO=90, AT+CIPSTO?', '+CIPSTO:90', '', { ...H, requires: ['H-12'], run: 'AT+CIPSTO=90\nAT+CIPSTO?', expect: R`\+CIPSTO:90` });
t('H-15', 0, 'Nama mDNS hotspot', 'AT+MDNS=1,"{MDNS}","_http",80', 'OK', '', { ...H, requires: ['F-10', 'H-02'], run: '- AT+MDNS=0\nAT+MDNS=1,"{MDNS}","_http",80', expect: 'OK' });
t('H-16', 0, 'HP melihat SSID', 'Cari Wi-Fi di HP', 'SSID {AP_SSID} terlihat, kanal {AP_CH}, WPA2', '', { ...H, human: HP });
t('H-17', 1, 'HP menyambung', 'Sambung HP dengan sandi {AP_PASS}', 'ESP menampilkan +STA_CONNECTED:"<mac>"', '', { ...H, human: HP, run: '?? STA_CONNECTED ;t=90000', expect: 'STA_CONNECTED' });
t('H-18', 0, 'Daftar perangkat tersambung', 'AT+CWLIF', '+CWLIF:<ip>,<mac>', '', { ...H, human: HP, run: 'AT+CWLIF', expect: R`\+CWLIF:` });
t('H-19', 1, 'HP membuka halaman', 'HP membuka http://192.168.4.1', 'ESP menampilkan 0,CONNECT lalu +IPD,0,<len>', '', { ...H, human: HP, run: '?? \\+IPD,\\d ;t=90000', expect: R`\+IPD,\d` });
t('H-20', 0, 'Panjang data masuk', 'AT+CIPRECVLEN?', '+CIPRECVLEN:<len>,...', '', { ...H, human: HP, requires: ['H-19'], run: 'AT+CIPRECVLEN?', expect: R`\+CIPRECVLEN:[1-9]` });
t('H-21', 0, 'Baca data masuk', 'AT+CIPRECVDATA=0,1024', '+CIPRECVDATA:<len>,GET / HTTP/1.1...', '', { ...H, human: HP, requires: ['H-19'], run: 'AT+CIPRECVDATA=0,1024', expect: R`\+CIPRECVDATA:\d+,GET` });
t('H-22', 0, 'Kirim halaman ke HP', 'AT+CIPSEND=0,<len> berisi respons HTTP', 'SEND OK; HP menampilkan teks', '', { ...H, human: HP, requires: ['H-19'], run: R`AT+CIPSEND=0,{LEN}
>> HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nHalo dari ESP`, expect: 'SEND OK' });
t('H-23', 1, 'Kirim 2048 byte ke HP', 'AT+CIPSEND=0,2048', 'SEND OK', '', { ...H, human: HP, requires: ['H-19'], run: 'AT+CIPSEND=0,2048\n>> {FILL:2048:0}', expect: 'SEND OK' });
t('H-24', 0, 'Tutup koneksi HP', 'AT+CIPCLOSE=0', '0,CLOSED', '', { ...H, human: HP, requires: ['H-19'], run: 'AT+CIPCLOSE=0', expect: '0,CLOSED' });
t('H-25', 0, 'Batas jumlah perangkat', 'Sambungkan perangkat melebihi batas MAXSTA', 'Perangkat berlebih ditolak', '', { ...H, human: 'beberapa HP' });
t('H-26', 0, 'Koneksi diam 90 detik', 'Biarkan koneksi HP diam 90 detik', 'ESP menutup sendiri (0,CLOSED)', '', { ...H, human: HP, long: true, run: '?? 0,CLOSED ;t=120000', expect: '0,CLOSED' });
t('H-27', 0, 'Akses lewat mDNS', 'http://{MDNS}.local dari HP/laptop', 'Terbuka', 'Tidak semua Android mendukung mDNS', { ...H, human: HP });
t('H-28', 0, 'Mode station + hotspot', 'AT+CWMODE=3, sambung Wi-Fi, CWSAP', 'Keduanya aktif', '', { ...H, run: 'AT+CWMODE=3\nAT+CWJAP="{SSID}","{PASS}" ;t=25000\nAT+CWSAP="{AP_SSID}","{AP_PASS}",{AP_CH},3,2', expect: R`WIFI GOT IP[\s\S]*OK` });
t('H-29', 1, 'Matikan hotspot', 'CIPSERVER=0, CIPMUX=0, CWMODE=1, ATE1, SYSSTORE=1', 'Semua OK; SSID hilang', '', { ...H, run: '- AT+CIPCLOSE\n- AT+CIPSERVER=0,1\n- AT+MDNS=0\nAT+CIPMUX=0\nAT+CWMODE=1\nATE1\nAT+SYSSTORE=1', expect: R`OK[\s\S]*OK[\s\S]*OK` });
t('H-30', 0, 'Nyala-mati hotspot 10x', 'Hotspot + server lalu dimatikan, 10 kali', 'Selalu sukses', '', { ...H, long: true, run: `@loop 10\nAT+CWMODE=2\nAT+CWSAP="{AP_SSID}","{AP_PASS}",{AP_CH},3,2\n${CLEAN_AP}\nAT+CIPMUX=1\nAT+CIPSERVER=1,80\nAT+CIPSERVER=0,1\nAT+CIPMUX=0\nAT+CWMODE=1\n@end`, expect: 'OK' });

// ======================================================================= 14. BLE
const LB = { requires: ['F-07'] };
t('L-01', 1, 'Init BLE server', 'AT+BLEINIT=2', 'OK', '', { ...LB, run: '- AT+BLEINIT=0\nAT+BLEINIT=2', expect: 'OK' });
t('L-02', 0, 'Alamat BLE', 'AT+BLEADDR?', '+BLEADDR:"xx:xx:..."', '', { ...LB, requires: ['L-01'], run: 'AT+BLEADDR?', expect: R`\+BLEADDR:"?[0-9a-f:]{17}` });
t('L-03', 0, 'Atur nama BLE', 'AT+BLENAME="{BLE_NAME}", AT+BLENAME?', '+BLENAME:{BLE_NAME}', '', { ...LB, requires: ['L-01'], run: 'AT+BLENAME="{BLE_NAME}"\nAT+BLENAME?', expect: R`\+BLENAME:"?{BLE_NAME}` });
t('L-04', 0, 'Parameter iklan', 'AT+BLEADVPARAM=50,50,0,0,7', 'OK', '', { ...LB, requires: ['L-01'], run: 'AT+BLEADVPARAM=50,50,0,0,7', expect: 'OK' });
t('L-05', 0, 'Data iklan otomatis', 'AT+BLEADVDATAEX="{BLE_NAME}","A002","0102030405",1', 'OK', '', { ...LB, requires: ['L-01'], run: 'AT+BLEADVDATAEX="{BLE_NAME}","A002","0102030405",1', expect: 'OK' });
t('L-06', 1, 'Mulai iklan', 'AT+BLEADVSTART', 'OK', '', { ...LB, requires: ['L-01'], run: 'AT+BLEADVSTART', expect: 'OK' });
t('L-07', 0, 'Terlihat di scanner', 'Buka aplikasi scanner BLE (mis. nRF Connect)', '{BLE_NAME} terlihat', '', { ...LB, human: 'aplikasi scanner BLE di HP' });
t('L-08', 0, 'GATT server', 'AT+BLEGATTSSRVCRE, AT+BLEGATTSSRVSTART, AT+BLEGATTSSRV?', '+BLEGATTSSRV:...', '', { ...LB, requires: ['L-01'], run: 'AT+BLEGATTSSRVCRE\nAT+BLEGATTSSRVSTART\nAT+BLEGATTSSRV?', expect: R`\+BLEGATTSSRV:` });
t('L-09', 0, 'HP menyambung BLE', 'Sambungkan dari aplikasi scanner', '+BLECONN:0,"<mac>"', '', { ...LB, human: 'aplikasi scanner BLE di HP', run: '?? \\+BLECONN ;t=90000', expect: R`\+BLECONN` });
t('L-10', 0, 'Hentikan iklan', 'AT+BLEADVSTOP', 'OK', '', { ...LB, requires: ['L-01'], run: 'AT+BLEADVSTOP', expect: 'OK' });
t('L-11', 0, 'BLE client: pindai', 'AT+BLEINIT=1, AT+BLESCANPARAM, AT+BLESCAN=1,3', '+BLESCAN:<addr>,<rssi>,... (butuh perangkat BLE di sekitar)', '', { ...LB, run: '- AT+BLEINIT=0\nAT+BLEINIT=1\nAT+BLESCANPARAM=0,0,0,100,50\nAT+BLESCAN=1,3\n?? \\+BLESCAN: ;t=6000\n~ 3000', expect: R`\+BLESCAN:` });
t('L-12', 1, 'Matikan BLE', 'AT+BLEINIT=0', 'OK', '', { ...LB, run: 'AT+BLEINIT=0', expect: 'OK' });

// ======================================================================= 15. BT Classic
const BB = { requires: ['F-08'] };
const BS = { requires: ['F-08', 'B-01'] };
t('B-01', 1, 'Init Bluetooth', 'AT+BTINIT=1', 'OK', '', { ...BB, run: 'AT+BTINIT=1', expect: 'OK' });
t('B-02', 0, 'Init SPP slave', 'AT+BTSPPINIT=2', 'OK', '', { requires: ['F-09', 'B-01'], run: 'AT+BTSPPINIT=2', expect: 'OK' });
t('B-03', 0, 'Mulai SPP', 'AT+BTSPPSTART', 'OK', '', { requires: ['F-09', 'B-02'], run: 'AT+BTSPPSTART', expect: 'OK' });
t('B-04', 0, 'Atur nama', 'AT+BTNAME="{BT_NAME}"', 'OK', '', { ...BS, run: 'AT+BTNAME="{BT_NAME}"', expect: 'OK' });
t('B-05', 0, 'Baca nama', 'AT+BTNAME?', '+BTNAME:{BT_NAME} (dengan/tanpa kutip)', '', { ...BS, run: 'AT+BTNAME?', expect: R`\+BTNAME:"?{BT_NAME}"?` });
t('B-06', 0, 'Bisa ditemukan', 'AT+BTSCANMODE=2', 'OK', '', { ...BS, run: 'AT+BTSCANMODE=2', expect: 'OK' });
t('B-07', 0, 'Atur PIN', 'AT+BTSECPARAM=3,1,"{BT_PIN}"', 'OK', '', { ...BS, run: 'AT+BTSECPARAM=3,1,"{BT_PIN}"', expect: 'OK' });
t('B-08', 0, 'Alamat Bluetooth', 'AT+BTADDR?', '+BTADDR:"xx:xx:..."', '', { ...BS, run: 'AT+BTADDR?', expect: R`\+BTADDR:"?[0-9a-f:]{17}` });
t('B-09', 0, 'Daya Bluetooth', 'AT+BTPOWER?', '+BTPOWER:<min>,<max>', '', { ...BS, run: 'AT+BTPOWER?', expect: R`\+BTPOWER:` });
t('B-10', 0, 'Cari perangkat sekitar', 'AT+BTSTARTDISC=0,10,10', '+BTSTARTDISC:<addr>,... (butuh perangkat BT menyala di sekitar)', '', { ...BS, run: 'AT+BTSTARTDISC=0,10,10 ;t=20000\n?? \\+BTSTARTDISC ;t=15000', expect: R`\+BTSTARTDISC` });
t('B-11', 0, 'HP menemukan perangkat', 'Cari perangkat Bluetooth di HP', '{BT_NAME} terlihat', '', { ...BS, human: 'HP dengan Bluetooth' });
t('B-12', 1, 'Pairing dan sambung SPP', 'Pairing dengan PIN {BT_PIN}, sambung SPP (mis. Serial Bluetooth Terminal)', '+BTSPPCONN:0,"<mac>"', '', { ...BS, human: 'HP dengan aplikasi terminal Bluetooth', run: '?? \\+BTSPPCONN:0 ;t=120000', expect: R`\+BTSPPCONN:0,"` });
t('B-13', 0, 'Cek koneksi SPP', 'AT+BTSPPCONN?', '+BTSPPCONN:0,"<mac>"', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: 'AT+BTSPPCONN?', expect: R`\+BTSPPCONN:0,"` });
t('B-14', 0, 'Data dari HP', 'Ketik teks di HP', '+BTDATA:<len>,<teks>', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: '?? \\+BTDATA ;t=60000', expect: R`\+BTDATA` });
t('B-15', 0, 'Kirim ke HP (mode biasa)', 'AT+BTSPPSEND=0,<len>', 'SEND OK; HP menerima teks', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: 'AT+BTSPPSEND=0,{LEN}\n>> Halo dari ESP\\r\\n', expect: 'SEND OK' });
t('B-16', 0, 'Passthrough dan keluar', 'AT+BTSPPSEND, kirim HALO, tunggu 1 s, +++', 'HP menerima HALO; kembali ke mode perintah', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: 'AT+BTSPPSEND\n>>! HALO\\r\\n\n~ 1200\n>>! +++\n~ 1200\nAT', expect: 'OK' });
t('B-17', 1, 'Blok besar 20 KB', 'Passthrough 20 KB', 'HP menerima utuh, urutan benar', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: 'AT+BTSPPSEND\n>>! {FILL:20480:0}\n~ 3000\n>>! +++\n~ 1200\nAT', expect: 'OK' });
t('B-18', 0, 'HP memutus', 'Putuskan dari HP', '+BTSPPDISCONN:0,"<mac>"', '', { human: 'HP tersambung SPP', requires: ['B-12'], run: '?? BTSPPDISCONN ;t=60000', expect: 'BTSPPDISCONN' });
t('B-19', 0, 'Sambung ulang tanpa init ulang', 'HP menyambung lagi', 'Berhasil', '', { ...BS, human: 'HP dengan aplikasi terminal Bluetooth' });
t('B-20', 0, 'PIN salah', 'Salah PIN saat pairing', 'Pairing gagal, ESP tidak hang', '', { ...BS, human: 'HP dengan Bluetooth' });
t('B-21', 1, 'Matikan Bluetooth', 'AT+BTINIT=0', 'OK', '', { ...BB, run: 'AT+BTINIT=0', expect: 'OK' });
t('B-22', 0, 'Nyala-mati 10x', 'Init sampai scan mode lalu matikan, 10 kali', 'Selalu sukses', '', { ...BB, long: true, run: '@loop 10\nAT+BTINIT=1\nAT+BTSPPINIT=2\nAT+BTSPPSTART\nAT+BTNAME="{BT_NAME}"\nAT+BTSCANMODE=2\nAT+BTINIT=0\n@end', expect: 'OK' });

// ======================================================================= 16. BT + hotspot
const CC = { requires: ['F-08', 'F-01'] };
t('C-01', 1, 'Nyalakan keduanya', 'BT SPP + hotspot + server TCP tanpa restart', 'Semua OK', '', { ...CC, run: `AT+BTINIT=1\nAT+BTSPPINIT=2\nAT+BTSPPSTART\nAT+BTNAME="{BT_NAME}"\nAT+BTSCANMODE=2\nAT+CWMODE=2\nAT+CWSAP="{AP_SSID}","{AP_PASS}",{AP_CH},3,2\n${CLEAN_AP}\nAT+CIPMUX=1\nAT+CIPSERVER=1,80`, expect: R`AT\+CIPSERVER=1,80\s*\n[\s\S]*OK` });
t('C-02', 1, 'Sisa RAM saat keduanya aktif', 'AT+SYSRAM?', '+SYSRAM:<sisa> > 20000', 'Catat angkanya', { ...CC, requires: ['C-01'], run: 'AT+SYSRAM?', expect: R`\+SYSRAM:([2-9]\d{4}|\d{6,})` });
t('C-03', 0, 'Dua HP sekaligus', 'HP-A via Bluetooth, HP-B via hotspot membuka halaman', 'Keduanya jalan, tidak restart', '', { ...CC, human: 'dua HP' });
t('C-04', 0, 'Data besar bersamaan', 'Data besar lewat BT sambil HP-B memuat halaman', 'Tidak ada data hilang atau restart', '', { ...CC, human: 'dua HP' });
t('C-05', 0, 'Matikan BT, hotspot tetap', 'AT+BTINIT=0 saat hotspot menyala', 'OK; hotspot tetap jalan', '', { ...CC, requires: ['C-01'], run: 'AT+BTINIT=0\nAT+CWSAP?', expect: R`\+CWSAP:"{AP_SSID}"` });
t('C-06', 0, 'Matikan hotspot, BT tetap', 'Matikan hotspot saat BT tersambung', 'BT tetap tersambung', '', { ...CC, human: 'HP tersambung SPP' });
t('C-07', 0, 'Stabil 10 menit', 'Biarkan keduanya menyala 10 menit', 'Tidak restart sendiri', '', { ...CC, requires: ['C-01'], long: true, run: '~ 600000\nAT+SYSRAM?', expect: R`\+SYSRAM:` });
t('C-08', 0, 'Bersihkan', 'Matikan BT dan hotspot', 'OK', '', { ...CC, run: '- AT+BTINIT=0\n- AT+CIPSERVER=0,1\nAT+CIPMUX=0\nAT+CWMODE=1', expect: 'OK' });

// ======================================================================= 17. Sistem berkas
const FSX = { requires: ['F-13'] };
t('FS-01', 0, 'Mount', 'AT+FSMOUNT=1', 'OK (ERROR bila sudah ter-mount)', '', { ...FSX, run: 'AT+FSMOUNT=1', expect: 'OK|ERROR' });
t('FS-02', 0, 'Daftar berkas', 'AT+FS=0,4,"."', '+FS:... lalu OK', '', { ...FSX, run: 'AT+FS=0,4,"."', expect: 'OK' });
t('FS-03', 1, 'Tulis berkas', 'AT+FS=0,1,"ujiat.txt",0,<len> lalu data', 'OK', '', { ...FSX, run: '- AT+FS=0,0,"ujiat.txt"\nAT+FS=0,1,"ujiat.txt",0,{LEN}\n>> halo-ujiat-fs', expect: 'OK' });
t('FS-04', 0, 'Ukuran berkas', 'AT+FS=0,3,"ujiat.txt"', '+FS:13', '', { ...FSX, requires: ['FS-03'], run: 'AT+FS=0,3,"ujiat.txt"', expect: R`\+FS:13` });
t('FS-05', 1, 'Baca berkas', 'AT+FS=0,2,"ujiat.txt",0,13', 'Isi halo-ujiat-fs', '', { ...FSX, requires: ['FS-03'], run: 'AT+FS=0,2,"ujiat.txt",0,13', expect: 'halo-ujiat-fs' });
t('FS-06', 0, 'Hapus berkas', 'AT+FS=0,0,"ujiat.txt"', 'OK', '', { ...FSX, requires: ['FS-03'], run: 'AT+FS=0,0,"ujiat.txt"', expect: 'OK' });
t('FS-07', 0, 'Baca berkas terhapus', 'AT+FS=0,2,"ujiat.txt",0,13', 'ERROR', '', { ...FSX, requires: ['FS-06'], run: 'AT+FS=0,2,"ujiat.txt",0,13', expect: 'ERROR' });

// ======================================================================= 18. OTA
const OO = { requires: ['F-15'], needs: 'net' };
t('O-01', 1, 'Siapkan firmware', 'Upload .bin aplikasi (bukan factory) di tab OTA dan pilih sebagai aktif', 'Magic 0xE9, ukuran < partisi OTA', '', { requires: ['F-15'], human: 'upload file di tab OTA' });
t('O-02', 1, 'OTA lewat HTTPS', 'AT+USEROTA=<len> lalu URL https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}', 'Unduhan 100% di server, ESP restart, ready', 'Mengganti firmware ESP', { ...OO, precheck: 'otaFile', run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ready ;t=300000\n?ev ota .*selesai', expect: 'ready', restart: true });
t('O-03', 0, 'OTA lewat HTTP', 'URL http://...', 'Unduhan 100%, ESP restart', '', { ...OO, precheck: 'otaFile', run: 'AT+USEROTA={LEN}\n>> http://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ready ;t=300000', expect: 'ready', restart: true });
t('O-04', 0, 'File rusak', 'Buat rusak.bin di tab OTA, lalu OTA ke file itu', 'ERROR; firmware lama tetap jalan', '', { ...OO, run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/rusak.bin\n?? ERROR|FAIL ;t=120000\n~ 2000\nAT', expect: 'ERROR|FAIL' });
t('O-05', 0, 'Unduhan terputus', 'Atur "Putus unduhan di 50%" di tab OTA, lalu OTA', 'ERROR; firmware lama tetap jalan', 'Kembalikan ke 0% setelahnya', { ...OO, human: 'atur putus unduhan di tab OTA', precheck: 'otaFile', run: 'AT+USEROTA={LEN}\n>> https://{HOST}/ota/{TOPIC_ID}/{OTA_FILE}\n?? ERROR|FAIL ;t=300000\n~ 2000\nAT', expect: 'ERROR|FAIL' });
t('O-06', 0, 'Versi setelah OTA', 'AT+GMR', 'Versi sesuai firmware baru', '', { requires: ['F-15'], run: 'AT+GMR', expect: 'AT version:' });

// ======================================================================= 19. Perintah lama
t('D-01', 0, 'AT+UART (lama)', 'AT+UART=115200,8,1,0,0', 'OK', 'Pengganti: AT+UART_DEF / AT+UART_CUR', { run: 'AT+UART=115200,8,1,0,0', expect: 'OK' });
t('D-02', 0, 'AT+UART? (lama)', 'AT+UART?', '+UART:<baud>,8,1,0,<flow>', 'Baud bisa tampil 115201', { run: 'AT+UART?', expect: R`\+UART:\d+,8,1,0,\d` });
t('D-03', 0, 'AT+CIPSTATUS (lama)', 'AT+CIPSTATUS', 'STATUS:<n>', 'Pengganti: AT+CIPSTATE?', { run: 'AT+CIPSTATUS', expect: R`STATUS:\d` });
t('D-04', 0, 'AT+CIPRECVMODE (lama)', 'AT+CIPRECVMODE=1, lalu =0', 'OK', 'Pengganti: AT+CIPRECVTYPE', { run: '- AT+CIPCLOSE\nAT+CIPRECVMODE=1\nAT+CIPRECVMODE=0', expect: R`OK[\s\S]*OK` });
t('D-05', 0, 'AT+CWJAP_CUR (sangat lama)', 'AT+CWJAP_CUR?', 'OK atau ERROR; catat untuk host lama', 'Informasi saja', { run: 'AT+CWJAP_CUR?', expect: 'OK|ERROR' });

// ======================================================================= 20. Ketahanan
t('R-01', 0, 'Perintah salah', 'AT+ASAL lalu AT', 'ERROR; perintah berikutnya tetap jalan', '', { run: 'AT+ASAL\nAT', expect: R`ERROR[\s\S]*OK` });
t('R-02', 0, '100 perintah beruntun', 'AT 100x, jeda 100 ms', '100x OK', '', { run: '@loop 100\nAT\n~ 100\n@end', expect: R`(OK[\s\S]*){100}` });
t('R-03', 0, 'Perintah panjang', 'Perintah ±250 karakter', 'OK atau ERROR, tidak hang', '', { run: '- AT+CWQAP\nAT+CWJAP="' + 'x'.repeat(230) + '","12345678" ;t=30000\nAT', expect: R`(OK|ERROR|FAIL)[\s\S]*OK` });
t('R-04', 0, 'Data tanpa CR/LF', 'Kirim "AT" tanpa akhiran, lalu AT normal', 'Perintah berikutnya tetap OK', '', { run: '>>! AT\n~ 1500\nAT', expect: 'OK' });
t('R-05', 0, 'Cabut-pasang daya', 'Cabut dan pasang daya 10x', 'Selalu ready dan menjawab AT', '', { human: 'cabut-pasang daya' });
t('R-06', 0, 'Uji 1 jam', 'Wi-Fi + TCP + CIPSEND terus-menerus 1 jam', 'Tidak restart; SYSRAM tidak turun terus', '360 putaran x 10 detik', { requires: ['F-02'], needs: 'net', long: true, run: R`AT+SYSRAM?
@loop 360
- AT+CIPCLOSE
AT+CIPSTART="TCP","{HOST}",80 ;t=20000
AT+CIPSEND={LEN}
>> POST {T}/sink HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 1900\r\nConnection: close\r\n\r\n
AT+CIPSEND=1900
>> {FILL:1900:0}
?? CLOSED ;t=15000
AT+SYSRAM?
~ 8000
@end`, expect: 'SYSRAM' });
t('R-07', 0, 'Ukuran firmware', 'Bandingkan ukuran .bin dengan partisi OTA (tab OTA)', 'Lebih kecil dari partisi; catat sisa', '', { human: 'cek di tab OTA' });

// ----------------------------------------------------------------------- turunan otomatis
const NET_RE = /\{HOST\}|test\.mosquitto|emqx|tcpbin|pool\.ntp|CIPSNTP|CIPDOMAIN|AT\+PING|MQTTCONN=|HTTPC|HTTPGETSIZE|WSOPEN|USEROTA/;
for (const tc of L) {
  if (tc.run && !('needs' in tc) && NET_RE.test(tc.run)) tc.needs = 'net';
  if (tc.needs === undefined) delete tc.needs;
  if (tc.run && tc.restart === undefined) tc.restart = /AT\+RST|AT\+GSLP|AT\+RESTORE|AT\+USEROTA/.test(tc.run);
  if (!tc.cmd && tc.run) tc.cmd = tc.run;
}
export const TESTS = L;

// Naikkan bila arti ID uji berubah; server membuat putaran baru otomatis
export const CATALOG_VERSION = 3;
