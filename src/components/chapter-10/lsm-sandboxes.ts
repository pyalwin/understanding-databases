// Chapter 10 — Group Commit & Log-Structured Storage. LSM-tree sandboxes for
// §4 (the memtable), §5 (SSTables), and §7 (amplification).
//
// Three self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines a
// COMPACT copy of the canonical LSMTree (docs/superpowers/specs/ch10-canonical-
// model.md, Model A) — the way ch08/ch09 re-included prior structures. The
// class/method names are identical everywhere so the chapter reads as one
// continuous build: §4 memtable + WAL → §5 flush() to immutable SSTables →
// §6 (Cole's COMPACTION_SANDBOX) → §7 instrument the three amplifications.
//
// Every string verified under python3 before shipping — both as raw source AND
// by extracting the exported template literal via tsx (what actually reaches
// Pyodide):
//   MEMTABLE_SANDBOX      -> WAL-first durability, read from memory, WAL replay
//   SSTABLE_SANDBOX       -> flush to a sorted SSTable; get walks newest-first;
//                            an update in a newer table shadows the old value
//   AMPLIFICATION_SANDBOX -> write / read / space amp; compact-often (leveled-
//                            ish) vs compact-rarely (tiered-ish) contrast
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

export const MEMTABLE_SANDBOX = `# THE MEMTABLE (and its write-ahead log)
# An LSM-tree turns every write into an append. A write does two things, in this
# order: it appends the (key, value) record to an on-disk WAL -- that append is
# what makes the write DURABLE (survives a crash) -- and then it updates an
# in-memory MEMTABLE that serves reads. No disk seeks, no update-in-place: the
# memtable is just a dict, the WAL is just a growing file. (Flushing a full
# memtable out to an SSTable is section 5; here the memtable simply grows.)

TOMBSTONE = "__TOMBSTONE__"      # a delete is a WRITE of a tombstone marker

class LSMTree:
    def __init__(self):
        self.memtable = {}        # key -> value (value may be TOMBSTONE)
        self.wal = []             # append-only durability log: list of (key, value)

    def put(self, key, value):
        self.wal.append((key, value))   # DURABILITY FIRST: append to the log...
        self.memtable[key] = value      # ...then update the in-memory table
        print("  put %s=%s   (WAL append #%d, then memtable)"
              % (key, value, len(self.wal)))

    def delete(self, key):
        self.put(key, TOMBSTONE)        # delete == write a tombstone

    def get(self, key):
        v = self.memtable.get(key)      # reads are served straight from RAM
        return None if (v is None or v == TOMBSTONE) else v

    def show(self):
        print("  WAL (on disk, append-only):")
        for i, (k, v) in enumerate(self.wal):
            print("    %2d. %s=%s" % (i, k, v))
        print("  memtable (in RAM):", dict(sorted(self.memtable.items())))


tree = LSMTree()

print("=== writes append to the WAL first, then update the memtable ===")
tree.put("user:1", "alice")
tree.put("user:2", "bob")
tree.put("user:1", "alice2")     # an update: a NEW append, old record stays in WAL
tree.delete("user:2")            # a delete: append a tombstone
print()
tree.show()
print()

print("=== reads are served from memory, no disk touched ===")
print("  get user:1 ->", tree.get("user:1"))      # newest write wins
print("  get user:2 ->", tree.get("user:2"))      # tombstoned -> gone
print("  get user:9 ->", tree.get("user:9"))      # never written -> None
print()

# DURABILITY: the memtable lives in RAM and is lost on a crash. The WAL is on
# disk, so recovery REPLAYS it in order to rebuild the exact memtable.
print("=== crash! the memtable (RAM) is gone -- replay the WAL to recover ===")
saved_wal = list(tree.wal)
recovered = LSMTree()
recovered.wal = []
for k, v in saved_wal:
    recovered.memtable[k] = v        # replay in order; last write per key wins
print("  recovered memtable:", dict(sorted(recovered.memtable.items())))
print("  get user:1 ->", recovered.get("user:1"), " get user:2 ->", recovered.get("user:2"))
assert recovered.memtable == tree.memtable, "WAL replay must rebuild the memtable"
print("  WAL replay rebuilt the memtable exactly -- the writes were durable.")
`;

