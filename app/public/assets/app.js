'use strict';
// Uji AT Dashboard - frontend
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();

let S = null; // state dari server
let certs = {}; // key -> pem
const events = [];
let lastEventId = 0;

// ------------------------------------------------------------------ API
async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Ujiat': '1', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer) ? JSON.stringify(opts.body) : opts.body,
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Belum login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Disalin'); } catch { toast('Gagal menyalin', true); }
}

// ------------------------------------------------------------------ placeholder
function ctx() {
  return {
    HOST: S.host,
    T: '/t/' + S.user.uid,
    WS: '/ws/' + S.user.uid,
    SSID: S.settings.ssid || '<ssid>',
    PASS: S.settings.wifiPass || '<password>',
    MQTT_USER: S.mqttUser,
    MQTT_PASS: S.mqttPass,
    TOPIC: S.topic,
    TOPIC_ID: S.user.uid,
    OTA_FILE: S.settings.otaFile || '<file>.bin',
  };
}
function resolvePh(s) {
  const c = ctx();
  return String(s).replace(/\{(HOST|T|WS|SSID|PASS|MQTT_USER|MQTT_PASS|TOPIC_ID|TOPIC|OTA_FILE)\}/g, (_, k) => c[k]);
}
function unescapeRaw(s) {
  return s.replace(/\\(r|n|t|0|\\)/g, (_, c) => ({ r: '\r', n: '\n', t: '\t', 0: '\0', '\\': '\\' })[c]);
}
const PAT = '0123456789abcdefghijklmnopqrstuvwxyz';
function fill(n, off = 0) { let s = ''; for (let i = 0; i < n; i++) s += PAT[(off + i) % PAT.length]; return s; }
function payloadBytes(raw) {
  let s = unescapeRaw(resolvePh(raw));
  s = s.replace(/\{FILL:(\d+)(?::(\d+))?\}/g, (_, n, o) => fill(Number(n), Number(o || 0)));
  s = s.replace(/\{PEM:([a-z_]+)\}/g, (_, k) => {
    if (!certs[k]) throw new Error(`Sertifikat "${k}" belum tersedia (lihat tab Sertifikat)`);
    return certs[k];
  });
  return enc.encode(s);
}
function splitTimeout(line) {
  const m = line.match(/^(.*?)\s;t=(\d+)\s*$/);
  return m ? [m[1], Number(m[2])] : [line, null];
}
function nextPayloadLine(lines, i) {
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.startsWith('>>')) return l.replace(/^>>!?\s?/, '');
    if (/^AT/i.test(l)) return null;
  }
  return null;
}
function expandLoops(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^@loop\s+(\d+)/);
    if (!m) { out.push(lines[i]); continue; }
    let depth = 1, j = i + 1;
    for (; j < lines.length; j++) {
      if (/^@loop/.test(lines[j])) depth++;
      if (/^@end/.test(lines[j]) && --depth === 0) break;
    }
    const body = expandLoops(lines.slice(i + 1, j));
    for (let k = 0; k < Number(m[1]); k++) out.push(...body);
    i = j;
  }
  return out;
}
function lenFor(lines, i) {
  const p = nextPayloadLine(lines, i);
  if (p == null) return '?';
  try { return payloadBytes(p).length; } catch { return '?'; }
}
// Tampilan perintah (untuk dibaca / disalin manual)
function renderCmd(tc) {
  if (!tc.run) return [h('span', {}, resolvePh(tc.cmd))];
  const lines = tc.run.split('\n');
  const out = [];
  lines.forEach((raw, i) => {
    const [line] = splitTimeout(raw);
    let el;
    if (line.startsWith('>>')) {
      let p = resolvePh(line.replace(/^>>!?\s?/, ''));
      p = p.replace(/\{FILL:(\d+)(?::(\d+))?\}/g, (_, n, o) => `‹${n} byte pola${o ? ' mulai ' + o : ''}›`);
      p = p.replace(/\{PEM:([a-z_]+)\}/g, (_, k) => `‹PEM ${k}${certs[k] ? ', ' + enc.encode(certs[k]).length + ' byte' : ''}›`);
      el = h('span', { class: 'c-raw' }, (line.startsWith('>>!') ? '» (langsung) ' : '» ') + p);
    } else if (line.startsWith('??')) el = h('span', { class: 'c-meta' }, `[tunggu serial: ${line.slice(2).trim()}]`);
    else if (line.startsWith('?ev')) el = h('span', { class: 'c-meta' }, `[bukti server: ${line.slice(3).trim()}]`);
    else if (line.startsWith('~')) el = h('span', { class: 'c-meta' }, `[jeda ${line.slice(1).trim()} ms]`);
    else if (line.startsWith('!')) el = h('span', { class: 'c-meta' }, `[dashboard: ${resolvePh(line.slice(1))}]`);
    else if (line.startsWith('@loop')) el = h('span', { class: 'c-meta' }, `[ulangi ${line.split(/\s+/)[1]}x:]`);
    else if (line.startsWith('@end')) el = h('span', { class: 'c-meta' }, '[akhir ulang]');
    else el = h('span', {}, resolvePh(line).replace('{LEN}', lenFor(lines, i)));
    out.push(el, '\n');
  });
  out.pop();
  return out;
}
const isServerTest = (tc) => /\{HOST\}|\{T\}|test\.mosquitto|emqx|tcpbin|SNTP|CIPDOMAIN|PING|SYSMFG|USEROTA|\/t\/|\/ws|\/mqtt/.test(tc.run || tc.cmd) || ['S', 'M', 'P', 'K', 'O', 'U'].includes(tc.id[0]);

