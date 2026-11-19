// Inti runner Uji AT: tanpa DOM, dipakai di browser (window.UjiRunner) dan di uji Node (globalThis.UjiRunner).
//
// Sintaks skrip per baris (lihat juga app/src/tests.js):
//   AT...            kirim + CR LF, tunggu OK/ERROR/FAIL (atau '>' bila baris berikut '>>')
//   - AT...          langkah persiapan: dijalankan, hasilnya tidak ikut dinilai, ERROR diabaikan
//   >> data          kirim data mentah (escape \r \n \t \0 \xHH, {FILL:n:off}, {ZERO:n}, {PEM:k}, {PEMZ:k})
//   >>! data         kirim data mentah tanpa menunggu
//   ?? regex         tunggu teks serial
//   ?ev regex        tunggu bukti di server
//   ~ ms             jeda
//   !aksi ...        hold-push, hold-close, ws-push, ws-close, mqtt-pub, wifi (pastikan Wi-Fi), net (pastikan internet)
//   @loop N / @end   ulangi
//   akhiran ;t=ms    batas waktu baris itu
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PAT = '0123456789abcdefghijklmnopqrstuvwxyz';
  function fill(n, off = 0) { let s = ''; for (let i = 0; i < n; i++) s += PAT[(off + i) % PAT.length]; return s; }
  const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Escape parameter string AT: \ " , harus diawali backslash
  const atEscape = (s) => String(s).replace(/([\\",])/g, '\\$1');

  const PH = ['HOST', 'T', 'WS', 'SSID', 'PASS', 'MQTT_USER', 'MQTT_PASS', 'TOPIC_ID', 'TOPIC', 'OTA_FILE', 'BT_NAME', 'BT_PIN', 'AP_SSID', 'AP_PASS', 'AP_CH', 'BLE_NAME', 'MDNS'];
  const AT_STRING_PH = new Set(['SSID', 'PASS', 'BT_NAME', 'BT_PIN', 'AP_SSID', 'AP_PASS', 'BLE_NAME', 'MDNS', 'MQTT_USER', 'MQTT_PASS']);
  const PH_RE = new RegExp('\\{(' + PH.join('|') + ')\\}', 'g');

  // mode: 'at' (nilai di-escape untuk perintah AT), 're' (di-escape untuk regex), 'raw'
  function resolve(s, ctx, mode = 'raw') {
    return String(s ?? '').replace(PH_RE, (_, k) => {
      const v = ctx[k] ?? '';
      if (mode === 're') return reEscape(v);
      if (mode === 'at' && AT_STRING_PH.has(k)) return atEscape(v);
      return String(v);
    });
  }
  function unescapeRaw(s) {
    return s.replace(/\\(x[0-9a-fA-F]{2}|r|n|t|0|\\)/g, (_, c) => {
      if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
      return ({ r: '\r', n: '\n', t: '\t', 0: '\0', '\\': '\\' })[c];
    });
  }
  function payloadString(raw, ctx, certs) {
    let s = unescapeRaw(resolve(raw, ctx, 'raw'));
    s = s.replace(/\{FILL:(\d+)(?::(\d+))?\}/g, (_, n, o) => fill(Number(n), Number(o || 0)));
    s = s.replace(/\{ZERO:(\d+)\}/g, (_, n) => '\0'.repeat(Number(n)));
    s = s.replace(/\{PEM(Z?):([a-z_]+)\}/g, (_, z, k) => {
      if (!certs[k]) throw new Error(`Sertifikat "${k}" belum tersedia (lihat tab Sertifikat)`);
      return certs[k] + (z ? '\0' : '');
    });
    return s;
  }
  // byte apa adanya (latin1) supaya \xHH dan \0 terkirim 1 byte
  function toBytes(s) {
    if (/^[\x00-\x7f]*$/.test(s)) return enc.encode(s);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  function splitTimeout(line) {
    const m = line.match(/^(.*?)\s;t=(\d+)\s*$/);
    return m ? [m[1], Number(m[2])] : [line, null];
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
  function nextPayloadLine(lines, i) {
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.startsWith('>>')) return l.replace(/^>>!?\s?/, '');
      if (/^-?\s*AT/i.test(l)) return null;
    }
    return null;
  }
  function scriptLines(tc) {
    return expandLoops(String(tc.run || '').split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('#')));
  }

  const RE_DONE = /(?:^|\n)(OK|ERROR|FAIL|SEND OK|SEND FAIL)\r?\n|busy p/;
  const RE_PROMPT = /(?:^|\n)>|(?:^|\n)(ERROR|FAIL)\r?\n|busy p/;
  const RE_AFTER_RAW = /SEND OK|SEND FAIL|\+MQTTPUB:(OK|FAIL)|(?:^|\n)(OK|ERROR|FAIL)\r?\n/;
  const RE_BOOT = /(?:^|\n)ready\r?\n|Will force to restart|rst:0x[0-9a-f]+|Guru Meditation|abort\(\) was called/;
  function defaultTimeout(cmd) {
    if (/CWJAP=|CWLAP/.test(cmd)) return 25000;
    if (/CIPSTART|MQTTCONN=|HTTPC|WSOPEN|USEROTA|CIPDOMAIN|PING|BLESCAN=|BTSTARTDISC/.test(cmd)) return 30000;
    if (/AT\+CMD\?|SYSMFG=1/.test(cmd)) return 15000;
    if (/AT\+RST|GSLP|RESTORE/.test(cmd)) return 6000;
    return 10000;
  }

  /**
   * opts:
   *  write(bytes) -> Promise          kirim ke ESP
   *  rx() -> string                   seluruh teks yang sudah diterima
   *  ctx() -> object                  nilai placeholder (HOST, SSID, ...)
   *  certs() -> {key: pem}
   *  action(name, args) -> Promise    aksi dashboard (hold-push, mqtt-pub, ...)
   *  findEvent(re, sinceId) / lastEventId()
   *  status(id) -> string             status uji di putaran aktif
   *  save(id, {status, actual})       simpan hasil
   *  log(kind, text)                  kind: 'tx' | 'sys' | 'ok' | 'bad'
   *  progress(text)
   *  settings() -> {autoWifi}
   */
  function createRunner(opts) {
    const st = { abort: false, busy: false };
    const log = (k, t) => opts.log && opts.log(k, t);
    const progress = (t) => opts.progress && opts.progress(t);

    async function waitSerial(re, timeout, from) {
      const end = Date.now() + timeout;
      for (;;) {
        if (st.abort) throw new Error('Dihentikan');
        const m = opts.rx().slice(from).match(re);
        if (m) return m;
        if (Date.now() >= end) return null;
        await sleep(25);
      }
    }
    async function waitEvent(re, timeout, sinceId) {
      const end = Date.now() + timeout;
      for (;;) {
        if (st.abort) throw new Error('Dihentikan');
        const ev = opts.findEvent(re, sinceId);
        if (ev) return ev;
        if (Date.now() >= end) return null;
        await sleep(100);
      }
    }
    async function sendLine(s) {
      log('tx', s + '\n');
      await opts.write(enc.encode(s + '\r\n'));
    }
    async function sendRaw(bytes) {
      const preview = Array.from(bytes.slice(0, 120), (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : b === 10 ? '\\n' : b === 13 ? '\\r' : '·')).join('');
      log('tx', `» ${preview}${bytes.length > 120 ? `… (${bytes.length} byte)` : ''}\n`);
      for (let i = 0; i < bytes.length; i += 1024) await opts.write(bytes.slice(i, i + 1024));
    }
    // Kirim satu perintah AT dan tunggu hasilnya (dengan kirim ulang bila "busy")
    // Berhenti menunggu juga bila ESP ternyata restart/crash (kecuali perintah memang me-restart)
    const RE_DONE_BOOT = new RegExp(RE_DONE.source + '|' + RE_BOOT.source);
    const RE_PROMPT_BOOT = new RegExp(RE_PROMPT.source + '|' + RE_BOOT.source);
    async function command(cmd, timeout, wantPrompt = false) {
      let m = null, from = 0;
      const restarts = /AT\+(RST|GSLP|RESTORE)/.test(cmd);
      for (let attempt = 0; attempt < 4; attempt++) {
        await sleep(40);
        from = opts.rx().length;
        await sendLine(cmd);
        const re = restarts ? (wantPrompt ? RE_PROMPT : RE_DONE) : (wantPrompt ? RE_PROMPT_BOOT : RE_DONE_BOOT);
        m = await waitSerial(re, timeout || defaultTimeout(cmd), from);
        if (!m || !/busy/.test(m[0])) break;
        await waitSerial(/(?:^|\n)(OK|ERROR)\r?\n/, 4000, from);
      }
      const booted = !!(m && !restarts && RE_BOOT.test(m[0]));
      return { m, from, booted, text: opts.rx().slice(from) };
    }

    // ---------------- prasyarat
    async function ensureReady() {
      for (let i = 0; i < 4; i++) {
        const r = await command('AT', 2500);
        if (r.m && /OK/.test(r.m[0])) return true;
        // mungkin sedang boot atau masih memproses perintah lama
        await waitSerial(/(?:^|\n)(ready|OK|ERROR)\r?\n/, 4000, r.from);
      }
      return false;
    }
    async function wifiUp() {
      let r = await command('AT+CWSTATE?', 4000);
      if (/\+CWSTATE:2/.test(r.text)) return true;
      if (/ERROR/.test(r.text)) { // perintah lama tanpa CWSTATE
        r = await command('AT+CIPSTA?', 4000);
        return /\+CIPSTA:ip:"(?!0\.0\.0\.0)\d/.test(r.text);
      }
      return false;
    }
    async function ensureWifi(notes) {
      if (await wifiUp()) return;
      const c = opts.ctx();
      if (!c.SSID || c.SSID === '<ssid>') throw new Error('Wi-Fi belum tersambung dan SSID belum diisi (kolom Parameter uji)');
      const t0 = Date.now();
      const mode = (await command('AT+CWMODE?', 4000)).text.match(/\+CWMODE:(\d)/);
      if (mode && (mode[1] === '0' || mode[1] === '2')) await command(`AT+CWMODE=${mode[1] === '2' ? 3 : 1}`, 5000);
      for (let i = 0; i < 2; i++) {
        const r = await command(`AT+CWJAP="${atEscape(c.SSID)}","${atEscape(c.PASS)}"`, 25000);
        if (/WIFI GOT IP|(?:^|\n)OK\r?\n/.test(r.text) && await wifiUp()) {
          notes.push(`prasyarat: Wi-Fi disambungkan ulang (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
          return;
        }
      }
      throw new Error(`Gagal menyambung Wi-Fi "${c.SSID}"`);
    }
    async function ensureNet(notes) {
      await ensureWifi(notes);
      const host = opts.ctx().HOST;
      for (let i = 0; i < 2; i++) {
        const r = await command(`AT+CIPDOMAIN="${host}"`, 20000);
        if (/\+CIPDOMAIN:/.test(r.text)) return;
        await sleep(1500);
      }
      throw new Error(`Internet/DNS belum siap (AT+CIPDOMAIN="${host}" gagal)`);
    }

    // ---------------- satu uji
    function blockedBy(tc) {
      for (const id of tc.requires || []) {
        const s = opts.status(id);
        if (s === 'Gagal' || s === 'Lewati') return id;
      }
      return null;
    }
    async function runTest(tc, runOpts = {}) {
      if (!tc.run) throw new Error('Uji ini manual');
      const t0 = Date.now();
      const ctx = opts.ctx();
      const lines = scriptLines(tc);
      const notes = [];
      let failed = false;
      log('sys', `▶ ${tc.id} ${tc.name}`);

      const blocker = runOpts.ignoreRequires ? null : blockedBy(tc);
      if (blocker) {
        const msg = `Dilewati: prasyarat ${blocker} tidak lulus`;
        log('bad', `⤼ ${tc.id} ${msg}`);
        await opts.save(tc.id, { status: 'Lewati', actual: msg });
        return 'skip';
      }
      if (tc.precheck === 'otaFile' && !ctx.OTA_FILE_SET) {
        const msg = 'Dilewati: belum ada file OTA aktif (tab OTA)';
        await opts.save(tc.id, { status: 'Lewati', actual: msg });
        return 'skip';
      }
      if (tc.precheck && tc.precheck.startsWith('cert:') && !opts.certs()[tc.precheck.slice(5)]) {
        const msg = `Dilewati: sertifikat ${tc.precheck.slice(5)} belum dibuat (tab Sertifikat)`;
        await opts.save(tc.id, { status: 'Lewati', actual: msg });
        return 'skip';
      }

      // prasyarat: ESP menjawab, lalu Wi-Fi/internet bila perlu
      progress(`${tc.id} prasyarat`);
      if (!(await ensureReady())) {
        await opts.save(tc.id, { status: 'Gagal', actual: 'ESP tidak menjawab AT (cek kabel, baud, atau ESP sedang hang)' });
        log('bad', `✘ ${tc.id} ESP tidak menjawab`);
        return 'fail';
      }
      const autoWifi = opts.settings().autoWifi !== false;
      if (autoWifi && tc.needs) {
        try { await (tc.needs === 'net' ? ensureNet(notes) : ensureWifi(notes)); }
        catch (e) {
          if (e.message === 'Dihentikan') throw e;
          await opts.save(tc.id, { status: 'Gagal', actual: `PRASYARAT GAGAL: ${e.message}` });
          log('bad', `✘ ${tc.id} prasyarat: ${e.message}`);
          return 'fail';
        }
      }

      let start = opts.rx().length;
      const evStart = opts.lastEventId();
      let from = start;
      let setupPhase = true;
      let lastCmdError = false;
      const expectsError = /ERROR|FAIL|DISCONNECTED/.test(tc.expect || '');
      for (let i = 0; i < lines.length && !failed; i++) {
        let [line, to] = splitTimeout(lines[i]);
        const isSetup = line.startsWith('- ');
        if (isSetup) line = line.slice(2);
        else if (setupPhase) { setupPhase = false; start = opts.rx().length; from = start; }
        progress(`${tc.id}  ${i + 1}/${lines.length}  ${line.slice(0, 60)}`);

        if (line.startsWith('~')) { await sleep(Number(line.slice(1)) || 0); continue; }
        // Perintah sebelumnya sudah ERROR dan uji tidak mengharapkan ERROR: jangan buang waktu menunggu
        if (lastCmdError && !expectsError && (line.startsWith('??') || line.startsWith('?ev'))) {
          failed = true;
          notes.push('Dihentikan lebih awal: perintah sebelumnya dijawab ERROR');
          break;
        }
        if (line.startsWith('?ev')) {
          const re = new RegExp(resolve(line.slice(3).trim(), ctx, 're'), 'i');
          const ev = await waitEvent(re, to || 20000, evStart);
          if (ev) notes.push(`server: ${ev.summary}`);
          else { failed = true; notes.push(`TIDAK ada bukti di server untuk /${re.source}/`); }
          continue;
        }
        if (line.startsWith('??')) {
          const re = new RegExp(resolve(line.slice(2).trim(), ctx, 're'));
          if (!(await waitSerial(re, to || 15000, from))) { failed = true; notes.push(`TIMEOUT menunggu /${re.source}/`); }
          continue;
        }
        if (line.startsWith('!wifi') || line.startsWith('!net')) {
          try {
            if (!(await ensureReady())) throw new Error('ESP tidak menjawab');
            await (line.startsWith('!net') ? ensureNet(notes) : ensureWifi(notes));
          } catch (e) { if (e.message === 'Dihentikan') throw e; failed = true; notes.push('prasyarat gagal: ' + e.message); }
          from = opts.rx().length;
          continue;
        }
        if (line.startsWith('!')) {
          from = opts.rx().length;
          const [name, ...rest] = resolve(line.slice(1), ctx, 'raw').split(' ');
          try { const r = await opts.action(name, rest); notes.push(`dashboard ${name} → ${r && r.count != null ? r.count : 'ok'}`); }
          catch (e) { failed = true; notes.push('aksi gagal: ' + e.message); }
          continue;
        }
        if (line.startsWith('>>')) {
          const noWait = line.startsWith('>>!');
          const bytes = toBytes(payloadString(line.replace(/^>>!?\s?/, ''), ctx, opts.certs()));
          from = opts.rx().length;
          await sendRaw(bytes);
          if (!noWait && !(await waitSerial(RE_AFTER_RAW, to || 15000, from))) { failed = true; notes.push('TIMEOUT setelah kirim data'); }
          continue;
        }
        // perintah AT
        let cmd = resolve(line, ctx, 'at');
        if (cmd.includes('{LEN}')) {
          const p = nextPayloadLine(lines, i);
          cmd = cmd.replace('{LEN}', String(toBytes(payloadString(p || '', ctx, opts.certs())).length));
        }
        const wantPrompt = (lines[i + 1] || '').startsWith('>>');
        const r = await command(cmd, to, wantPrompt);
        from = r.from;
        if (r.booted) { failed = true; notes.push(`ESP restart saat menjalankan: ${cmd.slice(0, 80)}`); break; }
        if (isSetup) continue; // langkah persiapan: hasil apa pun diterima
        lastCmdError = !!(r.m && /ERROR|FAIL/.test(r.m[0]));
        if (!r.m) {
          failed = true;
          notes.push(`TIMEOUT menunggu OK/ERROR: ${cmd.slice(0, 80)}`);
          await waitSerial(/(?:^|\n)(OK|ERROR|FAIL)\r?\n/, 8000, r.from); // beri waktu ESP selesai
        } else if (/busy/.test(r.m[0])) { failed = true; notes.push(`ESP tetap sibuk: ${cmd.slice(0, 80)}`); }
        else if (wantPrompt && /ERROR|FAIL/.test(r.m[0])) { failed = true; notes.push(`Tidak dapat prompt '>' untuk: ${cmd.slice(0, 80)}`); }
      }
      await sleep(300);
      const rawOut = opts.rx().slice(start);
      const out = rawOut.replace(/\r/g, '');
      let expectOk = true;
      if (tc.expect) {
        const re = new RegExp(resolve(tc.expect, ctx, 're'));
        expectOk = re.test(rawOut) || re.test(out);
        if (!expectOk) notes.push(`Pola hasil tidak cocok: /${re.source}/`);
      }
      const rebooted = RE_BOOT.test(rawOut) && !tc.restart;
      if (rebooted) notes.push('ESP RESTART SENDIRI selama uji (kemungkinan crash firmware)');
      const pass = !failed && expectOk && !rebooted;
      const dur = Date.now() - t0;
      const actual = [pass ? 'OTOMATIS: LULUS' : 'OTOMATIS: GAGAL', `durasi ${(dur / 1000).toFixed(1)} s`, ...notes, '---', out.length > 1500 ? '…' + out.slice(-1500) : out].join('\n');
      const bad = notes.filter((n) => /TIMEOUT|TIDAK|gagal|Pola|sibuk|RESTART|prompt/i.test(n));
      log(pass ? 'ok' : 'bad', `${pass ? '✔' : '✘'} ${tc.id} ${pass ? 'Lulus' : 'Gagal'} (${(dur / 1000).toFixed(1)} s)${bad.length ? ' · ' + bad.join('; ') : ''}`);
      await opts.save(tc.id, { status: pass ? 'Lulus' : 'Gagal', actual });
      if (rebooted) await waitSerial(/(?:^|\n)ready\r?\n/, 6000, start); // tunggu ESP selesai boot
      return pass ? 'pass' : 'fail';
    }

    async function runMany(list, runOpts = {}) {
      if (st.busy) throw new Error('Runner sedang berjalan');
      st.busy = true; st.abort = false;
      const sum = { pass: 0, fail: 0, skip: 0, manual: 0 };
      try {
        for (const tc of list) {
          if (st.abort) break;
          if (!tc.run) { sum.manual++; continue; }
          if (tc.human && !runOpts.includeHuman) { sum.manual++; log('sys', `⤼ ${tc.id} dilewati: butuh tindakan manual (${tc.human})`); continue; }
          if (tc.long && !runOpts.includeLong) { sum.manual++; log('sys', `⤼ ${tc.id} dilewati: uji panjang`); continue; }
          runOpts.onStart && runOpts.onStart(tc);
          try { sum[await runTest(tc, runOpts)]++; }
          catch (e) {
            if (e.message === 'Dihentikan') { log('bad', 'Dihentikan'); break; }
            sum.fail++; log('bad', `${tc.id}: ${e.message}`);
            await opts.save(tc.id, { status: 'Gagal', actual: 'Kesalahan runner: ' + e.message });
          } finally { runOpts.onEnd && runOpts.onEnd(tc); }
        }
      } finally {
        st.busy = false;
        progress('');
      }
      return sum;
    }

    return {
      runTest: async (tc, o) => { if (st.busy) throw new Error('Runner sedang berjalan'); return runMany([tc], { includeHuman: true, includeLong: true, ignoreRequires: true, ...o }); },
      runMany,
      abort: () => { st.abort = true; },
      get busy() { return st.busy; },
    };
  }

  root.UjiRunner = { createRunner, resolve, payloadString, toBytes, scriptLines, splitTimeout, nextPayloadLine, fill, reEscape, atEscape, PH };
})(typeof window !== 'undefined' ? window : globalThis);