export const SSTABLE_SANDBOX = `# FLUSHING TO SSTABLES
# A memtable cannot grow forever. When it hits a size limit it is FLUSHED: its
# contents are written out, in sorted key order, as one immutable SSTable
# (Sorted String Table) -- and the memtable and WAL are cleared, because the data
# now lives in the SSTable. Flushes accumulate, so SSTables form a stack, NEWEST
# AT THE FRONT. A read checks the memtable, then walks the stack newest -> oldest
# and stops at the first hit -- so a newer table SHADOWS an older value for the
# same key.

TOMBSTONE = "__TOMBSTONE__"

class LSMTree:
    def __init__(self, memtable_limit=4):
        self.memtable = {}        # key -> value
        self.wal = []             # append-only durability log
        self.sstables = []        # list of SSTables, NEWEST FIRST; each = sorted [(k, v)]
        self.memtable_limit = memtable_limit

    def put(self, key, value):
        self.wal.append((key, value))
        self.memtable[key] = value
        if len(self.memtable) >= self.memtable_limit:
            self.flush()

    def delete(self, key):
        self.put(key, TOMBSTONE)

    def flush(self):
        sst = sorted(self.memtable.items())   # one immutable SORTED table
        self.sstables.insert(0, sst)          # newest goes to the FRONT
        print("  FLUSH memtable -> SSTable #%d: %s"
              % (len(self.sstables) - 1, sst))
        self.memtable = {}                    # memtable cleared...
        self.wal = []                         # ...and the WAL truncated (data is safe in the SSTable)

    def _lookup(self, sst, key):
        for k, v in sst:                      # linear scan of a small teaching table
            if k == key:
                return v
        return None                           # not present in this table

    def get(self, key, trace=False):
        if key in self.memtable:
            v = self.memtable[key]
            if trace: print("    hit in memtable")
            return None if v == TOMBSTONE else v
        for i, sst in enumerate(self.sstables):   # newest -> oldest
            v = self._lookup(sst, key)
            if trace: print("    checked SSTable #%d ..." % i, "HIT" if v is not None else "miss")
            if v is not None:                 # first hit wins -- it is the newest version
                return None if v == TOMBSTONE else v
        return None

    def show(self):
        print("  memtable (RAM):", dict(sorted(self.memtable.items())), " WAL records:", len(self.wal))
        print("  SSTable stack (newest first):")
        if not self.sstables:
            print("    (none)")
        for i, sst in enumerate(self.sstables):
            print("    #%d %s" % (i, sst))


tree = LSMTree(memtable_limit=4)

print("=== fill the memtable past its limit -> it flushes to an SSTable ===")
tree.put("a", 1)
tree.put("b", 2)
tree.put("c", 3)
tree.put("d", 4)                 # 4th key hits the limit -> FLUSH
print()
tree.show()
print()

print("=== an UPDATE: write a:99, then fill again to flush a SECOND table ===")
tree.put("a", 99)                # shadows a=1, but a=1 still sits in SSTable #1
tree.put("e", 5)
tree.put("f", 6)
tree.put("g", 7)                 # limit hit again -> second FLUSH
print()
tree.show()
print()

print("=== a read walks the stack newest-first and stops at the first hit ===")
print("  get a  (updated):")
print("  ->", tree.get("a", trace=True))         # finds a=99 in the NEWER table; a=1 shadowed
print("  get c  (only in the old table):")
print("  ->", tree.get("c", trace=True))         # miss newer table, hit older one
print()
print("a=99 lives in SSTable #0 and a=1 still sits in SSTable #1 -- the old value")
print("was never overwritten in place, just SHADOWED. Reclaiming it is compaction.")
assert tree.get("a") == 99 and tree.get("c") == 3
`;

