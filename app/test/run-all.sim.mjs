// "Jalankan semua" seluruh katalog di simulator: memastikan runner tidak crash/macet.
// Hasil Gagal wajar untuk perintah yang tidak ditiru simulator. Jalankan: node test/run-all.sim.mjs
import '../public/assets/runner.js';
import { TESTS } from '../src/tests.js';
import { SimESP } from './sim-esp.mjs';

const sim = new SimESP();
const results = {};
let errors = 0;
const runner = globalThis.UjiRunner.createRunner({
  write: (b) => sim.write(b), rx: () => sim.rx(),
  ctx: () => ({ HOST: 'ujiat.example.com', T: '/t/abc123', WS: '/ws/abc123', SSID: 'labwifi', PASS: 'rahasia123', MQTT_USER: 'u', MQTT_PASS: 'p', TOPIC: 'ujiat/abc123', TOPIC_ID: 'abc123', OTA_FILE: 'a.bin', OTA_FILE_SET: false, BT_NAME: 'TEST-BT', BT_PIN: '1234', AP_SSID: 'ESP-AT-TEST', AP_PASS: 'esp-at-12345', AP_CH: 6, BLE_NAME: 'B', MDNS: 'esp-at' }),
  certs: () => ({ ca_bundle: 'PEM', mosquitto_org: 'PEM' }),
  action: async (name) => ({ count: name === 'hold-push' ? sim.holdPush('x') : name === 'hold-close' ? sim.holdClose() : 0 }),
  findEvent: (re, since) => sim.events.find((e) => e.id > since && re.test(e.summary)),
  lastEventId: () => sim.evSeq,
  status: (id) => results[id]?.status || 'Belum diuji',
  save: async (id, p) => { results[id] = p; if (/Kesalahan runner/.test(p.actual)) { errors++; console.log('RUNNER ERROR', id, p.actual); } },
  log: () => {}, progress: () => {}, settings: () => ({ autoWifi: true }),
});
const t0 = Date.now();
const sum = await runner.runMany(TESTS.filter((t) => t.run));
const count = (s) => Object.values(results).filter((r) => r.status === s).length;
console.log(`selesai ${((Date.now() - t0) / 1000).toFixed(0)} s · lulus ${count('Lulus')} · gagal ${count('Gagal')} · lewati ${count('Lewati')} · manual/dilewati ${sum.manual} · error runner ${errors}`);
const slow = Object.entries(results).map(([id, r]) => [id, Number((/durasi ([\d.]+) s/.exec(r.actual) || [])[1] || 0)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('paling lama:', slow.map(([id, d]) => `${id} ${d}s`).join(', '));
process.exit(errors ? 1 : 0);
