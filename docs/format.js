/* Receipt formatter for Momir cards.
 *
 * Pure logic, no DOM and no I/O, so it runs unchanged in the browser, in Node tests,
 * and (ported) on an ESP32 later.
 *
 *   card (from creatures.json)  ->  cardToLines()  ->  lines  ->  toEscPos()  ->  bytes for the printer
 *                                                           \->  toText()    ->  plain text preview
 *
 * A "line" is {t: text, b: bold, dh: double height, dw: double width, a: 'l'|'c'|'r'}.
 * A 58mm printer at 203 dpi prints 384 dots across: 32 columns of the standard 12-dot font,
 * or 16 columns when double width.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MomirFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 32;

  // ---------- text cleanup (printers default to CP437, so keep everything plain ASCII) ----------

  const FOLD = {
    'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', 'ß': 'ss', 'Ø': 'O', 'ø': 'o', 'Ð': 'D', 'ð': 'd',
    'Þ': 'Th', 'þ': 'th', 'Ł': 'L', 'ł': 'l',
    '—': '-', '–': '-', '−': '-', '‑': '-', '•': '*', '·': '*', '…': '...',
    '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '«': '<<', '»': '>>',
    '½': '1/2', '¼': '1/4', '¾': '3/4', '∞': 'inf', '×': 'x', '÷': '/',
    ' ': ' ', '­': '', '​': '',
  };

  function asciiFold(s) {
    let out = '';
    for (const ch of String(s)) {
      if (FOLD[ch] !== undefined) { out += FOLD[ch]; continue; }
      const code = ch.codePointAt(0);
      if (code === 10 || (code >= 32 && code < 127)) { out += ch; continue; }
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : '?';
    }
    return out;
  }

  // "{2}{W}{W}" -> "2WW"; "{T}" -> "[T]" inside rules text. Hybrid/Phyrexian symbols get parentheses.
  function symbolToken(inner) {
    return inner.includes('/') ? '(' + inner + ')' : inner;
  }

  function manaCost(cost) {
    return (cost || '').replace(/\{([^}]+)\}/g, (_, s) => symbolToken(s));
  }

  function rulesText(text) {
    // Runs of adjacent symbols become one bracket group: "{2}{R}" -> "[2R]".
    return (text || '').replace(/(?:\{[^}]+\})+/g, run => {
      const parts = run.match(/\{([^}]+)\}/g).map(m => symbolToken(m.slice(1, -1)));
      return '[' + parts.join('') + ']';
    });
  }

  // ---------- layout helpers ----------

  function wrap(text, width) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (para.trim() === '') { lines.push(''); continue; }
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        while (word.length > width) {            // very long word: hard split
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, width));
          word = word.slice(width);
        }
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ' ' + word;
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  const rule = ch => ({ t: ch.repeat(COLS), a: 'l' });
  const blank = () => ({ t: '', a: 'l' });

  function padBetween(left, right, width) {
    const gap = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(gap) + right;
  }

  function faceLines(face, mv) {
    const lines = [];
    for (const l of wrap(asciiFold(face.n || ''), COLS)) lines.push({ t: l, b: true, dh: true, a: 'c' });

    const cost = asciiFold(manaCost(face.c));
    const mvLabel = mv != null ? 'MV ' + mv : '';
    if (cost || mvLabel) lines.push({ t: padBetween(cost, mvLabel, COLS), a: 'l' });

    for (const l of wrap(asciiFold(face.t || ''), COLS)) lines.push({ t: l, a: 'l' });
    lines.push(rule('-'));

    const body = asciiFold(rulesText(face.o));
    if (body) for (const l of wrap(body, COLS)) lines.push({ t: l, a: 'l' });

    if (face.p !== undefined && face.u !== undefined) {
      lines.push(blank());
      lines.push({ t: asciiFold(face.p + '/' + face.u), b: true, dw: true, dh: true, a: 'r' });
    }
    return lines;
  }

  /** card: {n, f:[face,...]}; mv: mana value to show (the chosen X). */
  function cardToLines(card, mv) {
    const lines = [rule('=')];
    card.f.forEach((face, i) => {
      if (i > 0) { lines.push(blank()); lines.push({ t: '- - - - - - // - - - - - -', a: 'c' }); lines.push(blank()); }
      lines.push(...faceLines(face, i === 0 ? mv : null));
    });
    lines.push(rule('='));
    return lines;
  }

  // ---------- outputs ----------

  function toText(lines) {
    return lines.map(l => {
      const used = l.t.length * (l.dw ? 2 : 1);   // double-width characters take two columns
      const pad = l.a === 'c' ? Math.floor((COLS - used) / 2) : l.a === 'r' ? COLS - used : 0;
      return ' '.repeat(Math.max(0, pad)) + l.t;
    }).join('\n');
  }

  /** ESC/POS bytes. opts.feed = blank lines after the receipt (default 4); opts.cut = send a cut command. */
  function toEscPos(lines, opts) {
    const o = Object.assign({ feed: 4, cut: false }, opts);
    const out = [0x1b, 0x40];                      // ESC @  initialize
    let align = 'l', bold = false, size = 0;
    const ALIGN = { l: 0, c: 1, r: 2 };
    for (const line of lines) {
      if ((line.a || 'l') !== align) { align = line.a || 'l'; out.push(0x1b, 0x61, ALIGN[align]); }   // ESC a n
      if (!!line.b !== bold) { bold = !!line.b; out.push(0x1b, 0x45, bold ? 1 : 0); }                  // ESC E n
      const sz = (line.dw ? 0x10 : 0) | (line.dh ? 0x01 : 0);
      if (sz !== size) { size = sz; out.push(0x1d, 0x21, size); }                                       // GS ! n
      for (const ch of line.t) { const c = ch.charCodeAt(0); out.push(c < 128 ? c : 0x3f); }
      out.push(0x0a);                                                                                   // LF
    }
    out.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0);                                            // reset styles
    if (o.feed) out.push(0x1b, 0x64, o.feed);                                                           // ESC d n  feed
    if (o.cut) out.push(0x1d, 0x56, 0x42, 0x00);                                                        // GS V B 0 partial cut
    return Uint8Array.from(out);
  }

  /** A short page for checking the printer connection and column width. */
  function testPage() {
    return [
      rule('='),
      { t: 'MOMIR PRINTER TEST', b: true, dh: true, a: 'c' },
      rule('-'),
      { t: '12345678901234567890123456789012', a: 'l' },
      { t: 'Left', a: 'l' }, { t: 'Center', a: 'c' }, { t: 'Right', a: 'r' },
      { t: '4/4', b: true, dw: true, dh: true, a: 'r' },
      rule('='),
    ];
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  }

  return { COLS, asciiFold, manaCost, rulesText, wrap, cardToLines, testPage, toText, toEscPos, toBase64 };
});
