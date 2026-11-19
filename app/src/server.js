// Uji AT Dashboard - server pasangan untuk menguji ESP-AT lewat Cloudflare Tunnel.
// Banyak pengguna: 1 admin (tersimpan di disk) + tamu (hanya di memori, hilang saat server restart / tidak aktif).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';
import { TESTS, SECTIONS } from './tests.js';

// Server di Indonesia -> host Eropa sering > 250 ms; bawaan "happy eyeballs" Node terlalu cepat menyerah.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CERTS = path.join(ROOT, 'certs');

const env = process.env;
const PORT = Number(env.PORT || 8900);
const DATA = env.DATA_DIR || path.join(ROOT, 'data');
const OTA_DIR = path.join(DATA, 'ota');
const GEN_CERTS = path.join(DATA, 'certs');
const HOST = env.PUBLIC_HOST || 'ujiat.madewena.com';
const ADMIN_USER = env.ADMIN_USER || 'admin';
const ADMIN_PASS = env.ADMIN_PASS;
const SESSION_SECRET = env.SESSION_SECRET;
const MQTT_HOST = env.MQTT_HOST || 'mqtt';
const OTA_PARTITION = 1572864;

const GUEST_MAX = Number(env.GUEST_MAX || 300);
const GUEST_IDLE_MS = Number(env.GUEST_IDLE_HOURS || 24) * 3600e3;
const GUEST_PER_IP_HOUR = Number(env.GUEST_PER_IP_HOUR || 10);
const LIMITS = {
  admin: { otaFiles: 20, otaSize: 8 * 1024 * 1024, holds: 50, ws: 50 },
  guest: { otaFiles: 3, otaSize: 4 * 1024 * 1024, holds: 10, ws: 10 },
};

if (!ADMIN_PASS || !SESSION_SECRET) {
  console.error('ADMIN_PASS dan SESSION_SECRET wajib diisi di .env');
  process.exit(1);
}
for (const d of [DATA, OTA_DIR, GEN_CERTS]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- pola data
const PAT = '0123456789abcdefghijklmnopqrstuvwxyz';
function fill(n, off = 0) {
  let s = '';
  for (let i = 0; i < n; i++) s += PAT[(off + i) % PAT.length];
  return s;
}
function checkPattern(buf, off = 0) {
  for (let i = 0; i < buf.length; i++) if (buf[i] !== PAT.charCodeAt((off + i) % PAT.length)) return i;
  return -1;
}
const rid = (n) => crypto.randomBytes(n).toString('hex');
const randPass = (n = 14) => crypto.randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);

// ---------------------------------------------------------------- pengguna
function defaultCustom() {
  return { status: 200, contentType: 'text/plain', headers: '', body: 'UJIAT CUSTOM', delayMs: 0 };
}
function newRunSet(seedFromTable) {
  const runId = 'r' + Date.now().toString(36);
  const results = {};
  if (seedFromTable) for (const tc of TESTS) if (tc.init) results[tc.id] = { status: tc.init[0], actual: tc.init[1] || '', at: Date.now() };
  return {
    runs: [{ id: runId, name: seedFromTable ? 'Putaran 1 (dari tabel awal)' : 'Putaran 1', created: Date.now() }],
    currentRun: runId,
    results: { [runId]: results },
  };
}
function makeUser(kind, uid, extra = {}) {
  return {
    uid,
    kind,
    name: extra.name || '',
    created: Date.now(),
    lastSeen: Date.now(),
    secret: extra.secret || rid(8),
    mqttUser: extra.mqttUser || `u-${uid}`,
    mqttPass: extra.mqttPass || randPass(),
    settings: { ssid: '', wifiPass: '', otaFile: '', otaAbortPct: 0, custom: defaultCustom(), ...(extra.settings || {}) },
    ...newRunSet(kind === 'admin'),
    certs: {},
    lastCertAt: 0,
  };
}

// state admin di disk
const STATE_FILE = path.join(DATA, 'state.json');
let disk;
try { disk = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { disk = {}; }
let admin;
if (disk.admin) {
  admin = { ...makeUser('admin', disk.admin.uid), ...disk.admin, certs: {}, lastCertAt: 0 };
  admin.settings = { ...makeUser('admin', 'x').settings, ...disk.admin.settings };
} else {
  // migrasi dari format lama (satu pengguna)
  const old = disk.settings || {};
  admin = makeUser('admin', /^[0-9a-f]{6}$/.test(old.topicId || '') ? old.topicId : rid(3));
  if (old.ssid !== undefined) {
    admin.settings = { ...admin.settings, ssid: old.ssid, wifiPass: old.wifiPass, otaFile: old.otaFile, otaAbortPct: old.otaAbortPct, custom: old.custom || defaultCustom() };
  }
  if (disk.runs) { admin.runs = disk.runs; admin.currentRun = disk.currentRun; admin.results = disk.results; }
}
admin.mqttUser = env.MQTT_DEVICE_USER || 'esp32';
admin.mqttPass = env.MQTT_DEVICE_PASS || admin.mqttPass;
admin.name = ADMIN_USER;
const G = { testMode: disk.global?.testMode ?? disk.settings?.testMode ?? true };

const users = new Map([[admin.uid, admin]]);
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { certs, ...a } = admin;
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, global: G, admin: a }, null, 1));
    fs.renameSync(tmp, STATE_FILE);
  }, 300);
}
function touched(u) {
  u.lastSeen = Date.now();
  if (u.kind === 'admin') save();
}
save();
const topicOf = (u) => `ujiat/${u.uid}`;
const userDir = (u) => path.join(OTA_DIR, u.uid);

