// Chapter 08 — Locking & Concurrency. Sandboxes for §5 (deadlock detection)
// and §6 (latches vs locks).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// everything it needs — no cross-sandbox state, and (per spec) no dependency on
// the §4 lock-manager file: DEADLOCK_SANDBOX re-includes a COMPACT copy of the
// lock manager (same shape as §4's — self.table -> {granted, queue}) so it
// stands entirely alone while reading continuous with the chapter.
//
// Both strings verified under python3 before shipping (raw body AND the exported
// template-literal string, the lesson carried from ch06/ch07):
//   DEADLOCK_SANDBOX -> builds the A/B–B/A deadlock, detects the wait-for-graph
//                       cycle, aborts a victim, shows the survivor completing.
//   LATCH_SANDBOX    -> contrasts a one-operation latch with a txn-duration lock.
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

// §5 — Deadlock: the §4 lock manager + a wait-for graph + detect_deadlock().
export const DEADLOCK_SANDBOX = `# A compact lock manager -- a self-contained copy of the chapter's §4 manager,
# same shape (self.table maps a resource to its granted set + FIFO wait queue) --
# now extended with a WAIT-FOR GRAPH and deadlock detection. We don't spawn real
# threads: a request that conflicts simply gets queued and returns "waiting",
# which is exactly the bookkeeping a real lock manager keeps. detect_deadlock()
# then looks for a cycle in the wait-for graph; we abort a victim to break it.

class LockManager:
    # Compatibility: S/S compatible; X conflicts with everything.
    def __init__(self):
        self.table = {}   # resource -> {'granted': {txn: 'S'|'X'}, 'queue': [(txn, mode), ...]}

    def _entry(self, resource):
        return self.table.setdefault(resource, {"granted": {}, "queue": []})

    def _compatible(self, granted, txn, mode):
        for holder, m in granted.items():
            if holder == txn:
                continue
            if mode == "X" or m == "X":
                return False
        return True

    def lock(self, txn, resource, mode):
        e = self._entry(resource)
        if txn in e["granted"]:
            return "granted"
        # No barging: if anyone is already queued, wait behind them (FIFO,
        # starvation-safe) even if we'd otherwise be compatible.
        if not e["queue"] and self._compatible(e["granted"], txn, mode):
            e["granted"][txn] = mode
            return "granted"
        if txn not in [t for t, _ in e["queue"]]:
            e["queue"].append((txn, mode))
        return "waiting"

    def unlock(self, txn, resource):
        e = self._entry(resource)
        e["granted"].pop(txn, None)
        self._drain(resource)

    def release_all(self, txn):
        # Abort path: drop every lock and every queued request for this txn...
        for e in self.table.values():
            e["granted"].pop(txn, None)
            e["queue"] = [(t, m) for t, m in e["queue"] if t != txn]
        # ...then wake whoever the released locks unblock.
        for resource in list(self.table):
            self._drain(resource)

    def _drain(self, resource):
        # Grant from the FRONT of the queue while compatible (S/S batch together),
        # stop at the first conflict -- this is what keeps FIFO order.
        e = self.table[resource]
        while e["queue"]:
            txn, mode = e["queue"][0]
            if self._compatible(e["granted"], txn, mode):
                e["granted"][txn] = mode
                e["queue"].pop(0)
            else:
                break

    def held(self, txn):
        return [r for r, e in self.table.items() if txn in e["granted"]]

    # --- the new part: who is waiting for whom ---------------------------
    def wait_for_graph(self):
        # Edge Ti -> Tj when Ti is queued on a resource Tj holds a conflicting
        # lock on (Ti can only proceed once Tj lets go).
        edges = {}
        for e in self.table.values():
            for waiter, wmode in e["queue"]:
                for holder, hmode in e["granted"].items():
                    if holder != waiter and (wmode == "X" or hmode == "X"):
                        edges.setdefault(waiter, set()).add(holder)
        return edges

    def detect_deadlock(self):
        # A cycle in the wait-for graph IS a deadlock. DFS, return the cycle.
        edges = self.wait_for_graph()
        WHITE, GREY, BLACK = 0, 1, 2
        color = {}
        stack = []

        def visit(u):
            color[u] = GREY
            stack.append(u)
            for v in edges.get(u, ()):
                if color.get(v, WHITE) == GREY:          # back-edge => cycle
                    return stack[stack.index(v):] + [v]
                if color.get(v, WHITE) == WHITE:
                    found = visit(v)
                    if found:
                        return found
            stack.pop()
            color[u] = BLACK
            return None

        for node in edges:
            if color.get(node, WHITE) == WHITE:
                cyc = visit(node)
                if cyc:
                    return cyc
        return None


# ---------------------------------------------------------------------------
# The classic A/B - B/A deadlock under (strict) two-phase locking.
lm = LockManager()
print("T1 lock A (X):", lm.lock("T1", "A", "X"))   # granted
print("T2 lock B (X):", lm.lock("T2", "B", "X"))   # granted
print("T1 lock B (X):", lm.lock("T1", "B", "X"))   # waiting -> T1 waits for T2
print("T2 lock A (X):", lm.lock("T2", "A", "X"))   # waiting -> T2 waits for T1

print("wait-for graph:", {k: sorted(v) for k, v in lm.wait_for_graph().items()})
cycle = lm.detect_deadlock()
print("deadlock cycle:", cycle)

# Victim selection: abort the txn holding the FEWEST locks (cheapest to redo;
# real systems often use the youngest timestamp instead). Tie-break by name.
ring = cycle[:-1]                       # drop the repeated closing node
victim = min(ring, key=lambda t: (len(lm.held(t)), t))
print("abort victim:", victim)
lm.release_all(victim)                  # releasing its locks wakes the survivor

print("after abort, graph:", lm.wait_for_graph())
print("deadlock now:", lm.detect_deadlock())

survivor = [t for t in ring if t != victim][0]
print(f"{survivor} now holds:", sorted(lm.held(survivor)))   # A and B
lm.release_all(survivor)                # survivor commits, frees everything
print(f"{victim} retries and locks A:", lm.lock(victim, "A", "X"))     # granted now

# Prevention alternatives (no detection needed -- cycles can't form):
#   wait-die : older txn waits for younger; younger asking for an older's lock
#              DIES (aborts, retries). Non-preemptive.
#   wound-wait: older txn WOUNDS (aborts) a younger holder and takes the lock;
#               younger waits for older. Preemptive.
#   Both order conflicts by a fixed timestamp, so no cycle is ever possible.
#   The crude-but-common fallback: a LOCK TIMEOUT -- give up after N seconds and
#   abort, trading false positives for not having to build the graph at all.`;

