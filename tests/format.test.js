// Run with: node --test tests/format.test.js
// The end-to-end test reads CREATURES_JSON (default docs/creatures.json) and skips if it is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../docs/format.js');

test('asciiFold turns typographic and accented characters into plain ASCII', () => {
  assert.equal(F.asciiFold('Æther Adept'), 'AEther Adept');
  assert.equal(F.asciiFold('it’s a “test” — ok…'), 'it\'s a "test" - ok...');
  assert.equal(F.asciiFold('Jötun Grunt, Lim-Dûl'), 'Jotun Grunt, Lim-Dul');
  assert.equal(F.asciiFold('protect­ion'), 'protection');
  assert.equal(F.asciiFold('line1\nline2'), 'line1\nline2');
  assert.ok([...F.asciiFold('日本')].every(c => c.charCodeAt(0) < 128));
});

test('mana symbols', () => {
  assert.equal(F.manaCost('{2}{W}{W}'), '2WW');
  assert.equal(F.manaCost('{W/U}{W/P}{X}'), '(W/U)(W/P)X');
  assert.equal(F.manaCost(''), '');
  assert.equal(F.rulesText('{T}: Add {G}. Pay {2}{R}{R}.'), '[T]: Add [G]. Pay [2RR].');
  assert.equal(F.rulesText(undefined), '');
});

test('wrap respects width, paragraphs and long words', () => {
  const out = F.wrap('one two three four five six seven', 10);
  assert.ok(out.every(l => l.length <= 10), JSON.stringify(out));
  assert.equal(out.join(' '), 'one two three four five six seven');
  assert.deepEqual(F.wrap('a\nb', 10), ['a', 'b']);
  const long = F.wrap('x'.repeat(25), 10);
  assert.deepEqual(long.map(l => l.length), [10, 10, 5]);
});

test('toEscPos emits the expected bytes', () => {
  const bytes = F.toEscPos([{ t: 'Hi', a: 'l' }]);
  assert.deepEqual([...bytes], [
    0x1b, 0x40,                         // init
    0x48, 0x69, 0x0a,                   // "Hi" LF
    0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0,  // reset bold/size/align
    0x1b, 0x64, 4,                      // feed 4
  ]);

  const styled = [...F.toEscPos([{ t: 'A', b: true, dw: true, dh: true, a: 'r' }], { feed: 0, cut: true })];
  assert.deepEqual(styled.slice(0, 10), [0x1b, 0x40, 0x1b, 0x61, 2, 0x1b, 0x45, 1, 0x1d, 0x21]);
  assert.equal(styled[10], 0x11);       // double width + double height
  assert.deepEqual(styled.slice(-4), [0x1d, 0x56, 0x42, 0x00]);  // cut at the end
});

test('a face without a mana cost does not print a blank cost line', () => {
  const lines = F.cardToLines({ n: 'X', f: [{ n: 'A', c: '{U}', t: 'Creature', p: '1', u: '1' }, { n: 'B', t: 'Creature', p: '2', u: '2' }] }, 1);
  assert.ok(lines.every(l => l.t === '' || l.t.trim() !== ''), 'found a whitespace-only line');
});

test('toBase64 round trips', () => {
  const bytes = F.toEscPos(F.testPage());
  assert.deepEqual([...Buffer.from(F.toBase64(bytes), 'base64')], [...bytes]);
});

