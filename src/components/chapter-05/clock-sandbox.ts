// §5 — The clock (second-chance) algorithm. Self-contained Python: a ClockPool
// with a circular frame list, a usage value per frame, a sweeping hand, and a
// clock-based evict(). The `cap` parameter generalizes the single REFERENCE BIT
// (cap=1, the textbook second-chance algorithm) into the USAGE COUNTER that
// PostgreSQL's clock-sweep actually uses (cap>1). We run a scan-heavy workload
// through naive LRU, the 1-bit clock, and the usage-counter clock, and print
// that:
//   - the 1-bit clock matches naive LRU's hit rate, but at O(1) per access;
//   - the usage-counter clock holds the hit rate up *better* than naive LRU,
//     because a frequently-touched page builds a high count and survives the
//     sweep, while a one-shot scan page dies on the next pass.
//
// Runs clean under python3 / Pyodide. Exported as a string so the MDX
// integrator can seed it into <PythonSandbox>.

export const CLOCK_SANDBOX = `# The clock (second-chance) page-replacement algorithm.
# Frames sit in a circle; each carries a "usage" value. A hand sweeps:
#   - if usage > 0, decrement it and advance (a second chance), and
#   - if usage == 0, that frame is the victim.
# With cap=1 the usage value is a single reference bit -> the textbook clock.
# With cap>1 it's a usage COUNTER -> exactly what PostgreSQL's clock-sweep does
# (a generalization of the single bit), so a hot page survives several sweeps.

class ClockPool:
    def __init__(self, size, cap=1):
        self.size = size
        self.cap = cap               # max usage value (1 = single reference bit)
        self.pages = [None] * size   # page number in each frame, or None
        self.usage = [0] * size      # reference bit / usage counter per frame
        self.table = {}              # page_no -> frame index
        self.hand = 0
        self.hits = 0
        self.misses = 0

    def _evict_victim(self):
        # Sweep: decrement set frames (their second chance), stop at the first 0.
        while self.usage[self.hand] > 0:
            self.usage[self.hand] -= 1
            self.hand = (self.hand + 1) % self.size
        victim = self.hand
        self.hand = (self.hand + 1) % self.size  # leave the hand past the victim
        return victim

    def get(self, page_no):
        frame = self.table.get(page_no)
        if frame is not None:            # HIT — bump usage (re-set the bit)
            self.hits += 1
            self.usage[frame] = min(self.usage[frame] + 1, self.cap)
            return frame
        self.misses += 1                 # MISS — find a frame to use
        if None in self.pages:
            frame = self.pages.index(None)
        else:
            frame = self._evict_victim()
            del self.table[self.pages[frame]]
        self.pages[frame] = page_no
        self.table[page_no] = frame
        self.usage[frame] = 1
        return frame

    def hit_rate(self):
        total = self.hits + self.misses
        return self.hits / total if total else 0.0


class LRUPool:
    """Naive LRU for comparison: evict the least-recently-used frame."""
    def __init__(self, size):
        self.size = size
        self.order = []   # page numbers, most-recent at the end
        self.table = set()
        self.hits = 0
        self.misses = 0

    def get(self, page_no):
        if page_no in self.table:        # HIT — move to most-recent
            self.hits += 1
            self.order.remove(page_no)
            self.order.append(page_no)
            return
        self.misses += 1                 # MISS
        if len(self.order) >= self.size:
            victim = self.order.pop(0)   # least-recently-used
            self.table.discard(victim)
        self.order.append(page_no)
        self.table.add(page_no)

    def hit_rate(self):
        total = self.hits + self.misses
        return self.hits / total if total else 0.0


POOL_SIZE = 6
HOT = [1, 2, 3, 4]   # a genuinely hot working set (think: the B-tree's upper levels)

# Workload: the hot set gets hammered, then a short BURST of one-shot scan pages
# streams through uninterrupted -- the OLTP-cache-meets-analytics-scan pattern.
# The burst is long enough to flush the hot set out from under naive LRU.
workload = []
scan_page = 100
for _ in range(40):
    for _ in range(3):           # the hot set is touched repeatedly...
        workload += HOT
    for _ in range(3):           # ...then a burst of fresh scan pages floods in
        workload.append(scan_page)
        scan_page += 1
workload += HOT                  # come back to the hot set: is it still resident?

lru = LRUPool(POOL_SIZE)
clock_bit = ClockPool(POOL_SIZE, cap=1)   # textbook clock: a single reference bit
clock_ctr = ClockPool(POOL_SIZE, cap=5)   # Postgres-style clock-sweep: a usage counter
for p in workload:
    lru.get(p)
    clock_bit.get(p)
    clock_ctr.get(p)

print(f"{len(workload)} accesses through a {POOL_SIZE}-frame pool")
print(f"hot set {HOT} hammered, then flushed by short scan bursts, then revisited")
print()
print(f"naive LRU            : {lru.hit_rate():6.1%}   ({lru.hits} hits / {lru.misses} misses)")
print(f"clock, 1-bit         : {clock_bit.hit_rate():6.1%}   ({clock_bit.hits} hits / {clock_bit.misses} misses)")
print(f"clock, usage counter : {clock_ctr.hit_rate():6.1%}   ({clock_ctr.hits} hits / {clock_ctr.misses} misses)")
print()
print("read it like this:")
print("  - the 1-bit clock MATCHES naive LRU's hit rate -- it is a cheap O(1)")
print("    approximation of LRU, not an improvement on it. One bit, no reordering.")
print("  - the usage-counter clock (what PostgreSQL runs over shared_buffers)")
print("    HOLDS UP BETTER: a hot page builds a high count and rides out the")
print("    sweep, while a one-shot scan page has count 1 and is evicted on the")
print("    next pass -- so the scan stops bulldozing the hot set.")
hot_survived = all(h in clock_ctr.table for h in HOT)
print()
print(f"hot set still resident under the usage-counter clock: {hot_survived}")
`;