export const AMPLIFICATION_SANDBOX = `# THE THREE AMPLIFICATIONS
# Never updating in place is not free. The bill comes in three currencies, and
# compaction trades them against each other:
#   WRITE amplification  = bytes actually written / bytes the user asked to write.
#                          One logical put causes a WAL append, a flush, and every
#                          later compaction that REWRITES that record again.
#   READ  amplification  = SSTables a get must scan. More tables -> more to check.
#   SPACE amplification   = records stored / distinct live keys. Superseded values
#                          and tombstones take up room until compaction drops them.
# Compacting OFTEN (leveled-ish) keeps few tables: low read & space amp, but high
# write amp (you rewrite again and again). Compacting RARELY (tiered-ish) barely
# rewrites: low write amp, but tables and dead versions pile up (high read & space).

TOMBSTONE = "__TOMBSTONE__"

class LSMTree:
    def __init__(self, memtable_limit=3):
        self.memtable = {}
        self.wal = []
        self.sstables = []
        self.memtable_limit = memtable_limit
        self.writes = 0           # records actually written -- write amplification

    def put(self, key, value):
        self.wal.append((key, value))
        self.writes += 1          # the WAL append is a real write
        self.memtable[key] = value
        if len(self.memtable) >= self.memtable_limit:
            self.flush()

    def delete(self, key):
        self.put(key, TOMBSTONE)

    def flush(self):
        sst = sorted(self.memtable.items())
        self.sstables.insert(0, sst)
        self.writes += len(sst)   # flushing RE-writes the data: write amplification
        self.memtable = {}
        self.wal = []

    def _lookup(self, sst, key):
        for k, v in sst:
            if k == key:
                return v
        return None

    def get(self, key):
        # Returns (value, tables_scanned) so we can measure READ amplification.
        scanned = 0
        if key in self.memtable:
            v = self.memtable[key]
            return (None if v == TOMBSTONE else v, scanned)
        for sst in self.sstables:        # newest -> oldest
            scanned += 1
            v = self._lookup(sst, key)
            if v is not None:
                return (None if v == TOMBSTONE else v, scanned)
        return (None, scanned)           # a miss scans EVERY table

    def compact(self):
        # Merge ALL SSTables into one, oldest->newest so newer wins, drop tombstones.
        merged = {}
        for sst in reversed(self.sstables):
            for k, v in sst:
                merged[k] = v
        alive = {k: v for k, v in merged.items() if v != TOMBSTONE}
        self.sstables = [sorted(alive.items())] if alive else []
        self.writes += sum(len(s) for s in self.sstables)   # rewrites the survivors

    # --- the three amplification metrics -----------------------------------
    def live_keys(self):
        merged = {}
        for sst in reversed(self.sstables):
            for k, v in sst:
                merged[k] = v
        for k, v in self.memtable.items():
            merged[k] = v
        return {k: v for k, v in merged.items() if v != TOMBSTONE}

    def stored_records(self):
        return sum(len(s) for s in self.sstables) + len(self.memtable)

    def read_amp(self, keys):
        # average tables scanned over a workload of gets (present + missing keys)
        total = sum(self.get(k)[1] for k in keys)
        return total / len(keys)


# A workload that UPDATES the same few keys over and over -- exactly what makes
# dead versions and extra tables pile up. Identical sequence for both regimes.
KEYS = ["a", "b", "c", "d", "e"]
WORKLOAD = [(KEYS[i % len(KEYS)], i) for i in range(30)]   # 30 logical puts
PROBES = KEYS + ["zzz"]   # gets we measure: every live key, plus one guaranteed miss

def run(compact_every):
    # compact_every = flush count between compactions (0 = never compact)
    tree = LSMTree(memtable_limit=3)
    flushes = 0
    prev = 0
    for k, v in WORKLOAD:
        tree.put(k, v)
        if len(tree.sstables) != prev:        # a flush just happened
            flushes += 1
            prev = len(tree.sstables)
            if compact_every and flushes % compact_every == 0:
                tree.compact()
                prev = len(tree.sstables)
    logical = len(WORKLOAD)
    live = len(tree.live_keys())
    write_amp = tree.writes / logical
    read_amp = tree.read_amp(PROBES)
    space_amp = tree.stored_records() / max(1, live)
    return tree, write_amp, read_amp, space_amp

print("Same 30-put workload (heavy updates to 5 keys), two compaction regimes:")
print()
for label, every in [("compact RARELY (tiered-ish): never compact", 0),
                     ("compact OFTEN (leveled-ish): merge after every flush", 1)]:
    tree, w, r, s = run(every)
    print("--- %s ---" % label)
    print("  SSTables left      : %d" % len(tree.sstables))
    print("  WRITE amplification: %.2fx   (records written per logical put)" % w)
    print("  READ  amplification: %.2f    (SSTables scanned per get, avg)" % r)
    print("  SPACE amplification: %.2fx   (records stored per live key)" % s)
    print()

print("Compacting rarely barely rewrites (low WRITE amp) but leaves many tables")
print("and dead versions (high READ and SPACE amp). Compacting often inverts the")
print("trade: one tight table (low READ/SPACE) bought with repeated rewrites")
print("(high WRITE amp). You cannot minimize all three at once -- pick two.")
`;
