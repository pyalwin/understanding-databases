# Chapter 10 — Canonical models (shared contract for all teammates)

Two hand-built models run through ch10: a **group-commit batcher** (§1–2) and an
**LSM-tree** (§4–7). Every Python sandbox is **self-contained** (Pyodide shares one
runtime across the page — each sandbox string redefines what it needs, copying forward a
COMPACT version of the model, the way ch08/ch09 re-included prior structures). Use the SAME
class/method names everywhere so the chapter reads as one continuous build. Do NOT rename.

These are deliberately simplified teaching models. Consistency across sandboxes and scenes
is the whole point.

---

## Model A — the LSM-tree (§4 memtable → §5 SSTable → §6 compaction → §7 amplification)

```python
TOMBSTONE = "__TOMBSTONE__"   # a delete is a WRITE of a tombstone marker

class LSMTree:
    """A log-structured merge tree. Writes go to an in-memory memtable (and an
    append-only WAL for durability). When the memtable fills it is FLUSHED as an
    immutable, sorted SSTable. Reads check the memtable, then SSTables newest-first.
    SSTables accumulate, so COMPACTION periodically merges them, keeping the newest
    value per key and dropping tombstones."""

    def __init__(self, memtable_limit=4):
        self.memtable = {}          # key -> value (value may be TOMBSTONE)
        self.wal = []               # append-only durability log: list of (key, value)
        self.sstables = []          # list of SSTables, NEWEST FIRST; each = sorted list of (key, value)
        self.memtable_limit = memtable_limit
        self.writes = 0             # bytes/records actually written (for write-amplification)

    def put(self, key, value):
        self.wal.append((key, value))      # durability FIRST: append to the log
        self.writes += 1
        self.memtable[key] = value
        if len(self.memtable) >= self.memtable_limit:
            self.flush()

    def delete(self, key):
        self.put(key, TOMBSTONE)           # delete == write a tombstone

    def flush(self):
        # memtable -> one immutable SORTED SSTable; newest table goes to the FRONT.
        sst = sorted(self.memtable.items())
        self.sstables.insert(0, sst)
        self.writes += len(sst)            # flushing re-writes the data: write amplification
        self.memtable = {}
        self.wal = []                      # WAL can be truncated once its data is in an SSTable

    def _lookup(self, sst, key):
        for k, v in sst:                   # linear scan of a small teaching SSTable
            if k == key:
                return v
        return None                        # sentinel "not present in this table"

    def get(self, key):
        # Newest-first: memtable wins, then SSTables front (newest) -> back (oldest).
        if key in self.memtable:
            v = self.memtable[key]
            return None if v == TOMBSTONE else v
        for sst in self.sstables:          # newest first
            v = self._lookup(sst, key)
            if v is not None:              # found the newest version in this table
                return None if v == TOMBSTONE else v
        return None                        # not found anywhere

    def compact(self):
        # Merge ALL SSTables into one. Iterate OLDEST->NEWEST so newer values
        # overwrite older; then drop tombstones (the key is truly gone).
        merged = {}
        for sst in reversed(self.sstables):    # reversed == oldest first
            for k, v in sst:
                merged[k] = v
        alive = {k: v for k, v in merged.items() if v != TOMBSTONE}
        self.sstables = [sorted(alive.items())] if alive else []
        self.writes += sum(len(s) for s in self.sstables)   # compaction re-writes survivors
```

### Section extensions (copy the base, add ONLY that section's piece)
- **§4 MEMTABLE_SANDBOX** — introduce put/get with just the memtable + WAL (no flush yet, or
  memtable_limit high). Show a write hitting the WAL (durability) then the memtable, and a read
  served from memory. Print the WAL and memtable.
- **§5 SSTABLE_SANDBOX** — fill the memtable past its limit → `flush()` → an immutable sorted
  SSTable appears, memtable clears, WAL truncates. Then a `get` that misses the memtable and
  walks SSTables newest-first. Show an UPDATE leaving an old value in an older SSTable, shadowed
  by the newer one (read returns newest). Print the SSTable stack.
- **§6 COMPACTION_SANDBOX** — write enough to produce several SSTables (including an update and a
  delete/tombstone of the same key across tables); show `get` working but having to scan many
  tables (read amplification); run `compact()`; show the tables collapse to one, the superseded
  value and the tombstone GONE, and `get` now hitting one table. Optionally a tiny bloom-filter
  helper that lets `get` SKIP an SSTable that can't contain the key.