// §6 — Latches vs locks: two mutual-exclusion systems at two timescales.
export const LATCH_SANDBOX = `# Two mutual-exclusion systems at two timescales. A LATCH guards an in-memory
# data structure (a buffer-pool page from ch04/05, a B-tree node mid-split) for
# the few microseconds of ONE operation: acquire -> mutate -> release, all
# inside the same method. It is NOT transactional and NOT deadlock-managed --
# you take it, you touch the bytes, you let go, immediately.
#
# A LOCK guards LOGICAL data (a row) for the DURATION OF A TRANSACTION: acquired
# as the txn reads/writes and held -- under strict 2PL -- all the way to commit.
# It is tracked by the lock manager, can block, and can deadlock.

class Latch:
    """A short, cheap mutex. Held only within a single operation."""
    def __init__(self, name):
        self.name = name
        self.holder = None
    def __enter__(self):
        assert self.holder is None, f"latch {self.name} already held (would spin)"
        self.holder = "op"
        return self
    def __exit__(self, *exc):
        self.holder = None      # released before the method even returns


class Page:
    """An in-memory buffer-pool page, guarded by a latch -- not by the lock manager."""
    def __init__(self):
        self.latch = Latch("page#42")
        self.counter = 0
    def bump(self):
        # acquire -> mutate -> release, all in this one call. Microseconds.
        with self.latch:
            self.counter += 1
        # latch is ALREADY gone here; no transaction, no manager involved.


# A latch protects the page only for the instant of each mutation.
page = Page()
for _ in range(3):
    page.bump()
print("page counter:", page.counter, "| latch held after op?:", page.latch.holder is not None)

# A lock, by contrast, spans many steps and outlives each one.
class Txn:
    def __init__(self, tid):
        self.tid = tid
        self.locks = set()
    def acquire(self, row):
        self.locks.add(row)                 # taken mid-transaction...
    def commit(self):
        held = sorted(self.locks)
        self.locks.clear()                  # ...and only released at commit
        return held

t = Txn("T1")
t.acquire("users:42")            # step 1: read the row, take an S/X lock
# ... more transaction steps happen here, lock STILL held ...
t.acquire("accounts:7")          # step 2: another row, another lock
print("locks held mid-txn:", sorted(t.locks))   # both, across steps
print("released at commit:", t.commit())

print()
print("LATCH: in-memory structure | one operation | no deadlock detection | ~ns-us")
print("LOCK : logical row data    | whole txn     | deadlock-managed       | ms-s")
print("Confusing the two is a classic engine bug: a latch held across a txn step")
print("serializes everything; a lock taken for a single mutation is pure overhead.")`;
