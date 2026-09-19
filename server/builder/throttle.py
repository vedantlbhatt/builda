"""How many times a key missed inside a window, held in this process.

One process is the whole server (Dockerfile: one uvicorn worker; railway.json: one replica), so a
count in memory is the count. A restart forgets it, which costs an attacker a restart they cannot
cause. If a second worker or replica is ever added this becomes per process and the limit
multiplies by the process count: move it to Postgres then.
"""

import threading
import time
from collections import deque
from collections.abc import Callable


class Misses:
    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window_s = window_s
        self._clock = clock
        self._lock = threading.Lock()
        self._seen: dict[str, deque[float]] = {}

    def _fresh(self, key: str) -> deque[float]:
        q = self._seen.setdefault(key, deque())
        cutoff = self._clock() - self.window_s
        while q and q[0] <= cutoff:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        with self._lock:
            q = self._fresh(key)
            if not q:
                self._seen.pop(key, None)
            return len(q) >= self.limit

    def miss(self, key: str) -> None:
        with self._lock:
            self._fresh(key).append(self._clock())