- **§7 AMPLIFICATION_SANDBOX** — instrument the tree: count `writes` (write amplification — one
  logical put causes WAL + flush + compaction rewrites), count SSTables scanned per `get` (read
  amplification), and dead-vs-live ratio (space amplification). Contrast leveled-ish (compact
  often: low read/space, high write) vs tiered-ish (compact rarely: low write, high read/space).

---

## Model B — group commit (§1 fsync cost → §2 batcher)

```python
class WAL:
    """A write-ahead log whose durability comes from fsync. The cost model: an
    fsync is ~thousands of times slower than appending bytes, so the number of
    fsyncs -- not the number of commits -- is what caps throughput."""
    def __init__(self):
        self.buffer = []       # appended log records not yet forced to disk
        self.disk = []         # durably persisted records
        self.fsyncs = 0        # the expensive operation we are counting
    def append(self, record):
        self.buffer.append(record)
    def fsync(self):
        self.disk.extend(self.buffer)
        self.buffer = []
        self.fsyncs += 1       # one expensive disk-sync
```

### Section extensions
- **§1 FSYNC_SANDBOX** — naive commit: every transaction does `append` then `fsync`. Show
  fsyncs == commits, and a simple "cost = fsyncs * FSYNC_MS" throughput ceiling. The problem.
- **§2 GROUPCOMMIT_SANDBOX** — the batcher: many transactions append, then ONE `fsync` flushes
  the whole group and durably commits all of them at once. Show N commits costing 1 fsync,
  throughput multiplied by the batch size, and the tradeoff: a transaction must WAIT for the
  batch to flush before it's told "committed" (latency for throughput). Vary batch size.
- (Optional §3) **SEQUENTIAL_SANDBOX** — a tiny cost model: a sequential append costs 1 "seek"
  unit for many records; B-tree-style random in-place writes cost ~1 seek EACH. Show why
  append-only wins on spinning disks and still helps on SSDs (erase-block friendliness).

---

## Scenes (mirror these models)
- **GroupCommitScene (Fig 10.1, §2)** — transactions arriving on a timeline, piling into a commit
  batch; one fsync fires and durably commits the whole group; throughput vs batch-size, latency tradeoff.
- **SSTableScene (Fig 10.2, §5)** — the memtable filling, flushing to an immutable sorted SSTable;
  the read path checking memtable then SSTables newest-first (an update shadowed by a newer table).
- **CompactionScene (Fig 10.3, HERO, §6)** — SSTables stacking up, then compaction merging several
  into one: dead/superseded keys and tombstones dropping out as tables merge. Show the read-amp
  before (scan many) vs after (scan one), and the write-amp of the merge itself.
- **AmplificationScene (Fig 10.4, §7)** — the LSM tradeoff triangle: write vs read vs space
  amplification; a leveled-vs-tiered toggle moving the operating point; contrast with the B-tree.

## House rules (same as ch08/ch09 — non-negotiable)
- Components: `src/components/chapter-10/<Name>.tsx`, **default export, no props**, `client:visible`,
  wrapped in `<Figure number="10.x" caption>`. Cream palette ONLY via CSS vars
  (`--color-fig-bg/fg/muted/green/red/blue/orange`, `fig-card`, `fig-btn`, `fig-btn-primary/danger`).
  framer-motion ok. **390px reflow** (stack `flex-col sm:flex-row`, SVG `maxWidth:'100%' height:'auto'`
  inside `overflowX:auto`, controls `flex-wrap`, tap targets minHeight 38).
- Sandboxes: named-export template-literal strings in the assigned file. **Self-contained.**
  **python3-verify BOTH the raw body AND the exported template-literal string** (extract via tsx —
  what actually reaches Pyodide). No sql.js.
- **DEV-HARNESS GUARDRAIL (ENFORCED):** create NOTHING under `src/pages/` (only index.astro,
  chapters/index.astro, chapters/[slug].astro allowed). Don't leave `astro dev` running.
- Figure numbers FROZEN: GroupCommitScene **10.1**, SSTableScene **10.2**, CompactionScene **10.3**,
  AmplificationScene **10.4**.
- Reference templates: `src/components/chapter-08/DeadlockScene.tsx` (hero/animation/390px),
  `src/components/chapter-08/deadlock-sandboxes.ts` (sandbox style + compact self-contained copy).
