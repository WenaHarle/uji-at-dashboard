// Simulator ESP-AT sederhana untuk menguji runner tanpa perangkat.
// Perilaku meniru firmware ESP-AT v5 (ESP32-WROOM-32) yang diamati di lapangan:
//   +UART_CUR:115201, CWJAP salah -> "+CWJAP:2 / ERROR", +BTNAME tanpa kutip, "busy p...",
//   crash "Will force to restart!!!", proxy transparan port 80 (opsi), dsb.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAT = '0123456789abcdefghijklmnopqrstuvwxyz';
const FEATURES_ALL = ['CWMODE', 'CIPSTART', 'CIPSSLCCONF', 'MQTTCONN', 'HTTPCLIENT', 'WSOPEN', 'BLEINIT', 'BTINIT', 'BTSPPINIT', 'MDNS', 'CIPSNTPCFG', 'FS', 'SYSMFG', 'USEROTA', 'SLEEP'];

export class SimESP {
  constructor(o = {}) {
    this.o = { ssid: 'labwifi', pass: 'rahasia123', features: FEATURES_ALL, proxy80: false, crashOn: null, mqttOk: true, ...o };
    this.out = '';
    this.inbuf = '';
    this.echo = true;
    this.mode = 1;
    this.wifi = false;
    this.timeSynced = false;
    this.conn = null; // {type, host, port, buf, bodyLeft, hold}
    this.mux = 0;
    this.server = false;
    this.pending = null; // {n, buf, onDone}
    this.passthrough = false;
    this.busyUntil = 0;
    this.btName = 'ESP32_BT';
    this.bt = false;
    this.mfg = {};
    this.events = [];
    this.evSeq = 0;
    this.log = [];
  }
  rx() { return this.out; }
  emit(text) { this.out += text; }
  ev(summary) { this.events.push({ id: ++this.evSeq, summary }); }

  async write(bytes) {
    const s = Buffer.from(bytes).toString('latin1');
    if (this.pending) {
      this.pending.buf += s;
      if (this.pending.buf.length >= this.pending.n) {
        const p = this.pending;
        this.pending = null;
        const data = p.buf.slice(0, p.n);
        setTimeout(() => p.onDone(data), 5);
      }
      return;
    }
    if (this.passthrough) {
      if (s === '+++') { this.passthrough = false; return; }
      if (this.conn) this.connData(s);
      return;
    }
    this.inbuf += s;
    let i;
    while ((i = this.inbuf.indexOf('\r\n')) >= 0) {
      const line = this.inbuf.slice(0, i);
      this.inbuf = this.inbuf.slice(i + 2);
      this.command(line);
    }
  }

  ok() { this.emit('\r\nOK\r\n'); }
  err() { this.emit('\r\nERROR\r\n'); }

