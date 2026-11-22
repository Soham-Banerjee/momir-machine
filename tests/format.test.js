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
