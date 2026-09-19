"""How many DIFFERENT wrong answers a key gave inside a window, held in this process.

One process is the whole server (Dockerfile: one uvicorn worker; railway.json: one replica), so a
count in memory is the count. A restart forgets it, which costs an attacker a restart they cannot
cause. If a second worker or replica is ever added this becomes per process and the limit
multiplies by the process count: move it to Postgres then.

Two rules, both FOUND IN REVIEW (2026-09-19):
  * The same wrong answer again counts once. The phone's camera rescans a stale pairing QR every
    1.5 s, and counting each scan locked the account out in fifteen seconds, before the fresh code.
  * A try is taken under the lock BEFORE the lookup it guards (`attempt`) and given back if it was
    right (`forgive`). Checked before and counted after, forty wrong codes sent at once all got past
    a limit of ten.
"""

import threading
import time
from collections import deque
from collections.abc import Callable, Hashable

#: Keys with nothing in the window are dropped once there are this many, so the map stays bounded.
_SWEEP_AT = 10_000


class Misses:
    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._lock = threading.Lock()
        self._seen: dict[str, deque[tuple[float, Hashable]]] = {}

    def _fresh(self, key: str) -> deque[tuple[float, Hashable]]:
        q = self._seen.setdefault(key, deque())
        cutoff = self._clock() - self.window_s
        while q and q[0][0] <= cutoff:
            q.popleft()
        return q

    def _sweep(self) -> None:
        cutoff = self._clock() - self.window_s
        for k in [k for k, q in self._seen.items() if not q or q[-1][0] <= cutoff]:
            del self._seen[k]

    def attempt(self, key: str, answer: Hashable) -> bool:
        """Take a try for `answer`, or False when the key has used its tries. An answer already
        tried in the window costs nothing and is always let through (it will be wrong again)."""
        with self._lock:
            if len(self._seen) > _SWEEP_AT:
                self._sweep()
            q = self._fresh(key)
            if any(a == answer for _, a in q):
                return True
            if len({a for _, a in q}) >= self.limit:
                return False
            q.append((self._clock(), answer))
            return True

    def forgive(self, key: str, answer: Hashable) -> None:
        """The answer was right: it was not a miss."""
        with self._lock:
            q = self._seen.get(key)
            if q:
                kept = deque(e for e in q if e[1] != answer)
                if kept:
                    self._seen[key] = kept
                else:
                    del self._seen[key]
