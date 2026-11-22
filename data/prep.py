#!/usr/bin/env python3
"""Build docs/creatures.json for the Momir app from Scryfall's "Oracle Cards" bulk file.

Usage:
    python3 data/prep.py                       # download the latest bulk file, then build
    python3 data/prep.py oracle-cards.json     # build from a file you already downloaded
    python3 data/prep.py --include-unsets ...  # keep silver/gold-bordered and other joke cards

Output (default docs/creatures.json):
    {"version": 1, "generated": "...", "count": N,
     "byMv": {"0": [{"n": "Name", "f": [face, ...]}, ...], ..., "16": [...]}}
where each face is {"n", "c" (mana cost), "t" (type line), "o" (oracle text), "p", "u" (power, toughness)}
with empty fields omitted.
"""
import argparse
import json
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.scryfall.com"
# Scryfall asks every client to send a descriptive User-Agent and an Accept header.
HEADERS = {"User-Agent": "MomirMachine/1.0 (personal hobby project)", "Accept": "application/json;q=0.9,*/*;q=0.8"}

MAX_MV = 16
EXCLUDED_LAYOUTS = {
    "token", "double_faced_token", "emblem", "art_series",
    "vanguard", "scheme", "planar", "augment", "host",
}
JOKE_SET_TYPES = {"funny", "memorabilia", "token"}
JOKE_BORDERS = {"silver", "gold"}


def faces_of(card):
    """The card's faces; single-faced cards count as one face."""
    return card.get("card_faces") or [card]


def is_joke_only(card):
    """True for un-cards and similar: joke/collector printing AND not legal in any format."""
    jokey = card.get("set_type") in JOKE_SET_TYPES or card.get("border_color") in JOKE_BORDERS
    legal_anywhere = any(v != "not_legal" for v in (card.get("legalities") or {}).values())
    return jokey and not legal_anywhere


def keep(card, include_unsets=False):
    if card.get("layout") in EXCLUDED_LAYOUTS:
        return False
    if "paper" not in (card.get("games") or ["paper"]):
        return False  # Arena/MTGO-only cards (Alchemy etc.)
    # Momir copies a creature card; whether it is a creature is decided by the front face.
    front = faces_of(card)[0]
    if "Creature" not in (front.get("type_line") or card.get("type_line") or ""):
        return False
    if not include_unsets and is_joke_only(card):
        return False
    mv = card.get("cmc")
    if mv is None or mv != int(mv) or not 0 <= int(mv) <= MAX_MV:
        return False
    return True


def compact_face(face):
    out = {
        "n": face.get("name", ""),
        "c": face.get("mana_cost", ""),
        "t": face.get("type_line", ""),
        "o": face.get("oracle_text", ""),
        "p": face.get("power", ""),
        "u": face.get("toughness", ""),
    }
    return {k: v for k, v in out.items() if v not in ("", None)}


def build(cards, include_unsets=False):
    by_mv = {str(i): [] for i in range(MAX_MV + 1)}
    seen = set()
    for card in cards:
        if not keep(card, include_unsets):
            continue
        faces = faces_of(card)
        name = card["name"]
        if card.get("layout") == "adventure":
            faces = faces[:1]  # the creature half is what Momir copies...
            name = faces[0].get("name", name)  # ...so name it after that half, not "Creature // Adventure"
        entry = {"n": name, "f": [compact_face(f) for f in faces]}
        key = card.get("oracle_id") or card["name"]
        if key in seen:
            continue
        seen.add(key)
        by_mv[str(int(card["cmc"]))].append(entry)
    for lst in by_mv.values():
        lst.sort(key=lambda e: e["n"])
    return {
        "version": 1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "count": sum(len(v) for v in by_mv.values()),
        "byMv": by_mv,
    }


def fetch(url, dest=None):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as resp:
        if dest is None:
            return json.load(resp)
        with open(dest, "wb") as fh:
            while chunk := resp.read(1 << 20):
                fh.write(chunk)


def download_oracle_cards(dest):
    meta = fetch(f"{API}/bulk-data/oracle-cards")
    print(f"Downloading {meta['download_uri']} (~{meta.get('size', 0) // 1_000_000} MB)...", file=sys.stderr)
    fetch(meta["download_uri"], dest)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="Oracle Cards JSON file (downloaded if omitted)")
    ap.add_argument("-o", "--output", default=str(Path(__file__).resolve().parent.parent / "docs" / "creatures.json"))
    ap.add_argument("--include-unsets", action="store_true", help="keep joke / silver-border cards")
    args = ap.parse_args(argv)

    if args.input:
        src = Path(args.input)
    else:
        src = Path(tempfile.mkdtemp()) / "oracle-cards.json"
        try:
            download_oracle_cards(src)
        except Exception as exc:  # network blocked, offline, etc.
            sys.exit(f"Download failed ({exc}).\nDownload 'Oracle Cards' from https://scryfall.com/docs/api/bulk-data "
                     "and run: python3 data/prep.py <that file>")

    with open(src, encoding="utf-8") as fh:
        cards = json.load(fh)
    data = build(cards, args.include_unsets)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {out} ({out.stat().st_size / 1e6:.2f} MB, {data['count']} creatures)", file=sys.stderr)
    for mv, lst in data["byMv"].items():
        print(f"  MV {mv:>2}: {len(lst)}", file=sys.stderr)
    empty = [mv for mv, lst in data["byMv"].items() if not lst]
    if empty:
        print(f"WARNING: no creatures at MV {', '.join(empty)}", file=sys.stderr)


if __name__ == "__main__":
    main()