  async command(line) {
    if (Date.now() < this.busyUntil) { this.emit('\r\nbusy p...\r\n'); return; }
    if (this.echo) this.emit(line + '\r\r\n');
    this.log.push(line);
    const c = line;
    const has = (f) => this.o.features.includes(f);
    let m;
    if (c === 'AT') return this.ok();
    if (c === 'ATE0') { this.echo = false; return this.ok(); }
    if (c === 'ATE1') { this.echo = true; return this.ok(); }
    if (c === 'AT+GMR') { this.emit('AT version:5.1.0.0-dev(s-2d59ec6 - ESP32 - Nov 12 2026)\r\nSDK version:v6.1\r\nBin version:v5.1.0.0-dev(WROOM-32)\r\n'); return this.ok(); }
    if (c === 'AT+CMD?') {
      // urutan sengaja: MQTT sebelum BT (seperti firmware asli)
      const names = ['AT', 'AT+RST', 'AT+GMR', 'AT+UART_CUR', ...this.o.features.map((f) => 'AT+' + f), 'AT+UART', 'AT+USERRAM'];
      names.forEach((n, k) => this.emit(`+CMD:${k},"${n}",0,1,1,0\r\n`));
      return this.ok();
    }
    if (c === 'AT+RST' || (m = c.match(/^AT\+GSLP=(\d+)/))) {
      this.ok();
      await sleep(m ? Math.min(Number(m[1]) / 10, 800) : 250);
      return this.reboot();
    }
    if (c === 'AT+SYSRAM?') { this.emit('+SYSRAM:137484,118800\r\n'); return this.ok(); }
    if (c === 'AT+UART_CUR?') { this.emit('+UART_CUR:115201,8,1,0,0\r\n'); return this.ok(); }
    if (c === 'AT+UART?') { this.emit('+UART:115201,8,1,0,0\r\n'); return this.ok(); }
    if (c === 'AT+SYSSTORE?') { this.emit('+SYSSTORE:1\r\n'); return this.ok(); }
    if ((m = c.match(/^AT\+CWMODE=(\d)/))) { this.mode = Number(m[1]); if (this.mode === 0 || this.mode === 2) this.wifi = false; return this.ok(); }
    if (c === 'AT+CWMODE?') { this.emit(`+CWMODE:${this.mode}\r\n`); return this.ok(); }
    if (c === 'AT+CWSTATE?') { this.emit(this.wifi ? `+CWSTATE:2,"${this.o.ssid}"\r\n` : '+CWSTATE:0,""\r\n'); return this.ok(); }
    if (c === 'AT+CIPSTA?') { this.emit(`+CIPSTA:ip:"${this.wifi ? '10.0.0.5' : '0.0.0.0'}"\r\n`); return this.ok(); }
    if ((m = c.match(/^AT\+CWJAP="((?:\\.|[^"])*)","((?:\\.|[^"])*)"/))) {
      if (this.mode !== 1 && this.mode !== 3) return this.err();
      const ssid = m[1].replace(/\\(.)/g, '$1'), pass = m[2].replace(/\\(.)/g, '$1');
      await sleep(120);
      if (ssid !== this.o.ssid) { this.emit('+CWJAP:3\r\n'); return this.err(); }
      if (pass !== this.o.pass) { this.emit('+CWJAP:2\r\n'); return this.err(); }
      this.wifi = true;
      this.emit('WIFI CONNECTED\r\nWIFI GOT IP\r\n');
      return this.ok();
    }
    if (c === 'AT+CWJAP?') { if (this.wifi) this.emit(`+CWJAP:"${this.o.ssid}","aa:bb:cc:dd:ee:ff",6,-40,0,1,3,0,1\r\n`); return this.ok(); }
    if (c === 'AT+CWQAP') { if (this.wifi) this.emit('WIFI DISCONNECT\r\n'); this.wifi = false; this.conn = null; return this.ok(); }
    if (c === 'AT+CWAUTOCONN=0') return this.ok();
    if ((m = c.match(/^AT\+CIPDOMAIN="([^"]+)"/))) {
      if (!this.wifi) { this.busyUntil = Date.now() + 600; await sleep(600); return this.err(); }
      await sleep(50);
      if (m[1].endsWith('.invalid')) return this.err();
      this.emit('+CIPDOMAIN:"104.21.62.121"\r\n'); return this.ok();
    }
    if (c.startsWith('AT+CIPSNTPCFG=')) {
      this.ok();
      if (this.wifi) { await sleep(150); this.timeSynced = true; this.emit('+TIME_UPDATED\r\n'); }
      return;
    }
    if (c === 'AT+CIPSNTPTIME?') { this.emit(`+CIPSNTPTIME:Thu Nov 19 06:41:48 ${this.timeSynced ? 2026 : 1970}\r\n`); return this.ok(); }
    if ((m = c.match(/^AT\+CIPSTART="(TCP|SSL|UDP)","([^"]+)",(\d+)/))) {
      if (this.conn) { this.emit('ALREADY CONNECTED\r\n'); return this.err(); }
      if (!this.wifi || (m[1] !== 'TCP' && m[1] !== 'UDP' && !has('CIPSSLCCONF'))) return this.err();
      const port = Number(m[3]);
      await sleep(80);
      if (port === 81) return this.err();
      if (m[2] === '192.0.2.1' && !(this.o.proxy80 && port === 80)) { await sleep(300); return this.err(); }
      this.conn = { type: m[1], host: m[2], port, buf: '', hold: false };
      this.emit('CONNECT\r\n'); return this.ok();
    }
    if ((m = c.match(/^AT\+CIPSEND=(\d+)$/)) || c === 'AT+CIPSEND') {
      if (!this.conn) return this.err();
      if (!m) { this.passthrough = true; this.emit('\r\nOK\r\n\r\n>'); return; }
      const n = Number(m[1]);
      this.emit('\r\nOK\r\n\r\n>');
      this.pending = { n, buf: '', onDone: (data) => { this.emit(`\r\nRecv ${n} bytes\r\n\r\nSEND OK\r\n`); this.connData(data); } };
      return;
    }
    if (c === 'AT+CIPCLOSE') { if (!this.conn) return this.err(); this.conn = null; this.emit('CLOSED\r\n'); return this.ok(); }
    if (c === 'AT+CIPMODE=0' || c === 'AT+CIPMODE=1') return this.ok();
    if (c === 'AT+CIPSTATUS') { this.emit(`STATUS:${this.conn ? 3 : this.wifi ? 2 : 5}\r\n`); return this.ok(); }
    if ((m = c.match(/^AT\+CIPMUX=(\d)/))) { if (this.conn) return this.err(); this.mux = Number(m[1]); return this.ok(); }
    if (c === 'AT+CIPMUX?') { this.emit(`+CIPMUX:${this.mux}\r\n`); return this.ok(); }
    if (c.startsWith('AT+CIPSERVER=0')) { if (!this.server) return this.err(); this.server = false; return this.ok(); }
    if (c.startsWith('AT+CIPSERVER=1')) { if (this.mux !== 1) return this.err(); this.server = true; return this.ok(); }
    if (c.startsWith('AT+CIPSSLCCONF=')) return has('CIPSSLCCONF') ? this.ok() : this.err();
    if (c.startsWith('AT+HTTPCLIENT=')) {
      if (!has('HTTPCLIENT') || !this.wifi) return this.err();
      if (this.o.crashOn === 'https' && c.includes('https://')) {
        await sleep(100);
        this.emit('\r\nWill force to restart!!!\r\n');
        await sleep(150);
        return this.reboot();
      }
      await sleep(80);
      this.emit('+HTTPCLIENT:5,hello\r\n'); return this.ok();
    }
    if ((m = c.match(/^AT\+SYSMFG=2,"(\w+)","([\w.]+)",8,(\d+)/))) {
      if (!has('SYSMFG')) return this.err();
      const n = Number(m[3]);
      this.emit('\r\nOK\r\n\r\n>');
      this.pending = { n, buf: '', onDone: (data) => { this.mfg[m[2]] = data; this.ok(); } };
      return;
    }
    if ((m = c.match(/^AT\+BT(\w+)/))) {
      if (!has('BTINIT')) return this.err();
      if (c === 'AT+BTINIT=1') { this.bt = true; return this.ok(); }
      if (c === 'AT+BTINIT=0') { this.bt = false; return this.ok(); }
      if (!this.bt) return this.err();
      if ((m = c.match(/^AT\+BTNAME="([^"]*)"/))) { this.btName = m[1]; return this.ok(); }
      if (c === 'AT+BTNAME?') { this.emit(`+BTNAME:${this.btName}\r\n`); return this.ok(); }
      return this.ok();
    }
    if (c.startsWith('AT+MQTT')) {
      if (!has('MQTTCONN')) return this.err();
      if (c.startsWith('AT+MQTTCONN=')) { await sleep(100); if (!this.o.mqttOk || !this.wifi) { this.emit('+MQTTDISCONNECTED:0\r\n'); return this.err(); } this.emit('+MQTTCONNECTED:0,7,"x","443","/mqtt",1\r\n'); this.ev('mqttlog New client connected as ujiat-abc123'); return this.ok(); }
      return this.ok();
    }
    return this.err();
  }

  async reboot() {
    this.emit('\r\nets Jun  8 2016 00:22:57\r\nrst:0x1 (POWERON_RESET)\r\n');
    this.wifi = false; this.conn = null; this.echo = true; this.timeSynced = false; this.bt = false; this.passthrough = false; this.pending = null;
    await sleep(120);
    this.emit('\r\nready\r\n');
  }

  // ---------------- "internet": server uji HTTP sederhana + NTP UDP
  connData(data) {
    const cn = this.conn;
    if (!cn) return;
    if (cn.type === 'UDP') {
      if (cn.port === 123 && data.length === 48 && data.charCodeAt(0) === 0x1b) setTimeout(() => this.ipd('\x1c' + '\0'.repeat(47)), 60);
      return;
    }
    if (cn.port === 4242 || cn.port === 4243) { setTimeout(() => this.ipd(data), 40); return; }
    cn.buf += data;
    if (cn.bodyLeft) {
      const take = Math.min(cn.bodyLeft, cn.buf.length);
      cn.body += cn.buf.slice(0, take); cn.buf = cn.buf.slice(take); cn.bodyLeft -= take;
      if (cn.bodyLeft === 0) this.respondSink(cn);
      return;
    }
    const end = cn.buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    const head = cn.buf.slice(0, end); cn.buf = cn.buf.slice(end + 4);
    const [reqLine] = head.split('\r\n');
    if (!/\r\nHost: /i.test(head + '\r\n') && !/Host: /i.test(head)) { setTimeout(() => this.http(400, 'no host', true), 30); return; }
    cn.close = /Connection: close/i.test(head);
    const path = reqLine.split(' ')[1] || '/';
    if (/\/sink$/.test(path)) {
      cn.body = ''; cn.bodyLeft = Number((/Content-Length: (\d+)/i.exec(head) || [])[1] || 0);
      const take = Math.min(cn.bodyLeft, cn.buf.length);
      cn.body += cn.buf.slice(0, take); cn.buf = cn.buf.slice(take); cn.bodyLeft -= take;
      if (cn.bodyLeft === 0) this.respondSink(cn);
      return;
    }
    if (/\/hold$/.test(path)) { cn.hold = true; this.ev('hold open #1'); setTimeout(() => this.ipd('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\ne\r\nHOLD 1 READY\r\n\r\n'), 30); return; }
    if (/\/hello$/.test(path)) { setTimeout(() => this.http(200, 'hello', cn.close), 40); return; }
    const sz = /\/size\/(\d+)$/.exec(path);
    if (sz) { setTimeout(() => this.http(200, PAT.repeat(Math.ceil(sz[1] / 36)).slice(0, Number(sz[1])), cn.close), 40); return; }
    setTimeout(() => this.http(404, 'UJIAT 404', cn.close), 30);
  }
  respondSink(cn) {
    let bad = -1;
    for (let i = 0; i < cn.body.length; i++) if (cn.body[i] !== PAT[i % 36]) { bad = i; break; }
    const verdict = bad < 0 ? 'UTUH' : `RUSAK@${bad}`;
    this.ev(`sink ${cn.body.length} B ${verdict}`);
    setTimeout(() => this.http(200, `RECV ${cn.body.length} ${verdict}\r\n`, cn.close), 30);
  }
  http(status, body, close) {
    this.ipd(`HTTP/1.1 ${status} OK\r\nContent-Length: ${body.length}\r\nConnection: ${close ? 'close' : 'keep-alive'}\r\n\r\n${body}`);
    if (close) setTimeout(() => { if (this.conn) { this.conn = null; this.emit('CLOSED\r\n'); } }, 20);
  }
  ipd(data) { if (this.conn) this.emit(`\r\n+IPD,${data.length}:${data}`); }
  // aksi dashboard
  holdPush(text) { if (this.conn?.hold) { const chunk = text + '\r\n'; this.ipd(`${chunk.length.toString(16)}\r\n${chunk}\r\n`); return 1; } return 0; }
  holdClose() { if (this.conn?.hold) { this.ipd('a\r\nHOLD BYE\r\n\r\n0\r\n\r\n'); setTimeout(() => { if (this.conn?.close) { this.conn = null; this.emit('CLOSED\r\n'); } }, 30); return 1; } return 0; }
}