// File OTA tamu dari sesi sebelumnya tidak berlaku lagi
for (const d of fs.readdirSync(OTA_DIR)) {
  const fp = path.join(OTA_DIR, d);
  if (d !== admin.uid && fs.statSync(fp).isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
  else if (fs.statSync(fp).isFile()) { // format lama: file langsung di /data/ota -> pindah ke milik admin
    fs.mkdirSync(userDir(admin), { recursive: true });
    fs.renameSync(fp, path.join(userDir(admin), d));
  }
}

// ---------------------------------------------------------------- events (SSE)
const events = [];
const sseClients = new Set(); // {res, user}
let evSeq = 0;
function emit(type, summary, data = {}, uid = null) {
  const ev = { id: ++evSeq, t: Date.now(), uid, type, summary: `${type} ${summary}`, ...data };
  events.push(ev);
  if (events.length > 6000) events.splice(0, events.length - 6000);
  const line = `id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const c of sseClients) if (canSee(c.user, ev)) c.res.write(line);
}
const canSee = (user, ev) => user.kind === 'admin' || ev.uid === user.uid;
setInterval(() => { for (const c of sseClients) c.res.write(': ping\n\n'); }, 25000);

// ---------------------------------------------------------------- auth
const SCRYPT_SALT = crypto.randomBytes(16);
const ADMIN_HASH = crypto.scryptSync(ADMIN_PASS, SCRYPT_SALT, 32);
const loginFails = new Map(); // ip -> {n, until}
const guestMade = new Map(); // ip -> [timestamps]
function sign(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url'); }
function makeSession(u) {
  const ttl = u.kind === 'admin' ? 12 * 3600e3 : 30 * 24 * 3600e3;
  const v = `${u.kind}|${u.uid}|${u.secret}|${Date.now() + ttl}`;
  return Buffer.from(v).toString('base64url') + '.' + sign(v);
}
function sessionCookie(req, u) {
  const maxAge = u.kind === 'admin' ? 43200 : 30 * 86400;
  return `ujiat_sid=${makeSession(u)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const c = parseCookies(req).ujiat_sid;
  if (!c) return null;
  const [b, s] = c.split('.');
  if (!b || !s) return null;
  const v = Buffer.from(b, 'base64url').toString();
  const good = sign(v);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  const [kind, uid, secret, exp] = v.split('|');
  if (Number(exp) < Date.now()) return null;
  const u = users.get(uid);
  if (!u || u.kind !== kind || u.secret !== secret) return null;
  return u;
}
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').includes('https') || /https/.test(req.headers['cf-visitor'] || '');

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  if (res.headersSent) return res.end();
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(buf);
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error(`Body terlalu besar (maks ${limit} B)`), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, 1024 * 1024);
  try { return JSON.parse(b.toString() || '{}'); } catch { return {}; }
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
};
async function serveStatic(res, file) {
  try {
    const data = await fsp.readFile(path.join(PUBLIC, file));
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SEC_HEADERS });
  } catch { send(res, 404, 'not found'); }
}
const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s);
const printable = (buf) => buf.toString('latin1').replace(/[^\x20-\x7e\r\n\t]/g, '.');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// pemilik dari path: /t/<uid>/..., /ws/<uid>, /ota/<uid>/file. Tanpa uid -> admin (format lama).
function ownerFromSeg(seg) {
  return seg && /^[0-9a-f]{6}$/.test(seg) && users.has(seg) ? users.get(seg) : null;
}

// ---------------------------------------------------------------- endpoint uji /t
const holds = new Map(); // id -> {res, ip, since, uid}
let holdSeq = 0;

async function handleTest(req, res, url) {
  const ip = clientIp(req);
  const segs = url.pathname.split('/'); // ['', 't', seg2, ...]
  let owner = ownerFromSeg(segs[2]);
  let p;
  if (owner) p = '/' + segs.slice(3).join('/');
  else if (segs[2] && /^[0-9a-f]{6}$/.test(segs[2])) return send(res, 410, 'UJIAT ID TIDAK AKTIF (tamu kedaluwarsa atau server restart)\r\n');
  else { owner = admin; p = '/' + segs.slice(2).join('/'); }
  if (p === '/') p = '/';
  if (!G.testMode) return send(res, 503, 'UJIAT MODE UJI MATI\r\n');
  owner.lastSeen = Date.now();
  const uid = owner.uid;
  let body = Buffer.alloc(0);
  if (!['GET', 'HEAD'].includes(req.method) && p !== '/hold') {
    try { body = await readBody(req, 4 * 1024 * 1024); } catch (e) { return send(res, e.code || 400, String(e.message)); }
  }
  const proto = isHttps(req) ? 'https' : 'http';
  emit('http', `${req.method} ${url.pathname}${url.search} ${body.length}B ${proto}`, {
    ip, ua: req.headers['user-agent'] || '', headers: req.headers, body: short(printable(body), 400),
  }, uid);

  let m;
  if (p === '/') return send(res, 200, 'UJIAT OK\r\n');
  if (p === '/hello') return send(res, 200, 'hello');
  if (p === '/time') return send(res, 200, new Date().toISOString());
  if (p === '/echo' || p === '/get' || p === '/post') {
    const out = `${req.method} ${url.pathname}${url.search}\nlen=${body.length}\nbody=${short(body.toString('latin1'), 1500)}\n`;
    return send(res, 200, out);
  }
  if (p === '/headers') {
    const out = Object.entries(req.headers).filter(([k]) => !k.startsWith('cf-') && !k.startsWith('x-forwarded') && k !== 'cdn-loop').map(([k, v]) => `${k}: ${v}`).join('\n');
    return send(res, 200, out + '\n');
  }
  if (p === '/sink') {
    const off = Number(url.searchParams.get('off') || 0);
    const bad = checkPattern(body, off);
    const verdict = bad < 0 ? 'UTUH' : `RUSAK@${bad}`;
    emit('sink', `${body.length} B ${verdict}`, { ip }, uid);
    return send(res, 200, `RECV ${body.length} ${verdict}\r\n`);
  }
  if ((m = p.match(/^\/size\/(\d+)$/))) {
    const n = Math.min(Number(m[1]), 4 * 1024 * 1024);
    return send(res, 200, fill(n), { 'Content-Type': 'application/octet-stream' });
  }
  if ((m = p.match(/^\/status\/(\d{3})$/))) return send(res, Number(m[1]), `STATUS ${m[1]}\r\n`);
  if ((m = p.match(/^\/redirect\/(\d+)$/))) {
    const n = Math.min(Number(m[1]), 10);
    const base = owner === admin && segs[2] !== admin.uid ? '/t' : `/t/${uid}`;
    const loc = n > 1 ? `${base}/redirect/${n - 1}` : `${base}/hello`;
    return send(res, 302, `redirect ${n}`, { Location: loc });
  }
  if ((m = p.match(/^\/delay\/(\d+)$/))) {
    const ms = Math.min(Number(m[1]), 90000);
    setTimeout(() => send(res, 200, 'hello'), ms);
    return;
  }
  if (p === '/chunked') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    let i = 0;
    const tmr = setInterval(() => {
      i++;
      res.write(`chunk-${i}\n`);
      if (i >= 5) { clearInterval(tmr); res.end(); }
    }, 200);
    res.on('close', () => clearInterval(tmr));
    return;
  }
  if (p === '/close') {
    res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
    res.end('BYE\r\n', () => req.socket.destroy());
    return;
  }
  if (p === '/drop') { req.socket.destroy(); return; }
  if (p === '/hold') {
    const mine = [...holds.values()].filter((x) => x.uid === uid);
    if (mine.length >= LIMITS[owner.kind].holds) return send(res, 429, 'UJIAT TERLALU BANYAK HOLD\r\n');
    const id = ++holdSeq;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.write(`HOLD ${id} READY\r\n`);
    holds.set(id, { res, ip, since: Date.now(), uid });
    emit('hold', `open #${id}`, { ip }, uid);
    res.on('close', () => { if (holds.delete(id)) emit('hold', `closed #${id}`, {}, uid); });
    return;
  }
  if (p === '/custom') {
    const c = owner.settings.custom;
    const headers = { 'Content-Type': c.contentType || 'text/plain' };
    for (const line of String(c.headers || '').split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    setTimeout(() => send(res, Number(c.status) || 200, String(c.body ?? ''), headers), Math.min(Number(c.delayMs) || 0, 90000));
    return;
  }
  if (p === '/basic') {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('ujiat:ujiat123').toString('base64');
    return ok ? send(res, 200, 'AUTH OK') : send(res, 401, 'AUTH GAGAL', { 'WWW-Authenticate': 'Basic realm="ujiat"' });
  }
  return send(res, 404, 'UJIAT 404\r\n');
}