// ------------------------------------------------------------------ Web Serial
const serial = {
  port: null, writer: null, reader: null, rx: '', connected: false,
  async connect() {
    if (!('serial' in navigator)) { toast('Browser ini tidak mendukung Web Serial. Pakai Chrome/Edge desktop.', true); return; }
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: Number($('#baud').value), bufferSize: 65536 });
    this.writer = this.port.writable.getWriter();
    this.connected = true;
    logSys(`Terhubung @ ${$('#baud').value} baud`);
    updateSerialUi();
    this.readLoop();
  },
  async readLoop() {
    const dec = new TextDecoder('utf-8');
    while (this.port && this.port.readable && this.connected) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          const text = dec.decode(value, { stream: true });
          this.rx += text;
          logRx(text);
        }
      } catch (e) {
        logSys('Baca serial berhenti: ' + e.message, 'bad');
      } finally {
        try { this.reader.releaseLock(); } catch {}
      }
      if (!this.connected) break;
      await sleep(200);
    }
  },
  async disconnect() {
    this.connected = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
    logSys('Terputus');
    updateSerialUi();
  },
  async write(bytes) {
    if (!this.connected) throw new Error('Serial belum terhubung');
    await this.writer.write(bytes);
  },
  async sendLine(s) {
    logTx(s + '\n');
    await this.write(enc.encode(s + '\r\n'));
  },
  async sendRaw(bytes) {
    const preview = new TextDecoder().decode(bytes.length > 300 ? bytes.slice(0, 300) : bytes);
    logTx(`» ${JSON.stringify(preview).slice(1, -1)}${bytes.length > 300 ? `… (${bytes.length} byte)` : ''}\n`);
    for (let i = 0; i < bytes.length; i += 1024) await this.write(bytes.slice(i, i + 1024));
  },
};
function updateSerialUi() {
  $('#serialBtn').textContent = serial.connected ? 'Putuskan' : 'Hubungkan';
  $('#serialBtn').className = 'btn sm ' + (serial.connected ? 'danger' : 'primary');
  renderChips();
}
navigator.serial?.addEventListener('disconnect', () => { if (serial.connected) serial.disconnect(); });

// log serial
const slog = () => $('#serialLog');
function appendLog(text, cls) {
  const el = slog();
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const last = el.lastChild;
  if (last && last.className === cls) last.textContent += text;
  else el.append(h('span', { class: cls }, text));
  while (el.childNodes.length > 600) el.firstChild.remove();
  if (el.textContent.length > 300000) el.firstChild.remove();
  if (atBottom) el.scrollTop = el.scrollHeight;
}
const logRx = (t) => appendLog(t.replace(/\r/g, ''), 'rx');
const logTx = (t) => appendLog(t, 'tx');
const logSys = (t, cls = 'sys') => appendLog(`\n# ${t}\n`, cls);

