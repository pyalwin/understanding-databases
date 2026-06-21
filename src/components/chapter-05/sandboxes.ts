// Python (Pyodide) sandbox source for Chapter 05 — §1 (the pool), §2 (pin &
// dirty), and §7 (dirty write-back + the write-ahead rule).
//
// Each constant is a SELF-CONTAINED Python program. Pyodide runs one shared
// runtime per page, so a later sandbox must NOT depend on classes defined in an
// earlier one — every string re-declares what it needs and runs clean on its
// own. Pass these to <PythonSandbox initialCode={...} client:only="react" />.

/**
 * §1 — The Pool.
 * A fixed array of frames plus a page table mapping page-number → frame.
 * get(page_no) is a hit if the page is already resident, otherwise a miss that
 * reads from `disk` into a free frame. The pool is large enough that no
 * eviction is needed yet — that comes in §3.
 */
export const POOL_SANDBOX = `# A buffer pool: a fixed array of frames + a page table (page_no -> frame).
class BufferPool:
    def __init__(self, size):
        self.size       = size
        self.frames     = [None] * size   # each frame holds one page_no (or None)
        self.page_table = {}              # page_no -> frame index
        self.disk       = {}              # the "on-disk" pages: page_no -> data
        self.hits       = 0
        self.misses     = 0

    def get(self, page_no):
        # HIT: the page is already resident in some frame.
        if page_no in self.page_table:
            self.hits += 1
            return self.page_table[page_no]
        # MISS: find a free frame and read the page from disk into it.
        self.misses += 1
        frame = self.frames.index(None)   # a free slot (no eviction yet)
        self.frames[frame] = page_no
        self.page_table[page_no] = frame
        return frame

    def hit_rate(self):
        total = self.hits + self.misses
        return self.hits / total if total else 0.0

pool = BufferPool(size=4)
pool.disk = {p: ("page-%d-bytes" % p) for p in range(10)}

# A request stream with repeats: hot pages 1 and 2 are touched again and again.
requests = [1, 2, 3, 1, 2, 4, 1, 2, 3, 1]
for p in requests:
    before = "hit " if p in pool.page_table else "MISS"
    frame  = pool.get(p)
    print("request page %d -> frame %d  (%s)" % (p, frame, before))

print()
print("page table:", pool.page_table)
print("hits=%d  misses=%d  hit_rate=%.0f%%" % (
    pool.hits, pool.misses, 100 * pool.hit_rate()))
`;

/**
 * §2 — Pin & Dirty.
 * Extends the §1 pool with per-frame bookkeeping: a pin_count (a frame in use
 * cannot be evicted) and a dirty flag (a modified frame differs from disk and
 * must be written back before it can be dropped). Demonstrates that a pinned
 * frame is excluded from the eviction candidates.
 */
export const PINDIRTY_SANDBOX = `# The pool, now with the two pieces of bookkeeping eviction needs:
#   pin_count : a frame someone is using must NOT be evicted (callback to ch04's
#               B-tree descent — the page must survive until the descent ends).
#   dirty     : a frame modified in RAM differs from disk; it is the "dirty page"
#               ch02 named, and it must be written back before being dropped.
class BufferPool:
    def __init__(self, size):
        self.size       = size
        self.frames     = [None] * size
        self.page_table = {}
        self.disk       = {}
        self.pin_count  = [0] * size       # per-frame pin count
        self.dirty      = [False] * size   # per-frame dirty bit
        self.hits       = 0
        self.misses     = 0

    def get(self, page_no):
        if page_no in self.page_table:
            self.hits += 1
            return self.page_table[page_no]
        self.misses += 1
        frame = self.frames.index(None)
        self.frames[frame] = page_no
        self.page_table[page_no] = frame
        return frame

    def pin(self, page_no):
        f = self.get(page_no)
        self.pin_count[f] += 1
        return f

    def unpin(self, page_no):
        f = self.page_table[page_no]
        if self.pin_count[f] > 0:
            self.pin_count[f] -= 1

    def mark_dirty(self, page_no):
        self.dirty[self.page_table[page_no]] = True

    def evictable(self):
        # Only unpinned, occupied frames are eviction candidates.
        return [f for f in range(self.size)
                if self.frames[f] is not None and self.pin_count[f] == 0]

pool = BufferPool(size=4)
pool.disk = {p: ("page-%d" % p) for p in range(10)}

pool.pin(1)            # a B-tree descent pins page 1 while it reads it
pool.get(2)
pool.pin(3)
pool.mark_dirty(3)     # page 3 was modified in its frame -> dirty

for p in (1, 2, 3):
    f = pool.page_table[p]
    print("page %d  frame %d  pin=%d  dirty=%s" % (
        p, f, pool.pin_count[f], pool.dirty[f]))

print()
print("eviction candidates (unpinned):",
      [pool.frames[f] for f in pool.evictable()])
print("-> page 1 is pinned, so it is NOT a candidate; the descent is safe.")

pool.unpin(1)          # descent finished
print("after unpin(1):",
      [pool.frames[f] for f in pool.evictable()])
`;

