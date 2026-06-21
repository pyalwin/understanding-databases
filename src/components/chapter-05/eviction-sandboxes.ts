// Chapter 05 — §3 (LRU eviction) and §4 (sequential-scan flooding).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own BufferPool — no cross-sandbox state is assumed.
//
// Both verified under python3 before shipping:
//   LRU_SANDBOX        -> 88% hit rate, 0 evictions (hot set fits the pool)
//   SCANTHRASH_SANDBOX -> hot-set hit rate collapses 100% -> 0% after the scan
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

export const LRU_SANDBOX = `# A buffer pool with an LRU eviction policy.
# Frames hold pages; a page_table maps page_no -> frame index.
# Recency is an explicit ordering: most-recently-used at the front.
# evict() drops the least-recently-used UNPINNED frame, writing it
# back to disk first if it is dirty.

POOL_SIZE = 4

class Frame:
    def __init__(self):
        self.page_no = None   # which page lives here (None = empty)
        self.pin_count = 0    # >0 means in use, cannot be evicted
        self.dirty = False    # modified since read in? must write back

class BufferPool:
    def __init__(self, size=POOL_SIZE):
        self.frames = [Frame() for _ in range(size)]
        self.page_table = {}        # page_no -> frame index
        self.recency = []           # frame indices, MRU (front) -> LRU (back)
        self.disk = {}              # page_no -> contents on disk
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.writebacks = 0

    def _touch(self, fi):
        # Mark frame fi as most-recently-used.
        if fi in self.recency:
            self.recency.remove(fi)
        self.recency.insert(0, fi)

    def _free_frame(self):
        for i, f in enumerate(self.frames):
            if f.page_no is None:
                return i
        return None

    def _evict(self):
        # Walk recency back-to-front (LRU first) for an unpinned frame.
        for fi in reversed(self.recency):
            if self.frames[fi].pin_count == 0:
                victim = self.frames[fi]
                if victim.dirty:                       # write-back cost
                    self.disk[victim.page_no] = "page-%s" % victim.page_no
                    self.writebacks += 1
                    victim.dirty = False
                self.page_table.pop(victim.page_no, None)
                self.recency.remove(fi)
                victim.page_no = None
                self.evictions += 1
                return fi
        raise RuntimeError("all frames pinned: cannot evict")

    def get(self, page_no):
        if page_no in self.page_table:        # HIT
            self.hits += 1
            fi = self.page_table[page_no]
            self._touch(fi)
            return fi
        # MISS: find a frame (free, else evict the LRU), read page in.
        self.misses += 1
        fi = self._free_frame()
        if fi is None:
            fi = self._evict()
        self.frames[fi].page_no = page_no
        self.frames[fi].dirty = False
        self.page_table[page_no] = fi
        self._touch(fi)
        return fi

    def hit_rate(self):
        total = self.hits + self.misses
        return 0.0 if total == 0 else self.hits / total

# Warm a HOT SET smaller than the pool, then hammer it.
pool = BufferPool(size=4)
hot = [10, 11, 12]            # 3 hot pages, pool holds 4 -> they all fit
workload = hot * 8            # touch them over and over

for p in workload:
    pool.get(p)

print("pool size:      ", len(pool.frames))
print("hot set:        ", hot)
print("requests:       ", len(workload))
print("hits / misses:  ", pool.hits, "/", pool.misses)
print("evictions:      ", pool.evictions)
print("hit rate:       %.0f%%" % (100 * pool.hit_rate()))
print("resident pages: ", sorted(p for p in pool.page_table))
print("recency MRU->LRU:", [pool.frames[i].page_no for i in pool.recency])
`;

export const SCANTHRASH_SANDBOX = `# Sequential flooding: one big scan wrecks an LRU buffer pool.
# Same LRU pool as the eviction section. We warm a hot working set,
# measure its hit rate, then run a sequential scan LARGER than the pool
# and measure the hot set's hit rate again. The collapse is a number.

POOL_SIZE = 4

class Frame:
    def __init__(self):
        self.page_no = None
        self.pin_count = 0
        self.dirty = False

class BufferPool:
    def __init__(self, size=POOL_SIZE):
        self.frames = [Frame() for _ in range(size)]
        self.page_table = {}
        self.recency = []           # MRU (front) -> LRU (back)
        self.disk = {}
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    def _touch(self, fi):
        if fi in self.recency:
            self.recency.remove(fi)
        self.recency.insert(0, fi)

    def _free_frame(self):
        for i, f in enumerate(self.frames):
            if f.page_no is None:
                return i
        return None

    def _evict(self):
        for fi in reversed(self.recency):           # LRU first
            if self.frames[fi].pin_count == 0:
                victim = self.frames[fi]
                self.page_table.pop(victim.page_no, None)
                self.recency.remove(fi)
                victim.page_no = None
                victim.dirty = False
                self.evictions += 1
                return fi
        raise RuntimeError("all frames pinned")

    def get(self, page_no):
        if page_no in self.page_table:
            self.hits += 1
            self._touch(self.page_table[page_no])
            return
        self.misses += 1
        fi = self._free_frame()
        if fi is None:
            fi = self._evict()
        self.frames[fi].page_no = page_no
        self.page_table[page_no] = fi
        self._touch(fi)

    def reset_counters(self):
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    def hit_rate(self):
        total = self.hits + self.misses
        return 0.0 if total == 0 else self.hits / total

pool = BufferPool(size=4)
hot = [10, 11, 12]                       # hot working set, fits in the pool
scan = list(range(100, 130))             # 30 unique pages >> pool size

# Phase 1: warm the hot set, then measure one steady-state pass over it.
for p in hot * 4:
    pool.get(p)
pool.reset_counters()
for p in hot:                            # steady state: every hot page resident
    pool.get(p)
before = pool.hit_rate()
print("BEFORE scan  hot-set hit rate: %.0f%%" % (100 * before))
print("  resident:", sorted(x for x in pool.page_table))

# Phase 2: a single sequential scan floods the pool.
for p in scan:
    pool.get(p)
print("scan touched", len(scan), "pages; resident now:",
      sorted(x for x in pool.page_table))

# Phase 3: the very next pass over the hot set. Every page was evicted.
pool.reset_counters()
for p in hot:
    pool.get(p)
after = pool.hit_rate()
print("AFTER scan   hot-set hit rate: %.0f%%" % (100 * after))
print("collapse:    %.0f%% -> %.0f%%  (the scan bulldozed every hot page out)"
      % (100 * before, 100 * after))
`;