test('every card in the generated data fits the paper and prints cleanly', (t) => {
  const file = process.env.CREATURES_JSON || path.join(__dirname, '..', 'docs', 'creatures.json');
  if (!fs.existsSync(file)) return t.skip('no creatures.json to test against: ' + file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let cards = 0;
  for (const [mv, list] of Object.entries(data.byMv)) {
    for (const card of list) {
      cards++;
      const lines = F.cardToLines(card, Number(mv));
      for (const l of lines) {
        const max = l.dw ? F.COLS / 2 : F.COLS;
        assert.ok(l.t.length <= max, `${card.n}: line too wide (${l.t.length}>${max}): "${l.t}"`);
        assert.ok(!l.t.includes('?'), `${card.n}: unprintable character in "${l.t}"`);
      }
      const bytes = F.toEscPos(lines);
      assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
      // Control bytes are all ESC/POS commands we emit; everything else must be printable ASCII or LF.
      assert.ok(bytes.every(b => b < 128), `${card.n}: non-ASCII byte`);
    }
  }
  assert.ok(cards > 0);
  console.log(`checked ${cards} cards`);
});

// ---------- fixed receipt length ----------

const ROWS = 18;
const TOTAL = ROWS * F.PITCH.normal;
const wordyText = n => Array.from({ length: n }, (_, i) =>
  `Whenever another creature enters the battlefield under your control, you may pay {1}{W}. If you do, draw a card (${i}).`).join('\n');
const mkCard = (text, faces = 1) => ({
  n: 'T',
  f: Array.from({ length: faces }, (_, i) => ({ n: 'Test ' + i, c: '{3}{W}{W}', t: 'Legendary Creature - Angel', o: text, p: '4', u: '4' })),
});
const words = s => s.split(/\s+/).filter(Boolean);
const hasSeq = (bytes, seq) => [...bytes].some((_, i) => seq.every((b, j) => bytes[i + j] === b));

test('variable-length mode never uses the fixed-length features', () => {
  const lines = F.cardToLines(mkCard(wordyText(3)), 5);
  assert.ok(lines.every(l => l.sp === undefined && !l.sm && l.feed === undefined));
  const bytes = F.toEscPos(lines);
  for (const seq of [[0x1b, 0x4d], [0x1b, 0x33], [0x1b, 0x4a], [0x1b, 0x32]]) assert.ok(!hasSeq(bytes, seq), 'unexpected command ' + seq);
});

test('toEscPos emits small-font, line-spacing and exact-feed commands', () => {
  const bytes = F.toEscPos([{ t: 'a', sm: true, sp: 20 }, { t: '', feed: 300 }, { t: 'b', sp: 30 }]);
  assert.deepEqual([...bytes], [
    0x1b, 0x40,
    0x1b, 0x4d, 1, 0x1b, 0x33, 20, 0x61, 0x0a,          // small font, spacing 20, "a"
    0x1b, 0x4a, 255, 0x1b, 0x4a, 45,                      // 300 dots of blank paper, in two feeds
    0x1b, 0x4d, 0, 0x1b, 0x33, 30, 0x62, 0x0a,          // back to normal font, spacing 30, "b"
    0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0,          // reset styles
    0x1b, 0x32,                                           // back to the printer's default line spacing
    0x1b, 0x64, 4,
  ]);
});

test('fixed length: every card comes out exactly the standard length', () => {
  const cases = [
    mkCard(''), mkCard('Flying'), mkCard(wordyText(1)), mkCard(wordyText(3)), mkCard(wordyText(4)),
    mkCard('Flying', 2), mkCard(wordyText(3), 2),
  ];
  for (const card of cases) {
    const r = F.layoutCard(card, 5, { fixedDots: TOTAL });
    assert.equal(F.linesDots(r.lines), r.dots);
    if (!r.overflow) assert.equal(r.dots, TOTAL * card.f.length, `${card.f[0].o.length} chars, ${card.f.length} face(s)`);
  }
});

test('fixed length: normal text when it fits, small text when it does not, flagged only when nothing fits', () => {
  const tier = card => F.layoutCard(card, 5, { fixedDots: TOTAL });
  assert.equal(tier(mkCard('')).tier, 0);
  assert.equal(tier(mkCard('Flying')).tier, 0);
  const wordy = tier(mkCard(wordyText(3)));
  assert.equal(wordy.tier, 1);
  assert.ok(!wordy.overflow);
  assert.ok(wordy.lines.some(l => l.sm), 'rules text should be in the small font');
  const absurd = tier(mkCard(wordyText(12)));
  assert.equal(absurd.tier, 2);
  assert.ok(absurd.overflow);
});

test('fixed length never drops or cuts any rules text', () => {
  for (const n of [0, 1, 3, 6, 12]) {
    const card = mkCard(wordyText(n), 2);
    const lines = F.cardToLines(card, 5, { fixedDots: TOTAL });
    const printed = words(lines.map(l => l.t).join(' ')).join(' ');
    for (const face of card.f) {
      const expected = words(F.asciiFold(F.rulesText(face.o))).join(' ');
      assert.ok(printed.includes(expected), `text lost with ${n} paragraphs`);
    }
  }
});

test('fixed length: every line fits its font width', () => {
  for (const n of [0, 2, 3, 6]) {
    for (const l of F.cardToLines(mkCard(wordyText(n)), 5, { fixedDots: TOTAL })) {
      const max = l.sm ? F.COLS_SM : l.dw ? F.COLS / 2 : F.COLS;
      assert.ok(l.t.length <= max, `line too wide (${l.t.length}>${max}): "${l.t}"`);
    }
  }
});

test('automatic standard length lets about 90% of cards print at normal size', () => {
  const cards = [...Array.from({ length: 95 }, () => mkCard('Flying')), ...Array.from({ length: 5 }, () => mkCard(wordyText(6)))];
  const rows = F.autoRows(cards);
  assert.ok(rows >= F.MIN_ROWS && rows <= F.MAX_ROWS);
  const r = F.analyze(cards, rows * F.PITCH.normal);
  assert.equal(r.cards, 100);
  assert.ok(r.normal >= 90, `only ${r.normal} fit at normal size at ${rows} rows`);
});

test('every card in the generated data lays out cleanly in fixed length', (t) => {
  const file = process.env.CREATURES_JSON || path.join(__dirname, '..', 'docs', 'creatures.json');
  if (!fs.existsSync(file)) return t.skip('no creatures.json to test against: ' + file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = Object.values(data.byMv).flat();
  const rows = F.autoRows(all);
  const total = rows * F.PITCH.normal;
  const seen = { normal: 0, small: 0, over: 0 };
  for (const [mv, list] of Object.entries(data.byMv)) {
    for (const card of list) {
      const r = F.layoutCard(card, Number(mv), { fixedDots: total });
      for (const l of r.lines) {
        const max = l.sm ? F.COLS_SM : l.dw ? F.COLS / 2 : F.COLS;
        assert.ok(l.t.length <= max, `${card.n}: line too wide: "${l.t}"`);
        assert.ok(!l.t.includes('?'), `${card.n}: unprintable character in "${l.t}"`);
      }
      if (!r.overflow) assert.equal(r.dots, total * card.f.length, `${card.n}: not the standard length`);
      seen[r.overflow ? 'over' : r.tier ? 'small' : 'normal']++;
      assert.deepEqual([...F.toEscPos(r.lines).slice(0, 2)], [0x1b, 0x40]);
    }
  }
  console.log(`fixed length at ${rows} rows: ${seen.normal} normal, ${seen.small} small text, ${seen.over} longer than standard`);
});