// ------------------------------------------------------------------ runner
const runner = { busy: false, abort: false };
function setRunner(text) {
  $('#runner').hidden = !text;
  $('#runnerText').textContent = text || '';
}
async function waitSerial(re, timeout, from) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (runner.abort) throw new Error('Dihentikan');
    const m = serial.rx.slice(from).match(re);
    if (m) return m;
    await sleep(25);
  }
  return null;
}
async function waitEvent(re, timeout, sinceId) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (runner.abort) throw new Error('Dihentikan');
    const ev = events.find((e) => e.id > sinceId && re.test(e.summary));
    if (ev) return ev;
    await sleep(100);
  }
  return null;
}
async function doAction(line) {
  const [cmd, ...rest] = resolvePh(line.slice(1)).split(' ');
  const arg = rest.join(' ');
  if (cmd === 'hold-push') return api('/api/ctl/hold/push', { method: 'POST', body: { text: arg } });
  if (cmd === 'hold-close') return api('/api/ctl/hold/close', { method: 'POST', body: {} });
  if (cmd === 'ws-push') return api('/api/ctl/ws/push', { method: 'POST', body: { text: arg } });
  if (cmd === 'ws-close') return api('/api/ctl/ws/close', { method: 'POST', body: {} });
  if (cmd === 'mqtt-pub') {
    const [broker, topic, ...p] = rest;
    return api('/api/mqtt/publish', { method: 'POST', body: { broker, topic, payload: p.join(' '), qos: 1 } });
  }
  throw new Error('Aksi tidak dikenal: ' + cmd);
}
const RE_DONE = /(?:^|\n)(OK|ERROR|FAIL|SEND OK|SEND FAIL)\r?\n|busy p/;
const RE_PROMPT = /(?:^|\n)>|(?:^|\n)(ERROR|FAIL)\r?\n|busy p/;
const RE_AFTER_RAW = /SEND OK|SEND FAIL|\+MQTTPUB:(OK|FAIL)|(?:^|\n)(OK|ERROR|FAIL)\r?\n/;
function defaultTimeout(line) {
  if (/CWJAP=/.test(line)) return 25000;
  if (/CIPSTART|MQTTCONN=|HTTPC|WSOPEN|USEROTA|CIPDOMAIN/.test(line)) return 25000;
  if (/AT\+RST|GSLP|RESTORE/.test(line)) return 5000;
  return 10000;
}
async function runTest(tc) {
  if (!tc.run) throw new Error('Tes ini manual');
  if (!serial.connected) throw new Error('Hubungkan serial dulu');
  const lines = expandLoops(tc.run.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('#')));
  const start = serial.rx.length;
  const evStart = lastEventId;
  const notes = [];
  let failed = false, from = start;
  logSys(`▶ ${tc.id} ${tc.name}`);
  for (let i = 0; i < lines.length && !failed; i++) {
    const [line, to] = splitTimeout(lines[i]);
    setRunner(`${tc.id}  ${i + 1}/${lines.length}  ${line.slice(0, 60)}`);
    if (line.startsWith('~')) { await sleep(Number(line.slice(1)) || 0); continue; }
    if (line.startsWith('?ev')) {
      const re = new RegExp(resolvePh(line.slice(3).trim()), 'i');
      const ev = await waitEvent(re, to || 20000, evStart);
      if (ev) notes.push(`server: ${ev.summary}`);
      else { failed = true; notes.push(`TIDAK ada bukti server untuk /${re.source}/`); }
      continue;
    }
    if (line.startsWith('??')) {
      const re = new RegExp(resolvePh(line.slice(2).trim()));
      if (!(await waitSerial(re, to || 15000, from))) { failed = true; notes.push(`TIMEOUT menunggu /${re.source}/`); }
      continue;
    }
    if (line.startsWith('!')) {
      from = serial.rx.length;
      try { const r = await doAction(line); notes.push(`dashboard ${line.slice(1).split(' ')[0]} → ${r.count ?? 'ok'}`); }
      catch (e) { failed = true; notes.push('aksi gagal: ' + e.message); }
      continue;
    }
    if (line.startsWith('>>')) {
      const noWait = line.startsWith('>>!');
      const bytes = payloadBytes(line.replace(/^>>!?\s?/, ''));
      from = serial.rx.length;
      await serial.sendRaw(bytes);
      if (!noWait && !(await waitSerial(RE_AFTER_RAW, to || 15000, from))) { failed = true; notes.push('TIMEOUT setelah kirim data'); }
      continue;
    }
    // perintah AT
    let cmd = resolvePh(line);
    if (cmd.includes('{LEN}')) {
      const p = nextPayloadLine(lines, i);
      cmd = cmd.replace('{LEN}', String(payloadBytes(p).length));
    }
    const wantPrompt = (lines[i + 1] || '').startsWith('>>');
    let m = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(40); // beri jeda kecil supaya ESP siap menerima perintah berikutnya
      from = serial.rx.length;
      await serial.sendLine(cmd);
      m = await waitSerial(wantPrompt ? RE_PROMPT : RE_DONE, to || defaultTimeout(cmd), from);
      if (!m || !/busy/.test(m[0])) break;
      notes.push(`ESP sibuk (busy), kirim ulang: ${cmd.slice(0, 60)}`);
      await waitSerial(/(?:^|\n)(OK|ERROR)\r?\n/, 3000, from); // tunggu perintah sebelumnya selesai
    }
    if (!m) { failed = true; notes.push(`TIMEOUT menunggu OK/ERROR: ${cmd.slice(0, 80)}`); }
    else if (/busy/.test(m[0])) { failed = true; notes.push(`ESP tetap sibuk: ${cmd.slice(0, 80)}`); }
    else if (wantPrompt && /ERROR|FAIL/.test(m[0])) { failed = true; notes.push(`Tidak dapat prompt '>' untuk: ${cmd.slice(0, 80)}`); }
  }
  await sleep(300); // tangkap sisa keluaran yang masih mengalir
  const rawOut = serial.rx.slice(start);
  const out = rawOut.replace(/\r/g, '');
  let expectOk = true;
  if (tc.expect) {
    const re = new RegExp(resolvePh(tc.expect));
    // cocokkan dengan keluaran asli (ada \r) maupun yang sudah dinormalkan
    expectOk = re.test(rawOut) || re.test(out);
    if (!expectOk) notes.push(`Pola hasil tidak cocok: /${resolvePh(tc.expect)}/`);
  }
  const pass = !failed && expectOk;
  const actual = [pass ? 'OTOMATIS: LULUS' : 'OTOMATIS: GAGAL', ...notes, '---', out.length > 1500 ? '…' + out.slice(-1500) : out].join('\n');
  logSys(`${pass ? '✔' : '✘'} ${tc.id} ${pass ? 'Lulus' : 'Gagal'}${notes.length ? ' · ' + notes.filter((n) => /TIMEOUT|TIDAK|gagal|Pola|sibuk/i.test(n)).join('; ') : ''}`, pass ? 'ok' : 'bad');
  await saveResult(tc.id, { status: pass ? 'Lulus' : 'Gagal', actual });
  return pass;
}
async function runMany(list) {
  if (runner.busy) return toast('Runner sedang berjalan', true);
  if (!serial.connected) return toast('Hubungkan serial ESP dulu (panel kanan)', true);
  runner.busy = true; runner.abort = false;
  let ok = 0, bad = 0;
  try {
    for (const tc of list) {
      if (runner.abort) break;
      const row = $(`tr[data-id="${tc.id}"]`);
      row?.classList.add('running');
      row?.scrollIntoView({ block: 'nearest' });
      try { (await runTest(tc)) ? ok++ : bad++; }
      catch (e) { bad++; logSys(`${tc.id}: ${e.message}`, 'bad'); if (e.message === 'Dihentikan') break; }
      row?.classList.remove('running');
    }
  } finally {
    runner.busy = false;
    setRunner('');
    toast(`Selesai: ${ok} lulus, ${bad} gagal`);
  }
}

