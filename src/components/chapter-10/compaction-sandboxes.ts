// Chapter 10 — Group Commit & Log-Structured Storage. Sandbox for §6 (compaction).
//
// One self-contained Python string seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so this string redefines
// everything it needs: it embeds a COMPACT copy of the canonical LSMTree
// (Model A — same class/method names as §4/§5: put/delete/flush/get + TOMBSTONE)
// and adds the two things §6 is about — compact() and a tiny per-SSTable bloom
// filter that lets get() SKIP tables that provably can't hold the key.
//
// Verified under python3 before shipping — BOTH the raw body AND the exported
// template-literal string (extracted via tsx — what actually reaches Pyodide):
//   COMPACTION_SANDBOX -> writes enough to stack up 4 SSTables (with an UPDATE
//                         and a DELETE/tombstone spread across them); shows get()
//                         scanning many tables (read amplification); runs
//                         compact(); the tables collapse to ONE, the superseded
//                         value and the tombstone GONE, get() now hits one table.
//
// Exported as a string so the MDX integrator can drop it into the sandbox.

export const COMPACTION_SANDBOX = `# An LSM-tree, continued. Writes land in an in-memory memtable (backed by an
# append-only WAL); a full memtable FLUSHES to an immutable, sorted SSTable.
# SSTables pile up newest-first, so a read may walk many of them -- READ
# AMPLIFICATION. This section adds the cure: compact() merges every SSTable into
# one (newest value per key wins, tombstones dropped), and a tiny BLOOM FILTER
# per SSTable lets a read skip tables that provably can't contain the key.

TOMBSTONE = "__TOMBSTONE__"          # a delete is a WRITE of a tombstone marker


class Bloom:
    """A miniature bloom filter: a bit-set (one Python int) with two hash
    functions. add() sets two bits; might_contain() is True only if BOTH bits
    are set. It can yield a false positive (scan a table that lacks the key) but
    NEVER a false negative -- so it is always safe to SKIP when it says 'no'."""
    def __init__(self, nbits=64):
        self.nbits = nbits
        self.bits = 0
    def _hashes(self, key):
        h1 = h2 = 0
        for ch in key:
            h1 = (h1 * 31 + ord(ch)) % self.nbits
            h2 = (h2 * 17 + ord(ch) + 7) % self.nbits
        return (h1, h2)
    def add(self, key):
        for h in self._hashes(key):
            self.bits |= (1 << h)
    def might_contain(self, key):
        return all((self.bits >> h) & 1 for h in self._hashes(key))


class LSMTree:
    def __init__(self, memtable_limit=2):
        self.memtable = {}           # key -> value (value may be TOMBSTONE)
        self.wal = []                # append-only durability log
        self.sstables = []           # NEWEST FIRST; each = sorted list of (k, v)
        self.blooms = []             # one Bloom per SSTable, aligned with sstables
        self.memtable_limit = memtable_limit
        self.writes = 0              # records written (write amplification)
        self.tables_scanned = 0      # tables linearly scanned by the last get()
        self.tables_skipped = 0      # tables skipped via bloom by the last get()

    def put(self, key, value):
        self.wal.append((key, value))            # durability FIRST: append to log
        self.writes += 1
        self.memtable[key] = value
        if len(self.memtable) >= self.memtable_limit:
            self.flush()

    def delete(self, key):
        self.put(key, TOMBSTONE)                 # delete == write a tombstone

    def flush(self):
        sst = sorted(self.memtable.items())      # immutable SORTED SSTable
        bloom = Bloom()
        for k, _ in sst:
            bloom.add(k)
        self.sstables.insert(0, sst)             # newest goes to the FRONT
        self.blooms.insert(0, bloom)
        self.writes += len(sst)                  # flushing re-writes data: write amp
        self.memtable = {}
        self.wal = []                            # WAL truncates once data is in an SSTable

    def _lookup(self, sst, key):
        for k, v in sst:                         # linear scan of a small SSTable
            if k == key:
                return v
        return None

    def get(self, key, use_bloom=True):
        self.tables_scanned = 0
        self.tables_skipped = 0
        if key in self.memtable:                 # memtable wins (newest of all)
            v = self.memtable[key]
            return None if v == TOMBSTONE else v
        for sst, bloom in zip(self.sstables, self.blooms):   # newest -> oldest
            if use_bloom and not bloom.might_contain(key):   # provably absent: SKIP
                self.tables_skipped += 1
                continue
            self.tables_scanned += 1
            v = self._lookup(sst, key)
            if v is not None:                    # newest surviving version
                return None if v == TOMBSTONE else v
        return None

    def compact(self):
        # Merge ALL SSTables into one. Iterate OLDEST -> NEWEST so newer values
        # overwrite older; then DROP tombstones (the key is then truly gone).
        merged = {}
        for sst in reversed(self.sstables):      # reversed == oldest first
            for k, v in sst:
                merged[k] = v
        alive = {k: v for k, v in merged.items() if v != TOMBSTONE}
        if alive:
            sst = sorted(alive.items())
            bloom = Bloom()
            for k, _ in sst:
                bloom.add(k)
            self.sstables = [sst]
            self.blooms = [bloom]
        else:
            self.sstables = []
            self.blooms = []
        self.writes += sum(len(s) for s in self.sstables)    # rewrite survivors


def show_stack(tree):
    # Stack printed NEWEST-FIRST, '#0' = newest -- same convention as §5.
    for i, sst in enumerate(tree.sstables):
        label = "newest" if i == 0 else ("oldest" if i == len(tree.sstables) - 1 else "")
        cells = ", ".join(k + "=" + ("DEL" if v == TOMBSTONE else v) for k, v in sst)
        print("  SSTable #%d %-7s [%s]" % (i, label, cells))


# ---------------------------------------------------------------------------
# Write a workload that stacks up several SSTables. memtable_limit=2, so every
# two writes flush a new table. We slip in an UPDATE of 'alice' and a DELETE of
# 'bob', landing in DIFFERENT tables -- exactly the mess compaction cleans up.
tree = LSMTree(memtable_limit=2)
tree.put("alice", "v1")
tree.put("bob",   "v1")     # flush -> SSTable[oldest]: alice=v1, bob=v1
tree.put("alice", "v2")     # UPDATE alice (old v1 is now stale, still on disk)
tree.put("carol", "v1")     # flush -> alice=v2, carol=v1
tree.put("dave",  "v1")
tree.delete("bob")          # DELETE bob (tombstone) -> flush -> bob=DEL, dave=v1
tree.put("carol", "v2")     # UPDATE carol
tree.put("eve",   "v1")     # flush -> carol=v2, eve=v1

print("=== BEFORE compaction: %d SSTables on disk ===" % len(tree.sstables))
show_stack(tree)

# Reads still WORK, but the newest 'alice' lives three tables down -- a naive
# read walks every table above it before it hits. That is READ AMPLIFICATION.
print()
val = tree.get("alice", use_bloom=False)
print("get('alice') =", val, "| scanned", tree.tables_scanned,
      "tables  <- read amplification (no bloom)")

# A bloom filter per SSTable fixes most of it: tables whose bloom says 'no' are
# skipped without a scan. Same answer, far fewer tables touched.
val = tree.get("alice")
print("get('alice') =", val, "| scanned", tree.tables_scanned,
      "table, skipped", tree.tables_skipped, "via bloom filter")
print("get('bob')   =", tree.get("bob"),
      "  (deleted -> None) | scanned", tree.tables_scanned, "skipped", tree.tables_skipped)
print("writes so far (write amplification):", tree.writes)

# ---------------------------------------------------------------------------
print()
print("=== compact(): merge oldest->newest, newest wins, drop tombstones ===")
tree.compact()
print("=== AFTER compaction: %d SSTable ===" % len(tree.sstables))
show_stack(tree)

print()
print("get('alice') =", tree.get("alice"),
      "| scanned", tree.tables_scanned, "table  (stale v1 is gone)")
print("get('bob')   =", tree.get("bob"),
      "  (truly removed -- no tombstone left to find)")
print("get('carol') =", tree.get("carol"),
      "| scanned", tree.tables_scanned, "table")
print("writes total after the merge rewrite:", tree.writes)

print()
print("Compaction traded a one-time WRITE (rewriting the survivors) for cheap")
print("READS forever after: 4 tables -> 1, dead versions and tombstones reclaimed.")`;