// ---------------------------------------------------------------- OTA
const safeName = (n) => path.basename(String(n || '')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
async function otaList(u) {
  const dir = userDir(u);
  const files = await fsp.readdir(dir).catch(() => []);
  const out = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    const st = await fsp.stat(fp);
    if (!st.isFile()) continue;
    const data = await fsp.readFile(fp);
    out.push({ name: f, size: st.size, magicOk: data[0] === 0xe9, fitsPartition: st.size < OTA_PARTITION, sha256: crypto.createHash('sha256').update(data).digest('hex'), mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
async function handleOtaDownload(req, res, url) {
  if (!G.testMode) return send(res, 503, 'UJIAT MODE UJI MATI');
  const segs = url.pathname.split('/'); // ['', 'ota', uid, file] atau ['', 'ota', file]
  let owner = ownerFromSeg(segs[2]);
  let name;
  if (owner && segs.length >= 4) name = safeName(decodeURIComponent(segs.slice(3).join('/')));
  else if (segs.length === 3) { owner = admin; name = safeName(decodeURIComponent(segs[2])); }
  else return send(res, 404, 'OTA file tidak ada');
  const uid = owner.uid;
  owner.lastSeen = Date.now();
  const fp = path.join(userDir(owner), name);
  let st;
  try { st = await fsp.stat(fp); } catch { emit('ota', `404 ${name}`, {}, uid); return send(res, 404, 'OTA file tidak ada'); }
  let start = 0, end = st.size - 1, status = 200;
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    status = 206;
  }
  const total = end - start + 1;
  const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': total, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const abortPct = Number(owner.settings.otaAbortPct) || 0;
  const abortAt = abortPct > 0 ? Math.floor(total * abortPct / 100) : Infinity;
  emit('ota', `mulai ${name} ${total} B${status === 206 ? ` (range ${start}-${end})` : ''}${abortPct ? ` [putus di ${abortPct}%]` : ''}`, { ip: clientIp(req) }, uid);
  let sent = 0, lastPct = 0;
  const stream = fs.createReadStream(fp, { start, end });
  stream.on('data', (chunk) => {
    if (sent + chunk.length >= abortAt) {
      res.write(chunk.subarray(0, Math.max(0, abortAt - sent)));
      sent = abortAt;
      stream.destroy();
      emit('ota', `diputus sengaja ${name} di ${sent} B`, {}, uid);
      req.socket.destroy();
      return;
    }
    sent += chunk.length;
    const pct = Math.floor(sent * 100 / total);
    if (pct >= lastPct + 10) { lastPct = pct - (pct % 10); emit('ota', `${lastPct}% ${name}`, { progress: lastPct }, uid); }
    if (!res.write(chunk)) { stream.pause(); res.once('drain', () => stream.resume()); }
  });
  stream.on('end', () => { res.end(); emit('ota', `selesai ${name} ${sent} B`, {}, uid); });
  res.on('close', () => { if (sent < total && sent < abortAt) emit('ota', `terputus klien ${name} di ${sent}/${total} B`, {}, uid); stream.destroy(); });
}

// ---------------------------------------------------------------- MQTT pemantau + dynsec
const brokers = {
  own: { url: `mqtt://${MQTT_HOST}:1883`, opts: { username: env.MQTT_INTERNAL_USER, password: env.MQTT_INTERNAL_PASS }, label: 'Broker sendiri' },
  mosquitto: { url: 'mqtt://test.mosquitto.org:1883', opts: {}, label: 'test.mosquitto.org' },
  emqx: { url: 'mqtt://broker.emqx.io:1883', opts: {}, label: 'broker.emqx.io' },
};
const mqttStatus = {};
const DYN_TOPIC = '$CONTROL/dynamic-security/v1';
const dynPending = new Map();
let dynSeq = 0;
function dynsec(commands) {
  return new Promise((resolve) => {
    const id = 'd' + (++dynSeq);
    commands.forEach((c, i) => { c.correlationData = `${id}:${i}`; });
    dynPending.set(id, resolve);
    brokers.own.client.publish(DYN_TOPIC, JSON.stringify({ commands }), { qos: 1 });
    setTimeout(() => { if (dynPending.delete(id)) resolve([{ error: 'timeout' }]); }, 8000);
  });
}
const dynErrors = (rs) => rs.filter((r) => r.error && !/already exists|not found/i.test(r.error));
async function dynEnsureUser(u) {
  const role = `r-${u.uid}`;
  const topic = `${topicOf(u)}/#`;
  const acls = ['publishClientSend', 'publishClientReceive', 'subscribePattern', 'unsubscribePattern'].map((acltype) => ({ acltype, topic, priority: 10, allow: true }));
  if (u.kind === 'admin') acls.push(...['publishClientSend', 'publishClientReceive', 'subscribePattern'].map((acltype) => ({ acltype, topic: 'ujiat/#', priority: 10, allow: true })));
  // Bawaan dynsec mengizinkan menerima semua topik; tolak selain topik sendiri
  acls.push(...['publishClientReceive', 'subscribePattern', 'subscribeLiteral'].map((acltype) => ({ acltype, topic: '#', priority: 0, allow: false })));
  let rs = await dynsec([
    { command: 'deleteRole', rolename: role },
    { command: 'createRole', rolename: role, acls },
    { command: 'createClient', username: u.mqttUser, password: u.mqttPass, roles: [{ rolename: role }] },
  ]);
  if (/already exists/i.test(rs[2]?.error || '')) {
    // akun sudah ada (mis. akun ESP admin setelah restart): segarkan sandi & role
    rs = rs.concat(await dynsec([
      { command: 'setClientPassword', username: u.mqttUser, password: u.mqttPass },
      { command: 'addClientRole', username: u.mqttUser, rolename: role },
    ]));
  }
  const errs = dynErrors(rs);
  if (errs.length) console.error('dynsec', u.uid, errs);
}
async function dynRemoveUser(u) {
  await dynsec([
    { command: 'deleteClient', username: u.mqttUser },
    { command: 'deleteRole', rolename: `r-${u.uid}` },
  ]);
}
async function dynBootstrap() {
  // Izinkan dashboard (admin) publish ke topik uji
  await dynsec([{ command: 'addRoleACL', rolename: 'admin', acltype: 'publishClientSend', topic: 'ujiat/#', priority: 0, allow: true }]);
  // Bersihkan akun tamu sesi sebelumnya
  const [list] = await dynsec([{ command: 'listClients', verbose: false, count: -1, offset: 0 }]);
  const stale = (list?.data?.clients || []).filter((c) => /^u-[0-9a-f]{6}$/.test(c) && !users.has(c.slice(2)));
  if (stale.length) {
    await dynsec(stale.flatMap((c) => [{ command: 'deleteClient', username: c }, { command: 'deleteRole', rolename: `r-${c.slice(2)}` }]));
    console.log(`dynsec: ${stale.length} akun tamu lama dihapus`);
  }
  for (const u of users.values()) await dynEnsureUser(u);
}

function payloadSummary(buf) {
  if (buf.length > 64) {
    const ok = checkPattern(buf, 0) < 0;
    return `[${buf.length} B${ok ? ' UTUH' : ''}]`;
  }
  return printable(buf);
}
const uidFromTopic = (t) => { const m = t.match(/^ujiat\/([0-9a-f]{6})\//); return m && users.has(m[1]) ? m[1] : null; };
const publicSubs = () => [...users.values()].map((u) => `${topicOf(u)}/#`);
for (const [key, b] of Object.entries(brokers)) {
  const client = mqtt.connect(b.url, {
    ...b.opts,
    clientId: `ujiat-dash-${key}-${rid(3)}`,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    keepalive: 60,
  });
  b.client = client;
  b.subscribeUser = (u) => key !== 'own' && client.connected && client.subscribe(`${topicOf(u)}/#`, { qos: 1 });
  b.unsubscribeUser = (u) => key !== 'own' && client.connected && client.unsubscribe(`${topicOf(u)}/#`);
  client.on('connect', () => {
    mqttStatus[key] = 'tersambung';
    if (key === 'own') {
      client.subscribe(['ujiat/#', '$SYS/broker/log/#', `${DYN_TOPIC}/response`], { qos: 1 }, () => dynBootstrap().catch((e) => console.error('dynsec bootstrap', e)));
    } else {
      client.subscribe(publicSubs(), { qos: 1 });
    }
    emit('broker', `${key} tersambung`);
  });
  client.on('close', () => { if (mqttStatus[key] === 'tersambung') emit('broker', `${key} terputus`); mqttStatus[key] = 'terputus'; });
  client.on('error', (e) => { mqttStatus[key] = 'error: ' + e.message; });
  client.on('message', (topic, payload, packet) => {
    if (topic === `${DYN_TOPIC}/response`) {
      try {
        const rs = JSON.parse(payload.toString()).responses || [];
        const id = String(rs[0]?.correlationData || '').split(':')[0];
        const done = dynPending.get(id);
        if (done) { dynPending.delete(id); done(rs); }
      } catch {}
      return;
    }
    if (topic.startsWith('$SYS/broker/log/')) {
      const line = payload.toString();
      if (/ujiat-dash-/.test(line)) return;
      if (!/New client|disconnect|Client .* closed|connected|Socket error|not authori[sz]ed|bad user|denied/i.test(line)) return;
      const m = line.match(/u'u-([0-9a-f]{6})'|\bu-([0-9a-f]{6})\b/);
      const uid = m ? (m[1] || m[2]) : (/u'([^']+)'/.exec(line)?.[1] === admin.mqttUser ? admin.uid : null);
      emit('mqttlog', short(line, 240), {}, uid && users.has(uid) ? uid : null);
      return;
    }
    const uid = uidFromTopic(topic);
    if (!uid) return;
    emit('mqtt', `${key} ${topic} ${payloadSummary(payload)}`, { broker: key, topic, len: payload.length, qos: packet.qos, retain: packet.retain }, uid);
  });
}

// ---------------------------------------------------------------- WebSocket echo /ws
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const wsClients = new Map(); // id -> {ws, ip, since, uid}
let wsSeq = 0;
wss.on('connection', (ws, req, owner) => {
  const id = ++wsSeq;
  const uid = owner.uid;
  wsClients.set(id, { ws, ip: clientIp(req), since: Date.now(), uid });
  const custom = Object.entries(req.headers).filter(([k]) => k.startsWith('x-') && !k.startsWith('x-forwarded')).map(([k, v]) => `${k}: ${v}`).join(' ');
  emit('ws', `open #${id} ${custom}`.trim(), { ip: clientIp(req), headers: req.headers }, uid);
  ws.on('message', (data, isBinary) => {
    owner.lastSeen = Date.now();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    emit('ws', `msg #${id} ${buf.length > 64 ? `${buf.length} B${checkPattern(buf) < 0 ? ' UTUH' : ''}` : printable(buf)}`, {}, uid);
    if (buf.length <= 1024) ws.send('ECHO:' + buf.toString(), { binary: isBinary });
    else ws.send(`ECHO:${buf.length} B${checkPattern(buf) < 0 ? ' UTUH' : ''}`);
  });
  ws.on('close', (code) => { wsClients.delete(id); emit('ws', `closed #${id} code=${code}`, {}, uid); });
  ws.on('error', () => {});
});

// ---------------------------------------------------------------- sertifikat
async function certList(u) {
  const out = [];
  const read = async (fp) => fsp.readFile(fp, 'utf8').catch(() => null);
  const bundle = [];
  for (const f of ['ISRG_Root_X1.pem', 'ISRG_Root_X2.pem', 'GTS_Root_R1.pem', 'GTS_Root_R4.pem']) {
    const pem = await read(path.join(CERTS, f));
    if (pem) bundle.push(pem.trim());
  }
  out.push({ key: 'ca_bundle', name: 'CA bundle Cloudflare (ISRG X1/X2 + GTS R1/R4)', slot: 'client_ca.0', pem: bundle.join('\n') + '\n' });
  const mo = await read(path.join(CERTS, 'mosquitto_org.pem'));
  if (mo) out.push({ key: 'mosquitto_org', name: 'CA test.mosquitto.org', slot: 'client_ca.1', pem: mo });
  let cc, ck;
  if (u.kind === 'admin') {
    cc = await read(path.join(GEN_CERTS, 'client.crt'));
    ck = await read(path.join(GEN_CERTS, 'client.key'));
  } else {
    cc = u.certs.clientCert; ck = u.certs.clientKey;
  }
  if (cc && ck) {
    out.push({ key: 'client_cert', name: 'Client cert (ditandatangani test.mosquitto.org)', slot: 'client_cert.0', pem: cc });
    out.push({ key: 'client_key', name: 'Client key', slot: 'client_key.0', pem: ck, secret: true });
  }
  for (const c of out) c.len = Buffer.byteLength(c.pem);
  return out;
}
async function makeMosquittoClientCert(u) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ujiat-'));
  try {
    const key = path.join(tmp, 'client.key');
    const csr = path.join(tmp, 'client.csr');
    await execFileP('openssl', ['genrsa', '-out', key, '2048']);
    await execFileP('openssl', ['req', '-new', '-key', key, '-out', csr, '-subj', `/C=ID/O=Uji AT Dashboard/CN=ujiat-esp-${u.uid}`]);
    const r = await fetch('https://test.mosquitto.org/ssl/index.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csr: await fsp.readFile(csr, 'utf8') }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    const m = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    if (!r.ok || !m) {
      const why = [...text.matchAll(/class="error">([^<]+)</g)].map((x) => x[1]).join('; ');
      throw new Error('test.mosquitto.org tidak mengembalikan sertifikat' + (why ? `: ${why}` : ` (HTTP ${r.status})`));
    }
    const crt = m[0] + '\n';
    const keyPem = await fsp.readFile(key, 'utf8');
    if (u.kind === 'admin') {
      await fsp.writeFile(path.join(GEN_CERTS, 'client.crt'), crt);
      await fsp.writeFile(path.join(GEN_CERTS, 'client.key'), keyPem, { mode: 0o600 });
    } else {
      u.certs = { clientCert: crt, clientKey: keyPem };
    }
    emit('cert', 'client cert dibuat & ditandatangani test.mosquitto.org', {}, u.uid);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- tamu
async function createGuest(name) {
  let uid;
  do { uid = rid(3); } while (users.has(uid));
  const u = makeUser('guest', uid, { name: String(name || '').trim().slice(0, 40) });
  users.set(uid, u);
  await dynEnsureUser(u);
  for (const k of ['mosquitto', 'emqx']) brokers[k].subscribeUser(u);
  emit('tamu', `baru ${uid}${u.name ? ` (${u.name})` : ''} · total ${guestCount()}`);
  return u;
}
async function removeGuest(u, why) {
  users.delete(u.uid);
  for (const [id, h] of holds) if (h.uid === u.uid) { h.res.end('HOLD BYE\r\n'); holds.delete(id); }
  for (const [id, c] of wsClients) if (c.uid === u.uid) { c.ws.close(1001, 'tamu kedaluwarsa'); wsClients.delete(id); }
  for (const c of sseClients) if (c.user === u) { c.res.end(); sseClients.delete(c); }
  for (const k of ['mosquitto', 'emqx']) brokers[k].unsubscribeUser(u);
  await fsp.rm(userDir(u), { recursive: true, force: true });
  await dynRemoveUser(u).catch(() => {});
  emit('tamu', `hapus ${u.uid} (${why}) · total ${guestCount()}`);
}
const guestCount = () => users.size - 1;
setInterval(() => {
  const now = Date.now();
  for (const u of [...users.values()]) {
    if (u.kind !== 'guest') continue;
    const active = [...sseClients].some((c) => c.user === u);
    if (!active && now - u.lastSeen > GUEST_IDLE_MS) removeGuest(u, 'tidak aktif');
  }
  for (const [ip, list] of guestMade) {
    const keep = list.filter((t) => now - t < 3600e3);
    keep.length ? guestMade.set(ip, keep) : guestMade.delete(ip);
  }
}, 10 * 60e3);

// ---------------------------------------------------------------- laporan
function resolveFor(u, s) {
  return String(s ?? '')
    .replaceAll('{HOST}', HOST)
    .replaceAll('{T}', `/t/${u.uid}`)
    .replaceAll('{WS}', `/ws/${u.uid}`)
    .replaceAll('{TOPIC_ID}', u.uid)
    .replaceAll('{TOPIC}', topicOf(u))
    .replaceAll('{MQTT_USER}', u.mqttUser)
    .replaceAll('{MQTT_PASS}', '<mqtt-pass>')
    .replaceAll('{SSID}', u.settings.ssid || '<ssid>')
    .replaceAll('{PASS}', '<password>')
    .replaceAll('{OTA_FILE}', u.settings.otaFile || '<file>.bin');
}
function displayCmd(u, tc) {
  if (!tc.run) return resolveFor(u, tc.cmd);
  return tc.run.split('\n').map((l) => l.replace(/\s;t=\d+$/, '')).map((l) => {
    if (l.startsWith('>>')) return '» ' + resolveFor(u, l.replace(/^>>!?\s?/, '')).replace(/\{FILL:(\d+)(?::\d+)?\}/g, '‹$1 byte pola›').replace(/\{PEM:(\w+)\}/g, '‹PEM $1›');
    if (l.startsWith('??')) return `[tunggu: ${l.slice(2).trim()}]`;
    if (l.startsWith('?ev')) return `[bukti server: ${resolveFor(u, l.slice(3).trim())}]`;
    if (l.startsWith('~')) return `[jeda ${l.slice(1).trim()} ms]`;
    if (l.startsWith('!')) return `[dashboard: ${resolveFor(u, l.slice(1))}]`;
    if (l.startsWith('@loop')) return `[ulangi ${l.split(/\s+/)[1]}x]`;
    if (l.startsWith('@end')) return '[akhir ulang]';
    return resolveFor(u, l).replace('{LEN}', 'n');
  }).join('\n');
}
function runOf(u, runId) {
  const run = u.runs.find((r) => r.id === runId) || u.runs.find((r) => r.id === u.currentRun) || u.runs[0];
  return { run, res: u.results[run.id] || {} };
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(u, runId) {
  const { res } = runOf(u, runId);
  const rows = [['ID', 'Bagian', 'Prioritas', 'Uji', 'Perintah / langkah', 'Hasil diharapkan', 'Catatan dokumen', 'Status', 'Hasil aktual / catatan', 'Diperbarui']];
  for (const tc of TESTS) {
    const sec = SECTIONS.find((s) => tc.id.startsWith(s.key + '-'));
    const r = res[tc.id] || {};
    rows.push([tc.id, sec ? `${sec.id} ${sec.title}` : '', tc.prio ? '★' : '', tc.name, displayCmd(u, tc), resolveFor(u, tc.exp), resolveFor(u, tc.note), r.status || 'Belum diuji', r.actual || '', r.at ? new Date(r.at).toISOString() : '']);
  }
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
function exportReport(u, runId, onlyTested, nonce) {
  const { run, res } = runOf(u, runId);
  const fmt = (t) => new Date(t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
  const st = (id) => res[id]?.status || 'Belum diuji';
  const all = { Lulus: 0, Gagal: 0, Lewati: 0, 'Belum diuji': 0 };
  for (const tc of TESTS) all[st(tc.id)]++;
  const tested = all.Lulus + all.Gagal;
  const fw = /AT version:[^\n]*/.exec(res['E-02']?.actual || '')?.[0] || '';
  const secRows = SECTIONS.map((s) => {
    const list = TESTS.filter((t) => t.id.startsWith(s.key + '-'));
    const c = { Lulus: 0, Gagal: 0, Lewati: 0, 'Belum diuji': 0 };
    for (const t of list) c[st(t.id)]++;
    return `<tr><td>${esc(s.id)}</td><td>${esc(s.title)}</td><td class="n">${list.length}</td><td class="n ok">${c.Lulus}</td><td class="n bad">${c.Gagal}</td><td class="n">${c.Lewati}</td><td class="n warn">${c['Belum diuji']}</td></tr>`;
  }).join('');
  const failed = TESTS.filter((t) => st(t.id) === 'Gagal');
  const body = SECTIONS.map((s) => {
    const list = TESTS.filter((t) => t.id.startsWith(s.key + '-') && (!onlyTested || st(t.id) !== 'Belum diuji'));
    if (!list.length) return '';
    return `<h3>${esc(s.id)} ${esc(s.title)}</h3><table class="tt"><thead><tr><th>ID</th><th>Uji</th><th>Perintah / langkah</th><th>Hasil diharapkan</th><th>Status</th><th>Hasil aktual</th></tr></thead><tbody>${list.map((t) => {
      const r = res[t.id] || {};
      return `<tr><td class="id">${esc(t.id)}${t.prio ? ' ★' : ''}</td><td><b>${esc(t.name)}</b>${t.note ? `<div class="mut">${esc(resolveFor(u, t.note))}</div>` : ''}</td><td><pre>${esc(displayCmd(u, t))}</pre></td><td>${esc(resolveFor(u, t.exp))}</td><td><span class="st s-${esc(st(t.id)).replace(/\s/g, '')}">${esc(st(t.id))}</span>${r.at ? `<div class="mut">${esc(fmt(r.at))}</div>` : ''}</td><td><pre>${esc(r.actual || '')}</pre></td></tr>`;
    }).join('')}</tbody></table>`;
  }).join('');
  const who = u.kind === 'admin' ? `Admin (${esc(u.name)})` : `Tamu ${esc(u.uid)}${u.name ? ` · ${esc(u.name)}` : ''}`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laporan Uji AT · ${esc(run.name)}</title>
<style>
:root{--fg:#1d2420;--mut:#5f6b64;--line:#d5ddd8;--ok:#1f8a4c;--bad:#c33b2e;--warn:#a26a00;--head:#eef4f0}
*{box-sizing:border-box}body{font:13px/1.45 Inter,system-ui,sans-serif;color:var(--fg);margin:0;padding:24px;background:#fff}
h1{font:700 20px "JetBrains Mono",ui-monospace,monospace;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px}h3{font:600 13px "JetBrains Mono",ui-monospace,monospace;margin:22px 0 6px;color:#14532d}
.meta{color:var(--mut);margin-bottom:14px}.meta b{color:var(--fg)}
.cards{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.card{border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:110px}.card b{display:block;font-size:22px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}th{background:var(--head);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
td.n{text-align:right;font-variant-numeric:tabular-nums}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.mut{color:var(--mut);font-size:11px}
pre{margin:0;white-space:pre-wrap;word-break:break-all;font:11px/1.4 "JetBrains Mono",ui-monospace,monospace;max-height:220px;overflow:hidden}
.tt td.id{white-space:nowrap;font-family:ui-monospace,monospace;font-weight:600}.tt col{width:auto}
.st{font-weight:700}.s-Lulus{color:var(--ok)}.s-Gagal{color:var(--bad)}.s-Belumdiuji{color:var(--warn)}.s-Lewati{color:var(--mut)}
.bar{height:10px;border-radius:99px;background:#e7ece9;overflow:hidden;display:flex;margin:6px 0 2px}.bar i{display:block;height:100%}
.noprint{margin-bottom:16px}button{font:600 13px Inter,system-ui;padding:7px 14px;border-radius:6px;border:1px solid #1f8a4c;background:#1f8a4c;color:#fff;cursor:pointer}
@media print{.noprint{display:none}body{padding:0}h3{break-after:avoid}tr{break-inside:avoid}pre{max-height:none}}
</style></head><body>
<div class="noprint"><button id="p">Cetak / Simpan PDF</button></div>
<h1>Laporan Uji AT ESP32</h1>
<div class="meta">Putaran <b>${esc(run.name)}</b> · ${who} · dibuat ${esc(fmt(Date.now()))}${fw ? ` · Firmware <b>${esc(fw)}</b>` : ''}<br>Server uji: <b>${esc(HOST)}</b> · Topik MQTT: <b>${esc(topicOf(u))}</b></div>
<div class="cards"><div class="card">Total uji<b>${TESTS.length}</b></div><div class="card ok">Lulus<b>${all.Lulus}</b></div><div class="card bad">Gagal<b>${all.Gagal}</b></div><div class="card warn">Belum diuji<b>${all['Belum diuji']}</b></div><div class="card">Lewati<b>${all.Lewati}</b></div><div class="card">Tingkat lulus<b>${tested ? Math.round(all.Lulus * 100 / tested) : 0}%</b><span class="mut">dari yang diuji</span></div></div>
<div class="bar"><i style="width:${all.Lulus * 100 / TESTS.length}%;background:var(--ok)"></i><i style="width:${all.Gagal * 100 / TESTS.length}%;background:var(--bad)"></i><i style="width:${all.Lewati * 100 / TESTS.length}%;background:#9aa59f"></i></div>
<h2>Ringkasan per bagian</h2>
<table><thead><tr><th>Bagian</th><th>Judul</th><th>Uji</th><th>Lulus</th><th>Gagal</th><th>Lewati</th><th>Belum</th></tr></thead><tbody>${secRows}</tbody></table>
${failed.length ? `<h2>Uji yang gagal (${failed.length})</h2><ul>${failed.map((t) => `<li><b>${esc(t.id)}</b> ${esc(t.name)}</li>`).join('')}</ul>` : ''}
<h2>Detail${onlyTested ? ' (hanya yang sudah diuji)' : ''}</h2>
${body || '<p class="mut">Belum ada uji yang dijalankan.</p>'}
<script nonce="${nonce}">document.getElementById('p').onclick=()=>print();</script>
</body></html>`;
}

// ---------------------------------------------------------------- API (perlu login)
function publicUser(u) {
  return {
    uid: u.uid,
    kind: u.kind,
    name: u.name,
    created: u.created,
    code: u.kind === 'guest' ? `${u.uid}-${u.secret}` : undefined,
    idleHours: u.kind === 'guest' ? GUEST_IDLE_MS / 3600e3 : undefined,
  };
}
async function handleApi(req, res, url, u) {
  const p = url.pathname;
  const M = req.method;
  if (p === '/api/state' && M === 'GET') {
    return send(res, 200, {
      host: HOST,
      user: publicUser(u),
      testMode: G.testMode,
      settings: u.settings,
      topic: topicOf(u),
      mqttUser: u.mqttUser,
      mqttPass: u.mqttPass,
      sections: SECTIONS,
      tests: TESTS,
      runs: u.runs,
      currentRun: u.currentRun,
      results: u.results[u.currentRun] || {},
      brokers: Object.fromEntries(Object.entries(brokers).map(([k, b]) => [k, { label: b.label, status: mqttStatus[k] || 'menyambung' }])),
      otaPartition: OTA_PARTITION,
      guests: u.kind === 'admin' ? guestCount() : undefined,
      limits: LIMITS[u.kind],
    });
  }
  if (p === '/api/settings' && M === 'POST') {
    const b = await readJson(req);
    const s = u.settings;
    for (const k of ['ssid', 'wifiPass', 'otaFile']) if (k in b) s[k] = String(b[k]).slice(0, 128);
    if ('otaAbortPct' in b) s.otaAbortPct = Math.max(0, Math.min(99, Number(b.otaAbortPct) || 0));
    if (b.custom) s.custom = { ...s.custom, ...b.custom, body: String(b.custom.body ?? s.custom.body).slice(0, 8192) };
    if ('testMode' in b) {
      if (u.kind !== 'admin') return send(res, 403, { error: 'Hanya admin yang bisa mengubah mode uji' });
      G.testMode = !!b.testMode;
      emit('setting', `mode uji ${G.testMode ? 'aktif' : 'mati'}`);
    }
    touched(u);
    return send(res, 200, { ok: true, settings: s, testMode: G.testMode });
  }
  if (p === '/api/result' && M === 'POST') {
    const b = await readJson(req);
    if (!TESTS.find((x) => x.id === b.id)) return send(res, 400, { error: 'id tidak dikenal' });
    const r = (u.results[u.currentRun] ||= {});
    r[b.id] = { ...(r[b.id] || {}), ...(b.status !== undefined && { status: String(b.status).slice(0, 20) }), ...(b.actual !== undefined && { actual: String(b.actual).slice(0, 8000) }), at: Date.now() };
    touched(u);
    return send(res, 200, { ok: true, result: r[b.id] });
  }
  if (p === '/api/runs' && M === 'POST') {
    const b = await readJson(req);
    if (u.kind === 'guest' && u.runs.length >= 20) return send(res, 400, { error: 'Maksimal 20 putaran untuk tamu' });
    const id = 'r' + Date.now().toString(36);
    u.runs.push({ id, name: String(b.name || `Putaran ${u.runs.length + 1}`).slice(0, 80), created: Date.now() });
    u.results[id] = {};
    u.currentRun = id;
    touched(u);
    return send(res, 200, { ok: true, id });
  }
  if (p === '/api/runs/current' && M === 'POST') {
    const b = await readJson(req);
    if (!u.runs.find((r) => r.id === b.id)) return send(res, 400, { error: 'putaran tidak ada' });
    u.currentRun = b.id;
    touched(u);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/export.csv' && M === 'GET') {
    const { run } = runOf(u, url.searchParams.get('run'));
    const fname = `uji-at-${u.uid}-${run.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.csv`;
    return send(res, 200, exportCsv(u, run.id), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"` });
  }
  if (p === '/api/report.html' && M === 'GET') {
    const nonce = rid(12);
    const html = exportReport(u, url.searchParams.get('run'), url.searchParams.get('only') === 'tested', nonce);
    return send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:`,
      'X-Content-Type-Options': 'nosniff',
    });
  }
  if (p === '/api/events' && M === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const since = Number(req.headers['last-event-id'] || url.searchParams.get('since') || 0);
    for (const ev of events.filter((e) => e.id > since && canSee(u, e)).slice(-300)) res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
    const c = { res, user: u };
    sseClients.add(c);
    req.on('close', () => { sseClients.delete(c); u.lastSeen = Date.now(); });
    return;
  }
  if (p === '/api/conns' && M === 'GET') {
    return send(res, 200, {
      holds: [...holds].filter(([, h]) => h.uid === u.uid).map(([id, h]) => ({ id, ip: h.ip, since: h.since })),
      ws: [...wsClients].filter(([, c]) => c.uid === u.uid).map(([id, c]) => ({ id, ip: c.ip, since: c.since })),
      brokers: Object.fromEntries(Object.entries(brokers).map(([k, b]) => [k, { label: b.label, status: mqttStatus[k] || 'menyambung' }])),
      testMode: G.testMode,
      guests: u.kind === 'admin' ? guestCount() : undefined,
    });
  }
  const pick = (map, id) => [...map].filter(([hid, x]) => x.uid === u.uid && (!id || hid === Number(id))).map(([, x]) => x);
  if (p === '/api/ctl/hold/push' && M === 'POST') {
    const b = await readJson(req);
    const targets = pick(holds, b.id);
    for (const h of targets) h.res.write(String(b.text ?? '').slice(0, 8192) + '\r\n');
    emit('hold', `push ke ${targets.length} koneksi: ${short(String(b.text ?? ''), 80)}`, {}, u.uid);
    return send(res, 200, { ok: true, count: targets.length });
  }
  if (p === '/api/ctl/hold/close' && M === 'POST') {
    const b = await readJson(req);
    const targets = pick(holds, b.id);
    for (const h of targets) h.res.end('HOLD BYE\r\n');
    return send(res, 200, { ok: true, count: targets.length });
  }
  if (p === '/api/ctl/ws/push' && M === 'POST') {
    const b = await readJson(req);
    const targets = pick(wsClients, b.id);
    for (const c of targets) c.ws.send(String(b.text ?? '').slice(0, 65536));
    emit('ws', `push ke ${targets.length} klien: ${short(String(b.text ?? ''), 80)}`, {}, u.uid);
    return send(res, 200, { ok: true, count: targets.length });
  }
  if (p === '/api/ctl/ws/close' && M === 'POST') {
    const b = await readJson(req);
    const targets = pick(wsClients, b.id);
    for (const c of targets) c.ws.close(1000, 'ditutup dari dashboard');
    return send(res, 200, { ok: true, count: targets.length });
  }
  if (p === '/api/mqtt/publish' && M === 'POST') {
    const b = await readJson(req);
    const br = brokers[b.broker];
    if (!br) return send(res, 400, { error: 'broker tidak dikenal' });
    if (!br.client.connected) return send(res, 503, { error: `${b.broker} belum tersambung` });
    const topic = String(b.topic || '').replaceAll('{TOPIC}', topicOf(u));
    if (u.kind !== 'admin' && !topic.startsWith(topicOf(u) + '/')) return send(res, 403, { error: `Tamu hanya boleh publish ke ${topicOf(u)}/…` });
    if (!topic || /[#+]/.test(topic)) return send(res, 400, { error: 'topik tidak valid' });
    br.client.publish(topic, String(b.payload ?? '').slice(0, 65536), { qos: Math.min(2, Number(b.qos) || 0), retain: !!b.retain });
    emit('publish', `${b.broker} ${topic} ${short(String(b.payload ?? ''), 80)}`, {}, uidFromTopic(topic) || u.uid);
    return send(res, 200, { ok: true, topic });
  }
  if (p === '/api/ota' && M === 'GET') return send(res, 200, { files: await otaList(u), partition: OTA_PARTITION, limits: LIMITS[u.kind] });
  if (p === '/api/ota/upload' && M === 'POST') {
    const name = safeName(url.searchParams.get('name'));
    if (!name || !name.endsWith('.bin')) return send(res, 400, { error: 'Nama file harus .bin' });
    const lim = LIMITS[u.kind];
    const existing = await otaList(u);
    if (existing.length >= lim.otaFiles && !existing.find((f) => f.name === name)) return send(res, 400, { error: `Maksimal ${lim.otaFiles} file. Hapus yang lama dulu.` });
    let body;
    try { body = await readBody(req, lim.otaSize); } catch (e) { return send(res, 413, { error: e.message }); }
    await fsp.mkdir(userDir(u), { recursive: true });
    await fsp.writeFile(path.join(userDir(u), name), body);
    if (!u.settings.otaFile) { u.settings.otaFile = name; touched(u); }
    emit('ota', `upload ${name} ${body.length} B`, {}, u.uid);
    return send(res, 200, { ok: true, name, size: body.length });
  }
  if (p === '/api/ota/make-bad' && M === 'POST') {
    const buf = crypto.randomBytes(200 * 1024);
    buf[0] = 0xe9; // lolos cek magic, tapi isinya acak
    await fsp.mkdir(userDir(u), { recursive: true });
    await fsp.writeFile(path.join(userDir(u), 'rusak.bin'), buf);
    emit('ota', 'file rusak.bin dibuat (200 KB acak)', {}, u.uid);
    return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/ota/') && M === 'DELETE') {
    const name = safeName(decodeURIComponent(p.slice(9)));
    await fsp.unlink(path.join(userDir(u), name)).catch(() => {});
    if (u.settings.otaFile === name) { u.settings.otaFile = ''; touched(u); }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/certs' && M === 'GET') return send(res, 200, { certs: await certList(u) });
  if (p === '/api/certs/mosquitto-client' && M === 'POST') {
    if (Date.now() - u.lastCertAt < 2 * 60e3) return send(res, 429, { error: 'Tunggu 2 menit sebelum membuat cert lagi' });
    u.lastCertAt = Date.now();
    try { await makeMosquittoClientCert(u); return send(res, 200, { ok: true }); } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (p === '/api/admin/guests' && M === 'GET') {
    if (u.kind !== 'admin') return send(res, 403, { error: 'Khusus admin' });
    return send(res, 200, {
      guests: [...users.values()].filter((x) => x.kind === 'guest').map((x) => ({
        uid: x.uid, name: x.name, created: x.created, lastSeen: x.lastSeen,
        online: [...sseClients].some((c) => c.user === x),
        tested: Object.values(x.results[x.currentRun] || {}).filter((r) => r.status === 'Lulus' || r.status === 'Gagal').length,
      })),
      max: GUEST_MAX,
    });
  }
  return send(res, 404, { error: 'tidak ditemukan' });
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, 'ok');
    if (p === '/t' || p.startsWith('/t/')) return await handleTest(req, res, url);
    if (p.startsWith('/ota/') && ['GET', 'HEAD'].includes(req.method)) return await handleOtaDownload(req, res, url);
    if (p.startsWith('/assets/')) return await serveStatic(res, p.slice(1));

    // Dashboard selalu HTTPS bila lewat Cloudflare
    if (req.headers['x-forwarded-proto'] === 'http' || /"scheme":"http"/.test(req.headers['cf-visitor'] || '')) {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      return res.end();
    }
    if (p === '/login' && req.method === 'GET') return await serveStatic(res, 'login.html');
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      const f = loginFails.get(ip);
      if (f && f.n >= 8 && f.until > Date.now()) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
      const b = await readJson(req);
      const hsh = crypto.scryptSync(String(b.pass || ''), SCRYPT_SALT, 32);
      const ok = String(b.user || '') === ADMIN_USER && crypto.timingSafeEqual(hsh, ADMIN_HASH);
      if (!ok) {
        const n = (f && f.until > Date.now() ? f.n : 0) + 1;
        loginFails.set(ip, { n, until: Date.now() + 15 * 60e3 });
        emit('auth', `login admin gagal dari ${ip}`);
        return send(res, 401, { error: 'Username atau password salah' });
      }
      loginFails.delete(ip);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, admin) });
    }
    if (p === '/api/guest' && req.method === 'POST') {
      const ip = clientIp(req);
      const list = (guestMade.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
      if (list.length >= GUEST_PER_IP_HOUR) return send(res, 429, { error: 'Terlalu banyak akun tamu dari IP ini. Coba lagi nanti.' });
      if (guestCount() >= GUEST_MAX) return send(res, 503, { error: 'Kuota tamu sedang penuh. Coba lagi nanti.' });
      const b = await readJson(req);
      const u = await createGuest(b.name);
      list.push(Date.now());
      guestMade.set(ip, list);
      return send(res, 200, { ok: true, uid: u.uid, code: `${u.uid}-${u.secret}` }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    if (p === '/api/guest/resume' && req.method === 'POST') {
      const ip = clientIp(req);
      const f = loginFails.get(ip);
      if (f && f.n >= 8 && f.until > Date.now()) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
      const b = await readJson(req);
      const [uid, secret] = String(b.code || '').trim().toLowerCase().split('-');
      const u = users.get(uid);
      if (!u || u.kind !== 'guest' || !secret || u.secret.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(u.secret), Buffer.from(secret))) {
        const n = (f && f.until > Date.now() ? f.n : 0) + 1;
        loginFails.set(ip, { n, until: Date.now() + 15 * 60e3 });
        return send(res, 404, { error: 'Kode tidak ditemukan. Akun tamu hilang bila server restart atau tidak aktif lebih dari ' + GUEST_IDLE_MS / 3600e3 + ' jam.' });
      }
      touched(u);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, u) });
    }
    if (p === '/api/logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'ujiat_sid=; Path=/; HttpOnly; Max-Age=0' });
    }
    const u = currentUser(req);
    if (!u) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Belum login' });
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    u.lastSeen = Date.now();
    if (p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-ujiat'] !== '1') return send(res, 403, { error: 'Header CSRF tidak ada' });
      return await handleApi(req, res, url, u);
    }
    if (p === '/' || p === '/index.html') return await serveStatic(res, 'index.html');
    return send(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    send(res, 500, 'server error');
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  socket.on('error', () => {});
  if (!G.testMode) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  if (p === '/ws' || p.startsWith('/ws/')) {
    const seg = p.split('/')[2];
    const owner = seg ? ownerFromSeg(seg) : admin;
    if (!owner) { socket.end('HTTP/1.1 410 Gone\r\n\r\n'); return; }
    if ([...wsClients.values()].filter((c) => c.uid === owner.uid).length >= LIMITS[owner.kind].ws) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, owner));
    return;
  }
  if (p === '/mqtt' || p.startsWith('/mqtt/')) {
    // Teruskan apa adanya ke listener websockets Mosquitto (autentikasi per pengguna oleh dynsec)
    const up = net.connect(9001, MQTT_HOST);
    const ip = clientIp(req);
    up.on('connect', () => {
      let hd = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) hd += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(hd + '\r\n');
      if (head && head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('close', () => up.destroy());
    return;
  }
  socket.destroy();
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
server.requestTimeout = 0;
server.listen(PORT, () => console.log(`Uji AT Dashboard jalan di :${PORT} (host publik ${HOST}, admin uid ${admin.uid})`));
