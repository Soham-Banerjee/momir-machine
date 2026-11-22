"""Run with: python3 -m unittest discover -s tests -v"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))
import prep  # noqa: E402

FIXTURE = ROOT / "data" / "fixture-oracle.json"


def names(data, mv):
    return [e["n"] for e in data["byMv"][str(mv)]]


class PrepTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.data = prep.build(cls.cards)

    def test_buckets_cover_zero_to_sixteen(self):
        self.assertEqual(list(self.data["byMv"]), [str(i) for i in range(17)])

    def test_keeps_real_creatures_at_the_right_mana_value(self):
        self.assertIn("Ornithopter", names(self.data, 0))
        self.assertIn("Llanowar Elves", names(self.data, 1))
        self.assertIn("Grizzly Bears", names(self.data, 2))
        self.assertIn("Serra Angel", names(self.data, 5))
        self.assertIn("Emrakul, the Aeons Torn", names(self.data, 15))

    def test_excludes_non_creatures_tokens_digital_jokes_and_out_of_range(self):
        everything = [n for mv in self.data["byMv"] for n in names(self.data, mv)]
        for bad in ("Goblin Token", "Arena Only Golem", "Silver Border Blob", "Lightning Bolt", "Sol Ring Walker"):
            self.assertNotIn(bad, everything)

    def test_include_unsets_keeps_joke_cards(self):
        with_jokes = prep.build(self.cards, include_unsets=True)
        self.assertIn("Silver Border Blob", names(with_jokes, 3))

    def test_double_faced_cards_keep_both_faces_at_front_face_mv(self):
        delver = next(e for e in self.data["byMv"]["1"] if e["n"].startswith("Delver"))
        self.assertEqual([f["n"] for f in delver["f"]], ["Delver of Secrets", "Insectile Aberration"])
        self.assertEqual(delver["f"][1]["p"], "3")

    def test_adventure_cards_keep_only_the_creature(self):
        giant = next(e for e in self.data["byMv"]["3"] if e["n"].startswith("Bonecrusher"))
        self.assertEqual(giant["n"], "Bonecrusher Giant")
        self.assertEqual(len(giant["f"]), 1)
        self.assertEqual(giant["f"][0]["n"], "Bonecrusher Giant")

    def test_empty_fields_are_omitted_and_stats_kept_as_text(self):
        bears = next(e for e in self.data["byMv"]["2"] if e["n"] == "Grizzly Bears")
        self.assertNotIn("o", bears["f"][0])
        star = next(e for e in self.data["byMv"]["2"] if e["n"] == "Dungeon Hybrid Test")
        self.assertEqual((star["f"][0]["p"], star["f"][0]["u"]), ("*", "1+*"))

    def test_duplicates_by_oracle_id_are_dropped(self):
        dup = prep.build(self.cards + [dict(self.cards[1])])
        self.assertEqual(dup["count"], self.data["count"])

    def test_count_matches_buckets(self):
        self.assertEqual(self.data["count"], sum(len(v) for v in self.data["byMv"].values()))

    def test_cli_writes_valid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "creatures.json"
            prep.main([str(FIXTURE), "-o", str(out)])
            loaded = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(loaded["count"], self.data["count"])


if __name__ == "__main__":
    unittest.main()