// ------------------------------------------------------------------ hasil
async function saveResult(id, patch) {
  const r = await api('/api/result', { method: 'POST', body: { id, ...patch } });
  S.results[id] = r.result;
  updateRow(id);
  renderSummary();
}

// ------------------------------------------------------------------ render tabel
const STATUSES = ['Belum diuji', 'Lulus', 'Gagal', 'Lewati'];
function filteredTests() {
  const q = $('#search').value.trim().toLowerCase();
  const sec = $('#secFilter').value;
  const st = $('#statusFilter').value;
  const srv = $('#serverOnly').checked;
  return S.tests.filter((tc) => {
    if (sec && !tc.id.startsWith(sec + '-')) return false;
    if (st && (S.results[tc.id]?.status || 'Belum diuji') !== st) return false;
    if (srv && !isServerTest(tc)) return false;
    if (q && !`${tc.id} ${tc.name} ${tc.cmd} ${tc.run || ''} ${tc.exp}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderTable() {
  const wrap = $('#testTable');
  wrap.replaceChildren();
  const list = filteredTests();
  for (const sec of S.sections) {
    const rows = list.filter((tc) => tc.id.startsWith(sec.key + '-'));
    if (!rows.length) continue;
    const autoRows = rows.filter((r) => r.run);
    const head = h('div', { class: 'sec-head' },
      h('h4', {}, `${sec.id} ${sec.title}`),
      h('span', { class: 'muted small' }, `${rows.length} uji · ${autoRows.length} otomatis`),
      h('span', { class: 'grow' }),
      autoRows.length ? h('button', { class: 'btn sm', onclick: () => runMany(autoRows) }, '▶ Jalankan bagian') : null,
      sec.note ? h('div', { class: 'note' }, resolvePh(sec.note)) : null,
    );
    const table = h('table', { class: 'tt' },
      h('colgroup', {}, ...['id', 'pr', 'name', 'cmd', 'exp', 'note', 'st', 'act'].map((c) => h('col', { class: 'c-' + c }))),
      h('thead', {}, h('tr', {}, ...['ID', '★', 'Uji', 'Perintah / langkah', 'Hasil diharapkan', 'Catatan dokumen', 'Status', 'Hasil aktual / catatan'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map(renderRow)),
    );
    wrap.append(h('div', { class: 'sec' }, head, table));
  }
  if (!wrap.childNodes.length) wrap.append(h('p', { class: 'muted' }, 'Tidak ada uji yang cocok dengan filter.'));
}
function renderRow(tc) {
  const r = S.results[tc.id] || {};
  const status = r.status || 'Belum diuji';
  const sel = h('select', { class: 'st', 'data-v': status, 'aria-label': `Status ${tc.id}`, onchange: (e) => { e.target.dataset.v = e.target.value; saveResult(tc.id, { status: e.target.value }); } },
    ...STATUSES.map((s) => h('option', { selected: s === status }, s)));
  const ta = h('textarea', { rows: 2, placeholder: 'Tempel keluaran serial / catatan', 'aria-label': `Hasil aktual ${tc.id}`, onchange: (e) => saveResult(tc.id, { actual: e.target.value }) });
  ta.value = r.actual || '';
  const pre = h('pre', { class: 'cmd' }, ...renderCmd(tc));
  return h('tr', { 'data-id': tc.id },
    h('td', { class: 'id', 'data-l': 'ID' }, tc.id),
    h('td', { class: 'pr' }, tc.prio ? '★' : ''),
    h('td', { class: 'name', 'data-l': 'Uji' }, tc.name, h('div', { class: 'acts' }, isServerTest(tc) ? h('span', { class: 'badge srv' }, 'server') : null, tc.run ? h('span', { class: 'badge auto' }, 'otomatis') : h('span', { class: 'badge' }, 'manual'))),
    h('td', { 'data-l': 'Perintah / langkah' }, pre, h('div', { class: 'acts' },
      h('button', { class: 'btn ghost sm', onclick: () => copy(pre.textContent) }, 'Salin'),
      tc.run ? h('button', { class: 'btn sm', onclick: () => runMany([tc]) }, '▶ Jalankan') : null)),
    h('td', { 'data-l': 'Hasil diharapkan' }, resolvePh(tc.exp)),
    h('td', { class: 'note', 'data-l': 'Catatan' }, resolvePh(tc.note || '')),
    h('td', { 'data-l': 'Status' }, sel),
    h('td', { 'data-l': 'Hasil aktual' }, ta),
  );
}
function updateRow(id) {
  const old = $(`tr[data-id="${id}"]`);
  const tc = S.tests.find((x) => x.id === id);
  if (old && tc) {
    const running = old.classList.contains('running');
    const n = renderRow(tc);
    if (running) n.classList.add('running');
    old.replaceWith(n);
  }
}
function renderSummary() {
  const c = { Lulus: 0, Gagal: 0, Lewati: 0, 'Belum diuji': 0 };
  for (const tc of S.tests) c[S.results[tc.id]?.status || 'Belum diuji']++;
  const total = S.tests.length;
  const pct = (n) => (n * 100 / total).toFixed(1) + '%';
  const bar = h('span', { class: 'bar' },
    h('i', { style: `width:${pct(c.Lulus)};background:var(--primary)` }),
    h('i', { style: `width:${pct(c.Gagal)};background:var(--destructive)` }),
    h('i', { style: `width:${pct(c.Lewati)};background:var(--muted-foreground)` }));
  $('#summary').replaceChildren(
    h('span', {}, 'Total ', h('b', {}, total)),
    h('span', { class: 'good' }, 'Lulus ', h('b', {}, c.Lulus)),
    h('span', { class: 'bad' }, 'Gagal ', h('b', {}, c.Gagal)),
    h('span', { class: 'warn' }, 'Belum ', h('b', {}, c['Belum diuji'])),
    h('span', {}, 'Lewati ', h('b', {}, c.Lewati)),
    bar);
}
function renderRuns() {
  const sel = $('#runSel');
  sel.replaceChildren(...S.runs.map((r) => h('option', { value: r.id, selected: r.id === S.currentRun }, r.name)));
  const q = '?run=' + encodeURIComponent(S.currentRun);
  $('#exportCsv').href = '/api/export.csv' + q;
  $('#report').href = '/api/report.html' + q;
  $('#reportTested').href = '/api/report.html' + q + '&only=tested';
}
function renderChips() {
  if (!S) return;
  const chip = (cls, text) => h('span', { class: 'chip ' + cls }, text);
  const b = S.brokers || {};
  $('#chips').replaceChildren(
    chip(S.testMode ? 'ok' : 'bad', S.testMode ? 'mode uji aktif' : 'mode uji mati'),
    chip(serial.connected ? 'ok' : 'warn', serial.connected ? 'serial terhubung' : 'serial belum'),
    ...Object.entries(b).map(([k, v]) => chip(v.status === 'tersambung' ? 'ok' : 'bad', `${k === 'own' ? 'broker sendiri' : v.label}`)),
    chip('', S.topic),
  );
}

// ------------------------------------------------------------------ log server (SSE)
function evMatchesFilter(ev) {
  const f = $('#evFilter').value;
  return !f || new RegExp('^(' + f + ')').test(ev.type);
}
function renderEvent(ev) {
  if (!evMatchesFilter(ev)) return;
  const log = $('#evLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const time = new Date(ev.t).toLocaleTimeString('id-ID', { hour12: false });
  const el = h('div', { class: 'ev t-' + ev.type, title: 'Klik untuk detail' },
    h('time', {}, time), h('span', { class: 'ty' }, ev.type), ' ', ev.summary.slice(ev.type.length + 1));
  el.addEventListener('click', () => {
    if (el.querySelector('pre')) return el.querySelector('pre').remove();
    const { id, t, type, summary, ...rest } = ev;
    el.append(h('pre', {}, JSON.stringify(rest, null, 1)));
  });
  log.append(el);
  while (log.childNodes.length > 800) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function rerenderEvents() {
  $('#evLog').replaceChildren();
  events.slice(-400).forEach(renderEvent);
}
function startSse() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.id <= lastEventId) return;
    lastEventId = ev.id;
    events.push(ev);
    if (events.length > 3000) events.splice(0, 1000);
    renderEvent(ev);
    if (/^(hold|ws|broker)$/.test(ev.type)) refreshConns();
  };
  es.onerror = () => {
    // EventSource tersambung ulang sendiri; cek sesi
    fetch('/api/state').then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
  };
}

// ------------------------------------------------------------------ kontrol
let connTimer = null;
async function refreshConns() {
  clearTimeout(connTimer);
  connTimer = setTimeout(async () => {
    try {
      const c = await api('/api/conns');
      const fmt = (x, kind) => h('div', {}, h('code', {}, `#${x.id}`), x.ip, h('span', { class: 'muted' }, new Date(x.since).toLocaleTimeString('id-ID', { hour12: false })),
        h('button', { class: 'btn ghost sm', onclick: () => api(`/api/ctl/${kind}/push`, { method: 'POST', body: { id: x.id, text: $(kind === 'hold' ? '#holdText' : '#wsText').value } }) }, 'kirim'),
        h('button', { class: 'btn ghost sm', onclick: () => api(`/api/ctl/${kind}/close`, { method: 'POST', body: { id: x.id } }) }, 'tutup'));
      $('#holdList').replaceChildren(...(c.holds.length ? c.holds.map((x) => fmt(x, 'hold')) : ['Belum ada koneksi hold.']));
      $('#wsList').replaceChildren(...(c.ws.length ? c.ws.map((x) => fmt(x, 'ws')) : ['Belum ada klien WebSocket.']));
      S.brokers = c.brokers;
      S.testMode = c.testMode;
      $('#testMode').checked = !!c.testMode;
      $('#brokerStatus').textContent = Object.entries(c.brokers).map(([k, v]) => `${v.label}: ${v.status}`).join(' · ');
      renderChips();
    } catch {}
  }, 150);
}
function renderEndpoints() {
  const H = S.host + '/t/' + S.user.uid;
  const W = S.host;
  const items = [
    ['https://' + H + '/t/hello', 'teks "hello"'],
    ['https://' + H + '/t/echo', 'echo method, query, body'],
    ['https://' + H + '/t/headers', 'echo header'],
    ['https://' + H + '/t/sink', 'POST/PUT, hitung byte + cek pola (?off=n)'],
    ['https://' + H + '/t/size/<n>', 'n byte pola'],
    ['https://' + H + '/t/status/<kode>', 'status HTTP sesuai kode'],
    ['https://' + H + '/t/redirect/<n>', 'redirect n kali lalu hello'],
    ['https://' + H + '/t/delay/<ms>', 'hello setelah jeda'],
    ['https://' + H + '/t/chunked', '5 chunk'],
    ['https://' + H + '/t/hold', 'koneksi ditahan, dikontrol dari dashboard'],
    ['https://' + H + '/t/close', 'balas lalu tutup koneksi'],
    ['https://' + H + '/t/custom', 'respons custom'],
    ['https://' + H + '/t/basic', 'basic auth ujiat / ujiat123'],
    ['wss://' + W + '/ws/' + S.user.uid, 'WebSocket echo (ECHO:<pesan>)'],
    ['wss://' + W + '/mqtt', `MQTT over WebSocket · user ${S.mqttUser} · topik ${S.topic}/…`],
    ['https://' + W + '/ota/' + S.user.uid + '/<file>.bin', 'file OTA (Range didukung)'],
    ['tcp://tcpbin.com:4242 · ssl:4243', 'echo TCP/TLS publik'],
    ['test.mosquitto.org 1883/8883/8884/8886/8887', 'MQTT publik (TCP/TLS/mTLS/LE/kedaluwarsa)'],
  ];
  $('#endpoints').replaceChildren(...items.map(([u, d]) => h('div', {}, h('code', { title: 'Klik untuk salin', onclick: () => copy(u) }, u), h('span', {}, d))));
}
function fillControlForms() {
  $('#testMode').checked = !!S.testMode;
  $('#testMode').disabled = S.user.kind !== 'admin';
  const c = S.settings.custom;
  $('#cStatus').value = c.status; $('#cDelay').value = c.delayMs; $('#cType').value = c.contentType; $('#cHeaders').value = c.headers; $('#cBody').value = c.body;
  $('#sSsid').value = S.settings.ssid || ''; $('#sPass').value = S.settings.wifiPass || '';
  $('#otaAbort').value = String(S.settings.otaAbortPct || 0);
  $('#mqttInfo').replaceChildren(
    h('dt', {}, 'URL'), h('dd', {}, `wss://${S.host}:443/mqtt`),
    h('dt', {}, 'Username'), h('dd', {}, S.mqttUser),
    h('dt', {}, 'Password'), h('dd', {}, S.mqttPass),
    h('dt', {}, 'Topik'), h('dd', {}, S.topic + '/…'),
    h('dt', {}, 'AT'), h('dd', {}, `AT+MQTTUSERCFG=0,7,"ujiat-${S.user.uid}","${S.mqttUser}","${S.mqttPass}",0,0,"/mqtt"`),
  );
  const isGuest = S.user.kind === 'guest';
  $('#userInfo').replaceChildren(
    h('dt', {}, 'Jenis'), h('dd', {}, isGuest ? 'Tamu' : 'Admin'),
    h('dt', {}, 'ID'), h('dd', {}, S.user.uid),
    S.user.name ? [h('dt', {}, 'Nama'), h('dd', {}, S.user.name)] : null,
    isGuest ? [h('dt', {}, 'Kode tamu'), h('dd', {}, h('code', { title: 'Klik untuk salin', onclick: () => copy(S.user.code) }, S.user.code))] : null,
    isGuest ? [h('dt', {}, 'Berlaku'), h('dd', { class: 'warn' }, `selama server aktif; dihapus bila tidak dipakai ${S.user.idleHours} jam`)] : null,
    h('dt', {}, 'Batas'), h('dd', {}, `OTA ${S.limits.otaFiles} file × ${(S.limits.otaSize / 1048576).toFixed(0)} MB · ${S.limits.holds} hold · ${S.limits.ws} WS`),
  );
  $('#who').replaceChildren(isGuest ? 'tamu ' : 'admin ', h('b', {}, S.user.uid), S.user.name ? ` · ${S.user.name}` : '');
  $$('.admin-only').forEach((el) => { el.hidden = isGuest; });
  const gb = $('#guestbar');
  gb.hidden = !isGuest;
  if (isGuest) {
    gb.replaceChildren(
      h('span', {}, 'Mode tamu · data hanya di memori server. Simpan kode ini untuk masuk lagi dari perangkat lain:'),
      h('code', {}, S.user.code),
      h('button', { class: 'btn sm', onclick: () => copy(S.user.code) }, 'Salin kode'),
      h('span', { class: 'muted small' }, 'Unduh Laporan sebelum selesai.'));
  }
}
async function saveSettings(patch, msg = 'Tersimpan') {
  const r = await api('/api/settings', { method: 'POST', body: patch });
  S.settings = r.settings; S.testMode = r.testMode;
  renderChips();
  toast(msg);
}

