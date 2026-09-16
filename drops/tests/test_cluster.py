"""The clustering, over the real corpus.

`drops/tests/corpus/` holds fifteen public links resolved and planned for real
(`scripts/drops_corpus.py`): four pasta posts, five editor tip posts, one about Claude skills,
one about shipping a SaaS, and one about dogs. The partition those should produce is obvious to
a person, which is exactly what makes them a test.
"""

from __future__ import annotations

import unittest

from drops import cluster as dc
from drops.tests import corpus_read


class ClusterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.drops = corpus_read.drops()
        if len(self.drops) < 8:
            self.skipTest("the corpus has not been built: python3 scripts/drops_corpus.py")

    def test_the_pasta_posts_end_up_together(self):
        board = dc.board(self.drops)
        where = {}
        for ci, c in enumerate(board):
            for i in c["members"]:
                where[i] = ci
        pasta = [i for i, d in enumerate(self.drops) if "pasta" in (d["title"] or "").lower()]
        self.assertGreaterEqual(len(pasta), 3, "the corpus should hold several pasta posts")
        self.assertEqual(
            len({where[i] for i in pasta}), 1,
            f"the pasta posts landed in {len({where[i] for i in pasta})} clusters",
        )

    def test_a_cluster_is_never_named_a_weak_word(self):
        """`code` is true of every drop on a builder's board, so it names none of them."""
        for c in dc.board(self.drops):
            self.assertNotIn(c["label"], dc.WEAK, f"cluster named {c['label']!r}")

    def test_every_drop_is_in_exactly_one_cluster(self):
        board = dc.board(self.drops)
        members = [i for c in board for i in c["members"]]
        self.assertEqual(sorted(members), list(range(len(self.drops))))

    def test_the_floor_is_in_the_middle_of_a_plateau(self):
        """The constant is a measurement, not a preference.

        A floor is only meaningful if the partition is stable around it. This sweeps the range
        and asserts the chosen value sits inside a run of at least five steps that all produce
        the same partition, so a small change in the corpus cannot flip the board.
        """
        def partition(floor: float) -> tuple:
            return tuple(tuple(c["members"]) for c in dc.board(self.drops, floor=floor))

        here = partition(dc.MERGE_FLOOR)
        steps = [round(0.02 * i, 2) for i in range(1, 26)]
        same = [f for f in steps if partition(f) == here]
        self.assertGreaterEqual(
            len(same), 5,
            f"the partition at {dc.MERGE_FLOOR} holds over only {same}; the floor is fitted to noise",
        )
        self.assertGreater(dc.MERGE_FLOOR, min(same) - 0.021)
        self.assertLess(dc.MERGE_FLOOR, max(same) + 0.021)

    def test_the_dog_post_joins_nothing(self):
        """The control. A post with no builder content and no food in it should be alone."""
        board = dc.board(self.drops)
        idx = [i for i, d in enumerate(self.drops) if d["kind"] == "unknown"]
        for i in idx:
            size = next(c["size"] for c in board if i in c["members"])
            self.assertEqual(size, 1, f"{self.drops[i]['title']!r} joined a cluster of {size}")

    def test_order_is_deterministic(self):
        self.assertEqual(dc.board(self.drops), dc.board(list(self.drops)))


if __name__ == "__main__":
    unittest.main()
