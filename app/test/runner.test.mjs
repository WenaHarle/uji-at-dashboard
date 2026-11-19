// Uji runner Uji AT terhadap simulator ESP-AT.
// Jalankan: node test/runner.test.mjs   (dari folder app/)
import '../public/assets/runner.js';
import { TESTS, SECTIONS } from '../src/tests.js';
import { SimESP } from './sim-esp.mjs';

const UR = globalThis.UjiRunner;
const byId = (id) => { const t = TESTS.find((x) => x.id === id); if (!t) throw new Error('tidak ada uji ' + id); return t; };
let passed = 0, failed = 0;
const fails = [];

function setup(simOpts = {}, settings = {}) {
  const sim = new SimESP(simOpts);
  const results = {};
  const logs = [];
  const st = { ssid: 'labwifi', wifiPass: 'rahasia123', btName: 'TEST-BT', autoWifi: true, ...settings };
  const runner = UR.createRunner({
    write: (b) => sim.write(b),
    rx: () => sim.rx(),
    ctx: () => ({
      HOST: 'ujiat.example.com', T: '/t/abc123', WS: '/ws/abc123', SSID: st.ssid || '<ssid>', PASS: st.wifiPass,
      MQTT_USER: 'u-abc123', MQTT_PASS: 'x', TOPIC: 'ujiat/abc123', TOPIC_ID: 'abc123', OTA_FILE: 'a.bin', OTA_FILE_SET: false,
      BT_NAME: st.btName, BT_PIN: '1234', AP_SSID: 'ESP-AT-TEST', AP_PASS: 'esp-at-12345', AP_CH: 6, BLE_NAME: 'ESP-AT-BLE', MDNS: 'esp-at',
    }),
    certs: () => ({ ca_bundle: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n' }),
    action: async (name, args) => {
      if (name === 'hold-push') return { count: sim.holdPush(args.join(' ')) };
      if (name === 'hold-close') return { count: sim.holdClose() };
      return { count: 0 };
    },
    findEvent: (re, since) => sim.events.find((e) => e.id > since && re.test(e.summary)),
    lastEventId: () => sim.evSeq,
    status: (id) => results[id]?.status || 'Belum diuji',
    save: async (id, p) => { results[id] = p; },
    log: (k, t) => logs.push(`[${k}] ${t}`),
    progress: () => {},
    settings: () => st,
  });
  return { sim, runner, results, logs };
}

async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    fails.push(name);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').join('\n      ')}`);
  }
}
function expectStatus(results, id, want) {
  const got = results[id]?.status;
  if (got !== want) throw new Error(`${id}: diharapkan ${want}, dapat ${got}\n--- hasil aktual ---\n${(results[id]?.actual || '').slice(0, 900)}`);
}
function expectIn(results, id, text) {
  if (!(results[id]?.actual || '').includes(text)) throw new Error(`${id}: hasil aktual tidak memuat "${text}"\n${(results[id]?.actual || '').slice(0, 600)}`);
}

console.log('Uji runner vs simulator ESP-AT\n');

await scenario('Katalog: semua skrip valid (regex, {LEN}, loop, prasyarat ada)', async () => {
  const ids = new Set(TESTS.map((t) => t.id));
  const keys = SECTIONS.map((s) => s.key);
  const problems = [];
  if (ids.size !== TESTS.length) problems.push('ID ganda');
  for (const t of TESTS) {
    if (!keys.some((k) => t.id.startsWith(k + '-'))) problems.push(`${t.id}: tidak punya bagian`);
    for (const r of t.requires || []) if (!ids.has(r)) problems.push(`${t.id}: prasyarat ${r} tidak ada`);
    if (t.expect) try { new RegExp(UR.resolve(t.expect, {}, 're')); } catch (e) { problems.push(`${t.id}: expect ${e.message}`); }
    if (!t.run) continue;
    const lines = t.run.split('\n');
    let depth = 0;
    lines.forEach((l, i) => {
      const [line] = UR.splitTimeout(l);
      const body = line.replace(/^- /, '');
      if (!/^(AT|>>|\?\?|\?ev|~ \d+|!(hold-push|hold-close|ws-push|ws-close|mqtt-pub|wifi|net)\b|@loop \d+|@end)/.test(body)) problems.push(`${t.id}: baris tak dikenal ${JSON.stringify(line)}`);
      if (/^@loop/.test(line)) depth++;
      if (/^@end/.test(line)) depth--;
      if (/^\?\?|^\?ev/.test(line)) try { new RegExp(line.replace(/^\?ev|^\?\?/, '').trim()); } catch (e) { problems.push(`${t.id}: regex tunggu ${e.message}`); }
      if (line.includes('{LEN}') && UR.nextPayloadLine(lines, i) == null) problems.push(`${t.id}: {LEN} tanpa payload`);
    });
    if (depth) problems.push(`${t.id}: @loop tidak seimbang`);
    if (/STM|mertani/i.test(JSON.stringify(t))) problems.push(`${t.id}: masih menyebut STM/mertani`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`      ${TESTS.length} uji, ${TESTS.filter((t) => t.run).length} punya skrip, ${TESTS.filter((t) => t.human).length} butuh tindakan, ${TESTS.filter((t) => t.long).length} panjang`);
});

await scenario('E-03 lulus walau MQTT terdaftar sebelum BT', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('E-03'));
  expectStatus(results, 'E-03', 'Lulus');
});