async function refreshGuests() {
  if (S.user.kind !== 'admin') return;
  try {
    const r = await api('/api/admin/guests');
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} mnt` : `${Math.round(m / 60)} jam`; };
    $('#adminGuests').replaceChildren(
      h('h3', { class: 'mt' }, `Tamu aktif: ${r.guests.length} / ${r.max}`),
      h('div', { class: 'glist' }, ...(r.guests.length ? r.guests.sort((a, b) => b.lastSeen - a.lastSeen).map((g) => h('div', {},
        h('span', { class: g.online ? 'on' : 'muted' }, g.online ? '●' : '○'), h('b', {}, g.uid), g.name || '—',
        h('span', { class: 'muted' }, `${g.tested} diuji · aktif ${ago(g.lastSeen)} lalu`))) : [h('span', { class: 'muted' }, 'Belum ada tamu.')])));
  } catch {}
}

// ------------------------------------------------------------------ OTA
async function refreshOta() {
  const r = await api('/api/ota');
  $('#otaPart').textContent = `${r.partition.toLocaleString('id-ID')} (batasmu: ${r.limits.otaFiles} file, maks ${(r.limits.otaSize / 1048576).toFixed(0)} MB per file)`;
  if (!r.files.length) return $('#otaList').replaceChildren(h('p', { class: 'muted' }, 'Belum ada file.'));
  $('#otaList').replaceChildren(h('table', { class: 'filetable' },
    h('thead', {}, h('tr', {}, ...['Aktif', 'File', 'Ukuran', 'Cek', 'SHA-256', 'URL', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...r.files.map((f) => h('tr', {},
      h('td', {}, h('input', { type: 'radio', name: 'otaActive', checked: f.name === S.settings.otaFile, onchange: () => saveSettings({ otaFile: f.name }, `File OTA aktif: ${f.name}`).then(renderTable) })),
      h('td', {}, f.name),
      h('td', {}, `${f.size.toLocaleString('id-ID')} B`, h('div', { class: 'small ' + (f.fitsPartition ? 'good' : 'bad') }, f.fitsPartition ? `sisa ${(r.partition - f.size).toLocaleString('id-ID')} B` : 'melebihi partisi')),
      h('td', { class: f.magicOk ? 'good' : 'warn' }, f.magicOk ? 'magic 0xE9 ✓' : 'bukan image ESP'),
      h('td', { class: 'mono' }, f.sha256.slice(0, 16) + '…'),
      h('td', {}, h('button', { class: 'btn ghost sm', onclick: () => copy(`https://${S.host}/ota/${S.user.uid}/${f.name}`) }, 'salin URL')),
      h('td', {}, h('button', { class: 'btn danger sm', onclick: async () => { if (confirm(`Hapus ${f.name}?`)) { await api('/api/ota/' + encodeURIComponent(f.name), { method: 'DELETE' }); refreshOta(); } } }, 'hapus')),
    )))));
}