/**
 * §7 — Dirty write-back + the write-ahead rule.
 * Frames carry the LSN of their last modification. Before a dirty page is
 * written to disk (on eviction/flush), the pool asserts the WAL is durable up
 * to that LSN via wal.flush_through(lsn) — the write-ahead rule (steal/no-force)
 * that ties ch02's WAL to ch04's pages. The demo crashes once WITHOUT honoring
 * the rule (unrecoverable torn page) and once honoring it (recoverable).
 */
export const WRITEBACK_SANDBOX = `# Evicting a DIRTY page means writing it to disk first. But you cannot write it
# willy-nilly: if the machine crashes mid-write, the on-disk page is torn and
# only the WAL (ch02) can repair it. The WRITE-AHEAD RULE: a page's log records
# must be durable BEFORE the page itself is written to disk.

class StubWAL:
    "A tiny stand-in for ch02's write-ahead log."
    def __init__(self):
        self.records = []     # log records, in order, each tagged with an LSN
        self.durable_lsn = 0  # highest LSN guaranteed on disk (fsync'd)

    def append(self, lsn, change):
        self.records.append((lsn, change))   # in memory; not yet durable

    def flush_through(self, lsn):
        # fsync the log up to lsn — this is what makes recovery possible.
        self.durable_lsn = max(self.durable_lsn, lsn)

class Pool:
    def __init__(self, wal):
        self.wal        = wal
        self.frame      = None    # the page resident in our one frame
        self.frame_lsn  = 0       # LSN of that frame's last modification
        self.dirty      = False

    def modify(self, page_no, lsn, change):
        self.frame, self.frame_lsn, self.dirty = page_no, lsn, True
        self.wal.append(lsn, change)   # log the change (still only in memory)

    def write_back(self, disk, honor_rule):
        if honor_rule:
            # Enforce write-ahead: log durable up to this page's LSN first.
            self.wal.flush_through(self.frame_lsn)
        if self.frame_lsn > self.wal.durable_lsn:
            disk[self.frame] = "TORN"      # page on disk, log records lost
        else:
            disk[self.frame] = "page-%d@lsn%d" % (self.frame, self.frame_lsn)
        self.dirty = False

def recover(disk, wal):
    # Recovery can only redo a torn page if its log records are durable.
    for pg, val in disk.items():
        if val == "TORN":
            if any(lsn <= wal.durable_lsn for lsn, _ in wal.records):
                return "page %d torn, but WAL has it -> REDO, recoverable" % pg
            return "page %d torn and WAL lost it -> UNRECOVERABLE" % pg
    return "all pages clean -> recoverable"

# --- Crash WITHOUT honoring the write-ahead rule ---------------------------
wal  = StubWAL()
disk = {}
p    = Pool(wal)
p.modify(7, lsn=42, change="set x=1")
p.write_back(disk, honor_rule=False)   # page hits disk; log NOT flushed
# ...crash here, before the log was ever fsync'd...
print("no rule:   disk =", disk, "| durable_lsn =", wal.durable_lsn)
print("           ", recover(disk, wal))
print()

# --- Crash WHILE honoring the write-ahead rule -----------------------------
wal  = StubWAL()
disk = {}
p    = Pool(wal)
p.modify(7, lsn=42, change="set x=1")
p.write_back(disk, honor_rule=True)    # flush_through(42) BEFORE the page write
# ...crash here...
print("with rule: disk =", disk, "| durable_lsn =", wal.durable_lsn)
print("           ", recover(disk, wal))
`;