await scenario('E-08 menerima +UART_CUR:115201 (pembulatan baud)', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('E-08'));
  expectStatus(results, 'E-08', 'Lulus');
});

await scenario('W-17 / W-18 menerima "+CWJAP:n" diikuti ERROR (bukan FAIL)', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('W-17'));
  await runner.runTest(byId('W-18'));
  expectStatus(results, 'W-17', 'Lulus');
  expectStatus(results, 'W-18', 'Lulus');
});

await scenario('B-05 menerima +BTNAME tanpa kutip', async () => {
  const { runner, results } = setup();
  await runner.runMany([byId('F-08'), byId('B-01'), byId('B-04'), byId('B-05')]);
  expectStatus(results, 'B-05', 'Lulus');
});

await scenario('Wi-Fi diputus (W-16), lalu N-07 menyambung ulang otomatis sebelum uji', async () => {
  const { sim, runner, results } = setup();
  sim.wifi = true;
  await runner.runTest(byId('W-16'));
  if (sim.wifi) throw new Error('W-16 tidak memutus Wi-Fi');
  await runner.runTest(byId('N-07'));
  expectStatus(results, 'N-07', 'Lulus');
  expectIn(results, 'N-07', 'disambungkan ulang');
});

await scenario('Setelah AT+RST, uji SNTP (N-02) tetap lulus karena prasyarat menyambung Wi-Fi', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('E-10'));
  expectStatus(results, 'E-10', 'Lulus');
  await runner.runTest(byId('N-02'));
  expectStatus(results, 'N-02', 'Lulus');
});

await scenario('SSID kosong + Wi-Fi putus: gagal dengan pesan prasyarat yang jelas (bukan timeout)', async () => {
  const { runner, results } = setup({}, { ssid: '' });
  await runner.runTest(byId('N-07'));
  expectStatus(results, 'N-07', 'Gagal');
  expectIn(results, 'N-07', 'PRASYARAT GAGAL');
});

await scenario('Fitur BT tidak ada: F-08 Gagal, uji BT lain otomatis Lewati', async () => {
  const noBt = ['CWMODE', 'CIPSTART', 'MQTTCONN', 'HTTPCLIENT'];
  const { runner, results } = setup({ features: noBt });
  const sum = await runner.runMany(['F-08', 'B-01', 'B-02', 'B-04', 'B-05', 'B-21'].map(byId));
  expectStatus(results, 'F-08', 'Gagal');
  for (const id of ['B-01', 'B-04', 'B-05', 'B-21']) expectStatus(results, id, 'Lewati');
  expectStatus(results, 'B-02', 'Lewati');
  if (sum.skip !== 5) throw new Error(`jumlah dilewati ${sum.skip}, harusnya 5`);
});

await scenario('Koneksi TCP yang tertinggal tidak merusak uji berikutnya (T-11 lalu T-13, T-08)', async () => {
  const { sim, runner, results } = setup({ proxy80: true });
  sim.wifi = true;
  sim.conn = { type: 'TCP', host: '192.0.2.1', port: 80, buf: '' }; // sisa dari uji sebelumnya
  await runner.runTest(byId('T-11'));
  expectStatus(results, 'T-11', 'Lulus');
  await runner.runTest(byId('T-13'));
  expectStatus(results, 'T-13', 'Lulus');
  await runner.runTest(byId('T-08'));
  expectStatus(results, 'T-08', 'Lulus');
});