// ------------------------------------------------------------------ sertifikat
async function refreshCerts() {
  const r = await api('/api/certs');
  certs = Object.fromEntries(r.certs.map((c) => [c.key, c.pem]));
  const ns = (slot) => slot.split('.')[0];
  $('#certList').replaceChildren(...r.certs.map((c) => h('div', { class: 'card cert' },
    h('h3', {}, c.name),
    h('dl', { class: 'kv' }, h('dt', {}, 'Slot'), h('dd', {}, c.slot), h('dt', {}, 'Panjang'), h('dd', {}, `${c.len} byte`),
      h('dt', {}, 'Perintah'), h('dd', {}, `AT+SYSMFG=2,"${ns(c.slot)}","${c.slot}",8,${c.len}`)),
    c.secret ? h('p', { class: 'warn small' }, 'Kunci privat. Hanya untuk uji dengan broker publik, jangan dipakai di produksi.') : null,
    h('pre', {}, c.pem),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => copy(c.pem) }, 'Salin PEM'),
      h('button', { class: 'btn ghost sm', onclick: () => copy(`AT+SYSMFG=2,"${ns(c.slot)}","${c.slot}",8,${c.len}`) }, 'Salin perintah AT'),
      h('button', { class: 'btn ghost sm', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([c.pem])), download: c.key + '.pem' }); a.click(); } }, 'Unduh')),
  )));
}

