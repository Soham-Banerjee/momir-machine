/* Momir Machine: pick a mana value, get a random creature, print it as a receipt.
 * Data comes from creatures.json (built by data/prep.py); layout and ESC/POS come from format.js. */
(() => {
  'use strict';

  const F = window.MomirFormat;
  const KEYS = { settings: 'momir.settings', log: 'momir.log', autoRows: 'momir.autorows' };
  const MAX_LOG = 300;
  const PX_PER_DOT = 0.65;   // preview scale: one normal text row (30 printer dots) is about 19.5px
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
    settings: Object.assign(
      { autoPrint: false, noRepeat: true, output: 'rawbt', hideCard: false, showCounts: true,
        fixedLength: false, fixedRows: null },   // fixedRows null = automatic
      store.get(KEYS.settings, {})),
    cards: [],                      // every creature, for length statistics
    autoRows: null,                 // cached automatic standard length
    analysis: null,                 // cached {rows, result} for the settings summary
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

  // ---------- fixed receipt length ----------

  // The automatic length depends only on the card data, so it is worked out once per data file and remembered.
  function autoRowsValue() {
    if (state.autoRows == null && state.cards.length) {
      const key = state.data.generated + ':' + state.data.count;
      const cached = store.get(KEYS.autoRows, null);
      if (cached && cached.key === key && cached.rows) {
        state.autoRows = cached.rows;
      } else {
        state.autoRows = F.autoRows(state.cards);
        store.set(KEYS.autoRows, { key, rows: state.autoRows });
      }
    }
    return state.autoRows == null ? 18 : state.autoRows;
  }

  function effectiveRows() {
    const n = state.settings.fixedRows;
    return n ? Math.max(F.MIN_ROWS, Math.min(F.MAX_ROWS, n)) : autoRowsValue();
  }

  /** Layout options for the formatter: undefined means natural (variable) length. */
  function layoutOpts() {
    return state.settings.fixedLength ? { fixedDots: effectiveRows() * F.PITCH.normal } : undefined;
  }

  function updateFixedInfo() {
    const s = state.settings;
    $('fixedBox').hidden = !s.fixedLength;
    if (!s.fixedLength || !state.cards.length) return;
    const rows = effectiveRows();
    if (!state.analysis || state.analysis.rows !== rows) {
      state.analysis = { rows, result: F.analyze(state.cards, rows * F.PITCH.normal) };
    }
    const r = state.analysis.result;
    const pct = n => (100 * n / r.cards).toFixed(1) + '%';
    const cm = (rows * F.PITCH.normal / 203 * 2.54).toFixed(1);
    $('optFixedRows').placeholder = 'auto (' + autoRowsValue() + ')';
    $('fixedInfo').textContent = rows + ' rows' + (s.fixedRows ? '' : ' (automatic)') + ', about ' + cm + ' cm of paper per card. ' +
      pct(r.normal) + ' of creatures print at normal size, ' + pct(r.small) + ' use small text, ' +
      pct(r.over) + ' are too long even then and print longer than standard.';
  }

  // ---------- rendering ----------

  function show(card, mv) {
    state.current = { card, mv };
    renderCurrent();
  }

  // Surprise mode: the card is still picked and still prints, but its name and text never appear on screen.
  function renderCurrent() {
    if (!state.current) return;
    const { card, mv } = state.current;
    const box = $('receipt');
    box.textContent = '';
    $('printBtn').disabled = false;

    if (state.settings.hideCard) {
      $('resultName').textContent = 'Card hidden';
      $('resultMeta').textContent = 'Mana value ' + mv + '. Print it to see what you got.';
      box.hidden = true;
      return;
    }

    const res = F.layoutCard(card, mv, layoutOpts());
    $('resultName').textContent = card.n;
    $('resultMeta').textContent = 'Mana value ' + mv +
      (res.overflow ? ' · longer than the standard length' : res.tier > 0 ? ' · printed in small text' : '');
    for (const l of res.lines) {
      const div = document.createElement('div');
      if (l.feed !== undefined) {                       // blank paper that pads a short card to standard length
        div.className = 'spacer';
        div.style.height = (l.feed * PX_PER_DOT) + 'px';
        box.appendChild(div);
        continue;
      }
      div.className = 'ln' + (l.b ? ' b' : '') + (l.dh ? ' dh' : '') + (l.dw ? ' dw' : '') + (l.sm ? ' sm' : '') + ' a-' + (l.a || 'l');
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
      const showCounts = state.settings.showCounts;
      b.setAttribute('aria-label', 'Mana value ' + mv + (showCounts ? ', ' + count + ' creatures' : ''));
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = mv;
      b.append(num);
      if (showCounts) {
        const cnt = document.createElement('span');
        cnt.className = 'cnt';
        cnt.textContent = count;
        b.append(cnt);
      }
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
      if (state.settings.hideCard) {
        // Names stay secret in surprise mode and come back when it is switched off.
        b.append(mv, document.createTextNode(' Hidden card'));
        b.disabled = true;
      } else {
        b.append(mv, document.createTextNode(' ' + entry.n));
        b.addEventListener('click', () => {
          const hit = state.byName.get(entry.n);
          if (hit) show(hit.card, entry.mv);
        });
      }
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
    send(F.toEscPos(F.cardToLines(state.current.card, state.current.mv, layoutOpts())));
  }

  /** For checking lengths on paper: the shortest, a middle and the longest single-faced creature, in the current mode. */
  function printSamples() {
    const singles = [...state.byName.values()]
      .filter(v => v.card.f.length === 1)
      .map(v => ({ v, h: F.faceNaturalDots(v.card.f[0]) }))
      .sort((a, b) => a.h - b.h);
    if (!singles.length) { setStatus('Card data is not loaded yet'); return; }
    const picks = [singles[0], singles[Math.floor(singles.length / 2)], singles[singles.length - 1]];
    const opts = layoutOpts();
    const parts = picks.map(p => F.toEscPos(F.cardToLines(p.v.card, p.v.mv, opts)));
    const bytes = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    send(bytes);
  }

  // ---------- settings, install, startup ----------

  function bindSettings() {
    const s = state.settings;
    $('optAuto').checked = !!s.autoPrint;
    $('optNoRepeat').checked = !!s.noRepeat;
    $('optOutput').value = s.output;
    $('optHide').checked = !!s.hideCard;
    $('optCounts').checked = !!s.showCounts;
    const save = () => store.set(KEYS.settings, s);
    $('optHide').addEventListener('change', e => {
      s.hideCard = e.target.checked; save();
      renderCurrent();
      renderLog();
    });
    $('optCounts').addEventListener('change', e => {
      s.showCounts = e.target.checked; save();
      if (state.data) buildGrid();
    });
    $('optAuto').addEventListener('change', e => { s.autoPrint = e.target.checked; save(); });
    $('optNoRepeat').addEventListener('change', e => { s.noRepeat = e.target.checked; save(); });
    $('optOutput').addEventListener('change', e => { s.output = e.target.value; save(); });
    $('testBtn').addEventListener('click', () => send(F.toEscPos(F.testPage())));
    $('sampleBtn').addEventListener('click', printSamples);

    $('optFixed').checked = !!s.fixedLength;
    $('optFixedRows').value = s.fixedRows || '';
    // The length statistics cover every creature, so run them after the control has repainted.
    const refreshFixed = () => setTimeout(() => { updateFixedInfo(); renderCurrent(); }, 0);
    $('optFixed').addEventListener('change', e => {
      s.fixedLength = e.target.checked; save();
      $('fixedBox').hidden = !s.fixedLength;
      refreshFixed();
    });
    $('optFixedRows').addEventListener('change', e => {
      const n = parseInt(e.target.value, 10);
      s.fixedRows = Number.isFinite(n) ? Math.max(F.MIN_ROWS, Math.min(F.MAX_ROWS, n)) : null;
      e.target.value = s.fixedRows || '';
      save();
      refreshFixed();
    });
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
      for (const card of list) { state.byName.set(card.n, { card, mv: Number(mv) }); state.cards.push(card); }
    }
    buildGrid();
    setTimeout(updateFixedInfo, 0);
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