await scenario('T-02 → T-04 → T-05 (kiriman server lewat hold) → T-06', async () => {
  const { runner, results } = setup();
  await runner.runMany(['F-02', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-07'].map(byId));
  for (const id of ['T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-07']) expectStatus(results, id, 'Lulus');
});

await scenario('T-09 kirim 4 x 1900 byte, server melihat pola utuh', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('T-09'));
  expectStatus(results, 'T-09', 'Lulus');
});

await scenario('Crash "Will force to restart" dideteksi, lalu uji berikutnya pulih', async () => {
  const { runner, results } = setup({ crashOn: 'https' });
  await runner.runTest(byId('P-02'));
  expectStatus(results, 'P-02', 'Gagal');
  expectIn(results, 'P-02', 'RESTART SENDIRI');
  await runner.runTest(byId('N-07'));
  expectStatus(results, 'N-07', 'Lulus');
});

await scenario('ESP sedang "busy" saat uji dimulai: runner menunggu, lalu lulus', async () => {
  const { sim, runner, results } = setup();
  sim.busyUntil = Date.now() + 1500;
  await runner.runTest(byId('E-01'));
  expectStatus(results, 'E-01', 'Lulus');
});

await scenario('H-08 CIPMUX=1 berhasil walau ada koneksi TCP terbuka', async () => {
  const { sim, runner, results } = setup();
  sim.wifi = true;
  sim.conn = { type: 'TCP', host: 'x', port: 80, buf: '' };
  await runner.runTest(byId('H-08'));
  expectStatus(results, 'H-08', 'Lulus');
});

await scenario('S-02 menulis PEM dengan akhiran \\0 dan panjang yang tepat', async () => {
  const { sim, runner, results } = setup();
  await runner.runTest(byId('S-02'));
  expectStatus(results, 'S-02', 'Lulus');
  const v = sim.mfg['client_ca.0'];
  if (!v || !v.endsWith('\0') || !v.startsWith('-----BEGIN')) throw new Error('isi slot salah: ' + JSON.stringify(v));
});

await scenario('U-01 UDP: permintaan NTP 48 byte dijawab +IPD,48', async () => {
  const { runner, results } = setup();
  await runner.runTest(byId('U-01'));
  expectStatus(results, 'U-01', 'Lulus');
});

await scenario('MQTT gagal (M-02): uji MQTT yang butuh koneksi broker otomatis Lewati', async () => {
  const { runner, results } = setup({ mqttOk: false });
  await runner.runMany(['F-04', 'M-02', 'M-03', 'M-04', 'M-06'].map(byId));
  expectStatus(results, 'M-02', 'Gagal');
  for (const id of ['M-03', 'M-04', 'M-06']) expectStatus(results, id, 'Lewati');
});

await scenario('Jalankan semua: uji butuh tindakan & uji panjang dilewati, tidak diberi status', async () => {
  const { runner, results } = setup();
  const sum = await runner.runMany(['H-16', 'H-17', 'W-19', 'R-05'].map(byId));
  if (Object.keys(results).length) throw new Error('ada status yang ditulis: ' + Object.keys(results));
  if (sum.manual !== 4) throw new Error('manual=' + sum.manual);
});

await scenario('Escape AT untuk SSID berisi koma/kutip', async () => {
  const { sim, runner, results } = setup({ ssid: 'kafe, "lt2"', pass: 'a,b"c' }, { ssid: 'kafe, "lt2"', wifiPass: 'a,b"c' });
  await runner.runTest(byId('W-05'));
  expectStatus(results, 'W-05', 'Lulus');
  if (!sim.log.some((l) => l.includes('kafe\\, \\"lt2\\"'))) throw new Error('SSID tidak di-escape: ' + sim.log.join(' | '));
});

console.log(`\n${passed} lulus, ${failed} gagal${failed ? ': ' + fails.join('; ') : ''}`);
process.exit(failed ? 1 : 0);
