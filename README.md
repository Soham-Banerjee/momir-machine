# Momir Machine

Pick a mana value, get a random creature, print it on a 58mm thermal receipt printer.
An installable web page (PWA) that prints through the free **RawBT** app on Android.

```
data/prep.py        Scryfall "Oracle Cards" bulk file  ->  docs/creatures.json
docs/format.js      card -> receipt layout -> ESC/POS bytes (no DOM, reusable on a Pi/ESP32 later)
docs/app.js         the UI: mana value grid, game log, settings, output layer
docs/sw.js          service worker (offline after the first visit)
tools/make_icons.py draws the app icons
tests/              Python + Node tests
```

## Setup

### 1. Build the creature data
```
python3 data/prep.py
```
This downloads Scryfall's Oracle Cards file (a large temporary download) and writes `docs/creatures.json`
(a few MB). If the download is blocked, get "Oracle Cards" from <https://scryfall.com/docs/api/bulk-data>
and run `python3 data/prep.py path/to/oracle-cards.json`.

It prints how many cards each filter removed and how many creatures it kept per mana value. Joke cards (silver/gold border, un-sets), tokens,
art cards and Arena/MTGO-only cards are dropped; add `--include-unsets` to keep the joke cards.

Then run the checks against the real data:
```
python3 -m unittest discover -s tests
node --test tests/format.test.js
```
The Node test formats every creature and fails if any line would be wider than the paper or contains a
character the printer can't print.

### 2. Try it on your computer
```
cd docs && python3 -m http.server 8000
```
Open <http://localhost:8000>. Pick a mana value and check the receipt preview.
(Set "Send prints to" to "Nowhere" in Settings if you don't want it to try RawBT.)

### 3. Put it online (GitHub Pages)
Push this repo to GitHub, including `docs/creatures.json`. Then Settings -> Pages -> "Deploy from a branch",
branch `main`, folder `/docs`. After a minute the site is live at `https://<you>.github.io/<repo>/`.

### 4. On the phone
1. Install **RawBT** from the Play Store and pair your printer inside it. Make RawBT's own test print work first.
2. Open your site in Chrome, then menu -> **Install app** (or use the Install button in the page).
   Open it once with a signal so it can cache everything; after that it works offline.
3. Settings -> **Print test page**. If a receipt comes out, you're done.
4. Optional: turn on "Print automatically", so tapping a mana value prints straight away.

## Using it
- Tap a mana value (the small number is how many creatures exist at that value).
- "This game" lists everything generated; tap an entry to view it again. **New game** clears it.
- "No repeats within a game" (default on) skips creatures already generated at that mana value.
  When one value runs out it says so and repeats.
- **Print** reprints the card on screen.
- Settings -> **Hide the card on screen** is surprise mode. The card is still picked and still prints, but its name
  and text never show on screen, and the game list shows "Hidden card". Switch it off to see everything again.
- Settings -> **Show how many creatures exist at each mana value** controls the small numbers under the buttons.
- Settings -> **Fixed receipt length** makes every card print the same length. Off (the default) means each card is as
  long as its text needs. On: short cards get blank paper above the power/toughness, and long cards print their rules text in
  the printer's small font (then the type line too) to fit. "Standard length" is in rows (one row is about 3.75 mm); leave it
  empty for automatic, which lets about 90% of creatures print at normal size. A summary line shows how many creatures print at
  normal size, in small text, or are too long even then (those print longer rather than losing words). Two-faced cards get one
  standard length per face.
- **Print 3 sample cards** prints the shortest, a middle and the longest creature in the current mode, for checking lengths on paper.

## Testing with a real printer
1. Pair the printer inside RawBT and make RawBT's own test print work first.
2. Fixed length **off**. Settings -> **Print test page**. Check: the 32-digit line fits on one line; Left/Center/Right line up;
   the big 4/4 prints; and the **42-digit line under "Small font" fits on one line** and looks clearly smaller than the normal text.
   If those 42 digits wrap onto two lines, the printer's small font is narrower than assumed: stop here.
3. Still off: **Print 3 sample cards**. Measure each strip with a ruler, from the top of its first `====` line to the bottom of its
   last `====` line. They should be clearly different lengths.
4. Turn **Fixed receipt length** on (leave the length on automatic) and print the 3 samples again. Measure again. The three should
   match to within about 2 mm, the longest should be in small but readable text, and nothing should overlap or be cut.
5. If they don't match, note the three lengths in mm and send them over. The paper advance per line is a few numbers at the
   top of `docs/format.js` (`PITCH`), so this is a one-line fix.
6. Pick the length you like: each row is about 3.75 mm, and a smaller number saves paper but pushes more cards into small text.
7. Play a few real rounds with auto-print on, including a two-faced creature, and check every card comes out the same length.

## How printing works
`send()` in `docs/app.js` is the only place that knows about RawBT. It builds a `rawbt:base64,<data>`
link, which is the format RawBT's own documentation describes for raw ESC/POS data. I couldn't test this
against a real phone and printer, so the first test print is the real check. If nothing happens,
the likely causes are RawBT not being the app that handles the link, or the printer not being paired in RawBT.
To use a different route (USB from a laptop or Pi, Bluetooth from an ESP32) you only replace `send()`;
the card layout and ESC/POS bytes stay the same.

## Updating
- New cards: re-run `data/prep.py`, commit `docs/creatures.json`.
- After changing any file in `docs/`, bump `CACHE` in `docs/sw.js` (`momir-v1` -> `momir-v2`) so phones drop the old copy.
  Without a bump, updates still arrive, but one launch late.

## Notes
- The receipt is 32 characters wide (a 58mm printer prints 384 dots). Accented letters and fancy punctuation
  are converted to plain ASCII (so "Aether" prints as "AEther") because receipt printers default to a basic character set.
- Mana symbols print as text: `{2}{W}{W}` -> `2WW`, `{T}` -> `[T]`, hybrid `{W/U}` -> `(W/U)`.
- Adventure cards print only the creature half; double-faced cards print both faces.
- `data/fixture-oracle.json` is a tiny hand-written sample in Scryfall's format, used only by the tests.
