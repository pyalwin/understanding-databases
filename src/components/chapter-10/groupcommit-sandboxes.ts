// Chapter 10 — Group Commit & Log-Structured Storage. Sandboxes for §1 (the
// fsync problem), §2 (group commit), and §3 (sequential vs random).
//
// Three self-contained Python strings seeded into <PythonSandbox>. Pyodide shares
// ONE runtime across every sandbox on the page, so each string redefines
// everything it needs (per the ch10 canonical model + the ch08/ch09 pattern):
// FSYNC_SANDBOX and GROUPCOMMIT_SANDBOX each carry a COMPACT copy of Model B's
// WAL class verbatim, so each stands alone while reading continuous. SEQUENTIAL
// is a pure cost model and needs no WAL.
//
// All three verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide):
//   FSYNC_SANDBOX      -> naive commit: fsyncs == commits, ~200 commits/s ceiling.
//   GROUPCOMMIT_SANDBOX -> the batcher: N commits, 1 fsync; throughput x batch,
//                          latency rises with it (the trade).
//   SEQUENTIAL_SANDBOX -> append = one seek + stream; random in-place = a seek
//                          PER record; append-only wins by hundreds of x.
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

// §1 — The fsync problem: Model B's WAL, one fsync per commit, throughput wall.
export const FSYNC_SANDBOX = `# A write-ahead log whose durability comes from fsync. The cost model that runs
# through this whole chapter: an fsync (force the OS buffer to durable storage)
# is THOUSANDS of times slower than appending bytes -- so the number of fsyncs,
# not the number of commits, is what caps throughput.

class WAL:
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


# Two timescales, measured in the same unit so we can compare them honestly.
FSYNC_MS  = 5.0     # one fsync ~5 ms: a disk must actually persist the bytes
APPEND_US = 1.0     # appending to the in-memory buffer ~1 microsecond

def commit_naive(wal, record):
    # The naive commit protocol: log the record, then force it to disk so the
    # transaction is durable. Correct -- but it forces the disk EVERY time.
    wal.append(record)         # cheap: bytes into the buffer
    wal.fsync()                # EXPENSIVE: force the whole buffer to durable storage

wal = WAL()
N = 1000
for i in range(N):
    commit_naive(wal, f"txn-{i}")

elapsed_ms  = wal.fsyncs * FSYNC_MS
throughput  = N / (elapsed_ms / 1000)
cpu_ceiling = 1_000_000 / APPEND_US     # if appends were all that mattered

print("commits        :", N)
print("fsyncs         :", wal.fsyncs, "(exactly one per commit)")
print("durable records:", len(wal.disk))
print(f"fsync cost     : {FSYNC_MS} ms each  ->  {elapsed_ms:.0f} ms total")
print(f"throughput     : {throughput:.0f} commits/sec")
print(f"the CPU alone   could append ~{cpu_ceiling:,.0f} commits/sec -- {cpu_ceiling/throughput:,.0f}x more")
print()
print("=> fsyncs, not commits, are the ceiling: ~200 commits/s no matter the CPU.")
print("   A faster processor does NOT help -- the disk sync is the wall.")`;

// §2 — Group commit: many appends, ONE fsync per group. Throughput vs batch size.
export const GROUPCOMMIT_SANDBOX = `# Same WAL, same fsync cost. The fix is not a faster disk -- it is forcing the
# disk LESS OFTEN. Many transactions append their records, then ONE fsync makes
# the whole group durable at once. N commits cost a single expensive sync.

class WAL:
    def __init__(self):
        self.buffer = []
        self.disk = []
        self.fsyncs = 0
    def append(self, record):
        self.buffer.append(record)
    def fsync(self):
        self.disk.extend(self.buffer)
        self.buffer = []
        self.fsyncs += 1

FSYNC_MS   = 5.0     # one fsync ~5 ms (unchanged -- the disk did not get faster)
ARRIVAL_MS = 0.1     # under load, a new transaction arrives ~every 0.1 ms

def group_commit(n_txns, batch_size):
    # Transactions append as they arrive; every batch_size of them, fsync ONCE,
    # durably committing the whole group together.
    wal = WAL()
    for i in range(n_txns):
        wal.append(f"txn-{i}")
        if (i + 1) % batch_size == 0:
            wal.fsync()            # one sync commits the whole batch
    if wal.buffer:                 # flush any final partial batch
        wal.fsync()
    return wal

# A single batch, concretely: 8 transactions, ONE fsync commits all 8.
demo = group_commit(8, 8)
print(f"8 transactions appended, then 1 fsync -> {len(demo.disk)} durable, "
      f"{demo.fsyncs} fsync\\n")

# Now sweep the batch size and watch the two numbers move in opposite directions.
N = 1000
print(f"{'batch':>6} {'fsyncs':>7} {'commits/s':>11} {'latency_ms':>11}")
for b in [1, 2, 4, 8, 16, 32, 64, 128]:
    wal = group_commit(N, b)
    elapsed_ms = wal.fsyncs * FSYNC_MS
    throughput = N / (elapsed_ms / 1000)
    # A committing txn must wait for its batch to fill, then for the one fsync.
    # On average it waits for half the batch to accumulate, plus the flush.
    latency_ms = (b * ARRIVAL_MS) / 2 + FSYNC_MS
    print(f"{b:>6} {wal.fsyncs:>7} {throughput:>11.0f} {latency_ms:>11.2f}")

print()
print("batch=1   is the naive case: 1000 fsyncs, ~200 commits/s.")
print("batch=64  : ~16 fsyncs, throughput ~x64 -- a few ms more latency per commit.")
print("Throughput climbs ~x batch_size; per-commit latency rises with it.")
print("That is the whole trade: a little latency bought a lot of throughput.")`;

// §3 — Sequential vs random: why append-only is the disk's favorite pattern.
export const SEQUENTIAL_SANDBOX = `# Why build storage as an append-only log at all? A tiny cost model of the disk.
# The dominant cost of a write is the SEEK -- moving the head and waiting for the
# platter to rotate under it. Transferring the bytes, once positioned, is cheap.

SEEK_MS = 8.0      # a seek (head move + rotational latency) ~8 ms
XFER_MS = 0.01     # transferring one record, once positioned ~negligible

def cost_append_only(n_records):
    # Append-only (a log, an LSM flush): every record lands at the TAIL. The head
    # seeks ONCE to the end, then streams every record sequentially behind it.
    return SEEK_MS * 1 + XFER_MS * n_records

def cost_random_inplace(n_records):
    # Update-in-place (ch04's B-tree): each record lives in its own page,
    # scattered across the disk. Every write is its own seek.
    return SEEK_MS * n_records + XFER_MS * n_records

print(f"{'records':>8} {'append-only':>13} {'random in-place':>16} {'speedup':>9}")
for n in [1, 10, 100, 1000, 10000]:
    a = cost_append_only(n)
    r = cost_random_inplace(n)
    print(f"{n:>8} {a:>11.1f}ms {r:>14.1f}ms {r/a:>8.0f}x")

print()
print("Append-only pays ONE seek then streams; random in-place pays a seek PER write.")
print("On a spinning disk seeks dominate, so sequential wins by hundreds of x.")
print()
print("# SSDs have no heads -- but the same shape holds. Flash erases in big BLOCKS,")
print("# so scattered in-place updates force read-modify-write of whole erase blocks")
print("# (write amplification + wear). Appending fills fresh blocks in order, which")
print("# the flash translation layer and garbage collector love. Sequential STILL wins.")`;
