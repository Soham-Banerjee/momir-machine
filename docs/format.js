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
 *
 * Fixed-length mode (opts.fixedDots): every receipt comes out the same length. Short cards are padded with
 * blank paper; long cards switch the rules text to the small font (42 columns), then the type line too.
 * Lines then also carry sm (small font), sp (paper advance per line in dots) and feed (blank paper in dots).
 * A card too long even for the smallest layout prints longer than standard rather than losing words.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MomirFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 32;
  const COLS_SM = 42;   // small font (Font B, 9-dot characters) on a 384-dot print head

  // How far the paper advances per line in fixed-length mode, in printer dots (about 0.125 mm each at 203 dpi).
  // If printed lengths ever disagree with these numbers, this is the one place to calibrate.
  const PITCH = { normal: 30, small: 20, big: 60 };
  const MIN_ROWS = 14, MAX_ROWS = 60;   // allowed standard lengths, in normal rows (1 row = 30 dots, about 3.75 mm)

  // ---------- text cleanup (printers default to CP437, so keep everything plain ASCII) ----------

  const FOLD = {
    'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', 'ß': 'ss', 'Ø': 'O', 'ø': 'o', 'Ð': 'D', 'ð': 'd',
    'Þ': 'Th', 'þ': 'th', 'Ł': 'L', 'ł': 'l',
    '—': '-', '–': '-', '−': '-', '‑': '-', '•': '*', '·': '*', '…': '...',
    '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '«': '<<', '»': '>>',
    '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '∞': 'inf', '×': 'x', '÷': '/',
    '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '±': '+/-', '²': '2', '³': '3',
    '™': 'TM', '®': '(R)', '©': '(C)', '★': '*', '☆': '*',
    ' ': ' ', '­': '', '​': '',
  };

  // Lookalike colon used in some names (Assassin's Creed). Built from its code point so the source stays plain.
  FOLD[String.fromCharCode(0xa789)] = ':';
  FOLD[String.fromCharCode(0xff1a)] = ':';

  // Some playtest cards cross words out with a combining stroke after each letter ("Double b̶r̶e̶a̶k̶e̶r̶ strike").
  // The crossed-out letters are not part of the card, so drop them; any other lone combining mark is dropped too.
  const STROKE = String.fromCharCode(0x336);
  const STRUCK = new RegExp('[^' + STROKE + ']' + STROKE, 'gu');
  const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const dropStruck = s => String(s).replace(STRUCK, '').replace(MARKS, '');

  function asciiFold(s) {
    let out = '';
    for (const ch of dropStruck(s)) {
      if (FOLD[ch] !== undefined) { out += FOLD[ch]; continue; }
      const code = ch.codePointAt(0);
      if (code === 10 || (code >= 32 && code < 127)) { out += ch; continue; }
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : '?';
    }
    return out;
  }

  /** Characters in `s` that asciiFold can only print as "?" (a real "?" is not counted). */
  function unmappedChars(s) {
    const bad = new Set();
    for (const ch of String(s)) if (ch !== '?' && asciiFold(ch) === '?') bad.add(ch);
    return [...bad];
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

  const tagged = (base, extra) => (extra ? Object.assign(base, extra) : base);

  /** The three blocks of one face: head (name, cost, type), body (rules text), foot (power/toughness).
   *  tier 0: normal text. tier 1: rules text in the small font. tier 2: type line small too, no spacer line.
   *  withSp: tag every line with its paper advance (fixed-length mode only; leave off for natural length). */
  function faceParts(face, mv, tier, withSp) {
    const N = withSp ? { sp: PITCH.normal } : null;
    const S = withSp ? { sp: PITCH.small } : null;
    const smallBody = tier >= 1, smallType = tier >= 2;
    const head = [], body = [], foot = [];

    for (const l of wrap(asciiFold(face.n || ''), COLS)) head.push(tagged({ t: l, b: true, dh: true, a: 'c' }, N));

    const cost = asciiFold(manaCost(face.c));
    const mvLabel = mv != null ? 'MV ' + mv : '';
    if (cost || mvLabel) head.push(tagged({ t: padBetween(cost, mvLabel, COLS), a: 'l' }, N));

    for (const l of wrap(asciiFold(face.t || ''), smallType ? COLS_SM : COLS)) {
      head.push(smallType ? tagged({ t: l, a: 'l', sm: true }, S) : tagged({ t: l, a: 'l' }, N));
    }
    head.push(tagged(rule('-'), N));

    const text = asciiFold(rulesText(face.o));
    if (text) {
      for (const l of wrap(text, smallBody ? COLS_SM : COLS)) {
        body.push(smallBody ? tagged({ t: l, a: 'l', sm: true }, S) : tagged({ t: l, a: 'l' }, N));
      }
    }

    if (face.p !== undefined && face.u !== undefined) {
      if (!smallType) foot.push(tagged(blank(), N));
      foot.push(tagged({ t: asciiFold(face.p + '/' + face.u), b: true, dw: true, dh: true, a: 'r' }, N));
    }
    return { head, body, foot };
  }

  function faceLines(face, mv) {
    const p = faceParts(face, mv, 0, false);
    return p.head.concat(p.body, p.foot);
  }

  /** Paper a laid-out line uses, in dots (fixed-length model). */
  function lineDots(l) {
    if (l.feed !== undefined) return l.feed;
    if (l.dh) return PITCH.big;
    return l.sm ? PITCH.small : PITCH.normal;
  }
  const dotsOf = lines => lines.reduce((sum, l) => sum + lineDots(l), 0);

  /** One face laid out to exactly `budget` dots: the largest text that fits, then blank paper before the power/toughness. */
  function fixedFace(face, mv, budget) {
    let parts, h, tier = 0;
    for (; tier <= 2; tier++) {
      parts = faceParts(face, mv, tier, true);
      h = dotsOf(parts.head) + dotsOf(parts.body) + dotsOf(parts.foot);
      if (h <= budget) break;
    }
    const overflow = h > budget;      // even the smallest layout is too long: keep it whole, print longer
    if (tier > 2) tier = 2;
    const pad = Math.max(0, budget - h);
    const lines = parts.head.concat(parts.body, pad ? [{ t: '', feed: pad }] : [], parts.foot);
    return { lines, tier, overflow };
  }

  /** card: {n, f:[face,...]}; mv: mana value to show (the chosen X).
   *  opts.fixedDots: make the receipt this many dots long (per face for two-faced cards).
   *  Returns {lines, tier (0 normal, 1 small rules text, 2 smallest), overflow, dots}. */
  function layoutCard(card, mv, opts) {
    const total = opts && opts.fixedDots ? opts.fixedDots : 0;
    const fixed = total > 0;
    const tag = l => (fixed ? Object.assign({ sp: PITCH.normal }, l) : l);
    const k = card.f.length;
    const overhead = 2 * PITCH.normal + (k - 1) * 3 * PITCH.normal;   // outer rules, and the separator between faces
    const budget = fixed ? Math.floor((total * k - overhead) / k) : 0;

    const lines = [tag(rule('='))];
    let tier = 0, overflow = false;
    card.f.forEach((face, i) => {
      if (i > 0) lines.push(tag(blank()), tag({ t: '- - - - - - // - - - - - -', a: 'c' }), tag(blank()));
      const faceMv = i === 0 ? mv : null;
      if (fixed) {
        const r = fixedFace(face, faceMv, budget);
        lines.push(...r.lines);
        tier = Math.max(tier, r.tier);
        overflow = overflow || r.overflow;
      } else {
        lines.push(...faceLines(face, faceMv));
      }
    });
    lines.push(tag(rule('=')));
    return { lines, tier, overflow, dots: dotsOf(lines) };
  }

  function cardToLines(card, mv, opts) {
    return layoutCard(card, mv, opts).lines;
  }

  /** How many cards fit at normal size, need small text, or stay longer than standard, at a given length. */
  function analyze(cards, totalDots) {
    const r = { cards: 0, normal: 0, small: 0, over: 0 };
    for (const c of cards) {
      const res = layoutCard(c, 0, { fixedDots: totalDots });
      r.cards++;
      if (res.overflow) r.over++; else if (res.tier > 0) r.small++; else r.normal++;
    }
    return r;
  }

  /** A natural-size height of one face, in dots (what it needs at normal text, no padding). */
  function faceNaturalDots(face) {
    const p = faceParts(face, 0, 0, true);
    return dotsOf(p.head) + dotsOf(p.body) + dotsOf(p.foot);
  }

  /** The standard length (in rows) that lets about 90% of single-faced cards print at normal size. */
  function autoRows(cards) {
    const sizes = [];
    for (const c of cards) if (c.f.length === 1) sizes.push(faceNaturalDots(c.f[0]));
    if (!sizes.length) return 18;
    sizes.sort((a, b) => a - b);
    const p90 = sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.9))];
    const rows = Math.ceil((p90 + 2 * PITCH.normal) / PITCH.normal);   // + the two outer rules
    return Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows));
  }

  // ---------- outputs ----------

  function toText(lines) {
    const rows = [];
    for (const l of lines) {
      if (l.feed !== undefined) {                 // blank paper: one empty row per normal line of feed
        for (let i = 0; i < Math.round(l.feed / PITCH.normal); i++) rows.push('');
        continue;
      }
      const cols = l.sm ? COLS_SM : COLS;
      const used = l.t.length * (l.dw ? 2 : 1);   // double-width characters take two columns
      const pad = l.a === 'c' ? Math.floor((cols - used) / 2) : l.a === 'r' ? cols - used : 0;
      rows.push(' '.repeat(Math.max(0, pad)) + l.t);
    }
    return rows.join('\n');
  }

  /** ESC/POS bytes. opts.feed = blank lines after the receipt (default 4); opts.cut = send a cut command. */
  function toEscPos(lines, opts) {
    const o = Object.assign({ feed: 4, cut: false }, opts);
    const out = [0x1b, 0x40];                      // ESC @  initialize
    let align = 'l', bold = false, size = 0, font = 0, spacing = null;
    const ALIGN = { l: 0, c: 1, r: 2 };
    for (const line of lines) {
      if (line.feed !== undefined) {                                                                    // blank paper, no text
        for (let left = line.feed; left > 0; left -= 255) out.push(0x1b, 0x4a, Math.min(left, 255));  // ESC J n
        continue;
      }
      if ((line.a || 'l') !== align) { align = line.a || 'l'; out.push(0x1b, 0x61, ALIGN[align]); }   // ESC a n
      if (!!line.b !== bold) { bold = !!line.b; out.push(0x1b, 0x45, bold ? 1 : 0); }                  // ESC E n
      const sz = (line.dw ? 0x10 : 0) | (line.dh ? 0x01 : 0);
      if (sz !== size) { size = sz; out.push(0x1d, 0x21, size); }                                       // GS ! n
      const wantFont = line.sm ? 1 : 0;
      if (wantFont !== font) { font = wantFont; out.push(0x1b, 0x4d, font); }                          // ESC M n  font A/B
      if (line.sp !== undefined && line.sp !== spacing) { spacing = line.sp; out.push(0x1b, 0x33, spacing); }  // ESC 3 n  line spacing
      for (const ch of line.t) { const c = ch.charCodeAt(0); out.push(c < 128 ? c : 0x3f); }
      out.push(0x0a);                                                                                   // LF
    }
    out.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0);                                            // reset styles
    if (font) out.push(0x1b, 0x4d, 0);                                                                  // back to font A
    if (spacing !== null) out.push(0x1b, 0x32);                                                         // ESC 2  default line spacing
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
      { t: 'Small font, 42 columns:', a: 'l' },
      { t: '123456789012345678901234567890123456789012', a: 'l', sm: true, sp: PITCH.small },
      { t: 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKL', a: 'l', sm: true, sp: PITCH.small },
      Object.assign(rule('='), { sp: PITCH.normal }),
    ];
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  }

  return {
    COLS, COLS_SM, PITCH, MIN_ROWS, MAX_ROWS,
    asciiFold, unmappedChars, manaCost, rulesText, wrap, cardToLines, layoutCard, analyze, autoRows, faceNaturalDots, linesDots: dotsOf,
    testPage, toText, toEscPos, toBase64,
  };
});