// ------------------------------------------------------------------ init
async function load() {
  S = await api('/api/state');
  try { await refreshCerts(); } catch {}
  const secSel = $('#secFilter');
  secSel.replaceChildren(h('option', { value: '' }, 'Semua bagian'), ...S.sections.map((s) => h('option', { value: s.key }, `${s.id} ${s.title}`)));
  renderRuns(); renderSummary(); renderTable(); renderChips(); renderEndpoints(); fillControlForms();
  refreshConns();
}
function bind() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    if (t.dataset.tab === 'ota') refreshOta();
    if (t.dataset.tab === 'certs') refreshCerts();
    if (t.dataset.tab === 'control') { refreshConns(); refreshGuests(); }
    try { localStorage.setItem('ujiat-tab', t.dataset.tab); } catch {}
  }));
  try { const t = localStorage.getItem('ujiat-tab'); if (t) $(`.tab[data-tab="${t}"]`)?.click(); } catch {}

  $('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; };
  ['#search', '#secFilter', '#statusFilter', '#serverOnly'].forEach((s) => $(s).addEventListener(s === '#search' ? 'input' : 'change', renderTable));
  $('#runSel').onchange = async (e) => { await api('/api/runs/current', { method: 'POST', body: { id: e.target.value } }); await load(); };
  $('#newRun').onclick = async () => {
    const name = prompt('Nama putaran (mis. versi firmware):', `Putaran ${S.runs.length + 1}`);
    if (!name) return;
    await api('/api/runs', { method: 'POST', body: { name } });
    await load();
    toast('Putaran baru dibuat');
  };

  // serial
  $('#serialBtn').onclick = async () => {
    try { serial.connected ? await serial.disconnect() : await serial.connect(); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message, true); }
  };
  $('#serialForm').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#serialInput').value;
    try { await serial.sendLine(v); $('#serialInput').value = ''; } catch (err) { toast(err.message, true); }
  };
  $('#serialClear').onclick = () => slog().replaceChildren();
  $('#stopRun').onclick = () => { runner.abort = true; };
  const quick = ['AT', 'AT+GMR', 'AT+RST', 'AT+SYSRAM?', 'AT+CIFSR', 'AT+CIPSTATUS', 'AT+MQTTCONN?', 'AT+CIPCLOSE', 'ATE1'];
  $('#quick').replaceChildren(...quick.map((q) => h('button', { class: 'btn ghost', onclick: () => serial.sendLine(q).catch((e) => toast(e.message, true)) }, q)),
    h('button', { class: 'btn ghost', title: 'Kirim +++ tanpa CR LF (keluar passthrough)', onclick: () => serial.sendRaw(enc.encode('+++')).catch((e) => toast(e.message, true)) }, '+++'));
  $('#serialHint').textContent = 'serial' in navigator
    ? 'Colok USB-TTL ke UART AT ESP32 (GPIO16 RX, GPIO17 TX, GND). Buka halaman ini di laptop yang tercolok ESP.'
    : 'Browser ini tidak mendukung Web Serial. Pakai Chrome/Edge desktop untuk mode otomatis; mode manual tetap bisa.';

  // log server
  $('#evFilter').onchange = rerenderEvents;
  $('#evClear').onclick = () => { events.length = 0; $('#evLog').replaceChildren(); };

  // kontrol
  $('#testMode').onchange = (e) => saveSettings({ testMode: e.target.checked }, e.target.checked ? 'Mode uji aktif' : 'Mode uji dimatikan').catch((er) => toast(er.message, true));
  $('#holdPush').onclick = async () => { const r = await api('/api/ctl/hold/push', { method: 'POST', body: { text: $('#holdText').value } }); toast(`Terkirim ke ${r.count} koneksi`); };
  $('#holdClose').onclick = async () => { const r = await api('/api/ctl/hold/close', { method: 'POST', body: {} }); toast(`${r.count} koneksi ditutup`); };
  $('#wsPush').onclick = async () => { const r = await api('/api/ctl/ws/push', { method: 'POST', body: { text: $('#wsText').value } }); toast(`Terkirim ke ${r.count} klien`); };
  $('#wsClose').onclick = async () => { const r = await api('/api/ctl/ws/close', { method: 'POST', body: {} }); toast(`${r.count} klien ditutup`); };
  $('#pubBtn').onclick = async () => {
    try {
      const r = await api('/api/mqtt/publish', { method: 'POST', body: { broker: $('#pubBroker').value, topic: $('#pubTopic').value, payload: $('#pubPayload').value, qos: $('#pubQos').value, retain: $('#pubRetain').checked } });
      toast('Publish ke ' + r.topic);
    } catch (e) { toast(e.message, true); }
  };
  $('#cSave').onclick = () => saveSettings({ custom: { status: Number($('#cStatus').value), delayMs: Number($('#cDelay').value), contentType: $('#cType').value, headers: $('#cHeaders').value, body: $('#cBody').value } }, 'Respons custom disimpan');
  $('#sSave').onclick = async () => {
    try { await saveSettings({ ssid: $('#sSsid').value, wifiPass: $('#sPass').value }); fillControlForms(); renderTable(); } catch (e) { toast(e.message, true); }
  };

  // OTA
  $('#otaUpload').onclick = async () => {
    const f = $('#otaFile').files[0];
    if (!f) return toast('Pilih file .bin dulu', true);
    $('#otaMsg').textContent = `Mengunggah ${f.name} (${f.size.toLocaleString('id-ID')} B)…`;
    try {
      const r = await fetch('/api/ota/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'X-Ujiat': '1', 'Content-Type': 'application/octet-stream' }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      $('#otaMsg').textContent = `Terunggah: ${j.name}`;
      S = { ...S, settings: (await api('/api/state')).settings };
      refreshOta(); renderTable();
    } catch (e) { $('#otaMsg').textContent = 'Gagal: ' + e.message; }
  };
  $('#otaBad').onclick = async () => { await api('/api/ota/make-bad', { method: 'POST', body: {} }); refreshOta(); toast('rusak.bin dibuat'); };
  $('#otaAbort').onchange = (e) => saveSettings({ otaAbortPct: Number(e.target.value) }, `Putus OTA di ${e.target.value}%`);

  // sertifikat
  $('#genClient').onclick = async () => {
    $('#genMsg').textContent = 'Membuat kunci & meminta tanda tangan ke test.mosquitto.org…';
    try { await api('/api/certs/mosquitto-client', { method: 'POST', body: {} }); $('#genMsg').textContent = 'Selesai.'; refreshCerts(); }
    catch (e) { $('#genMsg').textContent = 'Gagal: ' + e.message; }
  };
}

bind();
load().then(startSse).catch((e) => toast(e.message, true));
