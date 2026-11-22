/* Momir Machine: pick a mana value, get a random creature, print it as a receipt.
 * Data comes from creatures.json (built by data/prep.py); layout and ESC/POS come from format.js. */
(() => {
  'use strict';

  const F = window.MomirFormat;
  const KEYS = { settings: 'momir.settings', log: 'momir.log' };
  const MAX_LOG = 300;
  const $ = id => document.getElementById(id);

  // Browser storage can be missing or throw (private windows, blocked site data): never depend on it.
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* in-memory only */ }
    },
  };

  const state = {
    data: null,
    byName: new Map(),
    settings: Object.assign({ autoPrint: false, noRepeat: true, output: 'rawbt' }, store.get(KEYS.settings, {})),
    log: store.get(KEYS.log, []),   // newest first: [{n, mv, ts}]
    current: null,                  // {card, mv}
    installEvent: null,
  };

  // ---------- small helpers ----------

  function rand(n) {
    const c = window.crypto;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return Math.floor(buf[0] / 4294967296 * n);
    }
    return Math.floor(Math.random() * n);
  }

  let statusTimer = null;
  function setStatus(msg) {
    const el = $('status');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function showNotice(msg) {
    const el = $('notice');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // ---------- picking a creature ----------

  function pick(mv) {
    const pool = (state.data.byMv[String(mv)]) || [];
    if (!pool.length) return null;
    let candidates = pool;
    let exhausted = false;
    if (state.settings.noRepeat) {
      const used = new Set(state.log.filter(e => e.mv === mv).map(e => e.n));
      const fresh = pool.filter(c => !used.has(c.n));
      if (fresh.length) candidates = fresh; else exhausted = true;
    }
    return { card: candidates[rand(candidates.length)], exhausted };
  }

  function generate(mv) {
    if (!state.data) return;
    const picked = pick(mv);
    if (!picked) { setStatus('No creatures with mana value ' + mv); return; }

    state.log.unshift({ n: picked.card.n, mv, ts: Date.now() });
    if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;
    store.set(KEYS.log, state.log);

    show(picked.card, mv);
    renderLog();
    if (picked.exhausted) setStatus('Every creature at MV ' + mv + ' has been used this game, so this one repeats');
    if (state.settings.autoPrint) printCurrent();
  }

  // ---------- rendering ----------

  function show(card, mv) {
    state.current = { card, mv };
    $('resultName').textContent = card.n;
    $('resultMeta').textContent = 'Mana value ' + mv;
    $('printBtn').disabled = false;

    const box = $('receipt');
    box.textContent = '';
    for (const l of F.cardToLines(card, mv)) {
      const div = document.createElement('div');
      div.className = 'ln' + (l.b ? ' b' : '') + (l.dh ? ' dh' : '') + (l.dw ? ' dw' : '') + ' a-' + (l.a || 'l');
      div.textContent = l.t === '' ? ' ' : l.t;   // textContent: card text is never treated as HTML
      box.appendChild(div);
    }
    box.hidden = false;
  }

  function buildGrid() {
    const grid = $('grid');
    grid.textContent = '';
    for (let mv = 0; mv <= 16; mv++) {
      const count = (state.data.byMv[String(mv)] || []).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv';
      b.disabled = count === 0;
      b.setAttribute('aria-label', 'Mana value ' + mv + ', ' + count + ' creatures');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = mv;
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = count;
      b.append(num, cnt);
      b.addEventListener('click', () => generate(mv));
      grid.appendChild(b);
    }
  }

  function renderLog() {
    const list = $('log');
    list.textContent = '';
    $('logCount').textContent = state.log.length ? '(' + state.log.length + ')' : '';
    if (!state.log.length) {
      const li = document.createElement('li');
      li.className = 'muted empty';
      li.textContent = 'Nothing generated yet.';
      list.appendChild(li);
      return;
    }
    for (const entry of state.log.slice(0, 100)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'logitem';
      const mv = document.createElement('span');
      mv.className = 'logmv';
      mv.textContent = 'MV ' + entry.mv;
      b.append(mv, document.createTextNode(' ' + entry.n));
      b.addEventListener('click', () => {
        const hit = state.byName.get(entry.n);
        if (hit) show(hit.card, entry.mv);
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  // ---------- printing ----------

  /* Output layer: the only place that knows how bytes reach a printer.
   * RawBT documents a "rawbt:base64,<data>" link that hands raw bytes to the app. */
  function send(bytes) {
    if (state.settings.output === 'preview') { setStatus('Preview only: nothing sent to a printer'); return; }
    const a = document.createElement('a');
    a.href = 'rawbt:base64,' + F.toBase64(bytes);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('Sent to RawBT');
  }

  function printCurrent() {
    if (!state.current) return;
    send(F.toEscPos(F.cardToLines(state.current.card, state.current.mv)));
  }

  // ---------- settings, install, startup ----------

  function bindSettings() {
    const s = state.settings;
    $('optAuto').checked = !!s.autoPrint;
    $('optNoRepeat').checked = !!s.noRepeat;
    $('optOutput').value = s.output;
    const save = () => store.set(KEYS.settings, s);
    $('optAuto').addEventListener('change', e => { s.autoPrint = e.target.checked; save(); });
    $('optNoRepeat').addEventListener('change', e => { s.noRepeat = e.target.checked; save(); });
    $('optOutput').addEventListener('change', e => { s.output = e.target.value; save(); });
    $('testBtn').addEventListener('click', () => send(F.toEscPos(F.testPage())));
  }

  function bindActions() {
    $('printBtn').addEventListener('click', printCurrent);
    $('newGame').addEventListener('click', () => {
      if (state.log.length && !window.confirm('Start a new game? This clears the list and lets creatures repeat again.')) return;
      state.log = [];
      store.set(KEYS.log, state.log);
      renderLog();
    });
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.installEvent = e;
      $('installBtn').hidden = false;
    });
    $('installBtn').addEventListener('click', async () => {
      const ev = state.installEvent;
      if (!ev) return;
      ev.prompt();
      await ev.userChoice;
      state.installEvent = null;
      $('installBtn').hidden = true;
    });
  }

  async function loadData() {
    try {
      const res = await fetch('creatures.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = await res.json();
    } catch (err) {
      const hint = location.protocol === 'file:'
        ? 'Open this through a web server (for example: python3 -m http.server in the docs folder), not as a file.'
        : 'Run data/prep.py to build docs/creatures.json, then reload.';
      showNotice('Could not load creatures.json (' + err.message + '). ' + hint);
      return;
    }
    for (const [mv, list] of Object.entries(state.data.byMv)) {
      for (const card of list) state.byName.set(card.n, { card, mv: Number(mv) });
    }
    buildGrid();
    $('dataInfo').textContent = state.data.count + ' creatures, data from ' + state.data.generated + '.';
  }

  function init() {
    bindSettings();
    bindActions();
    renderLog();
    loadData();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode just won't be available */ });
    }
  }

  init();
})();
