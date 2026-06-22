// Chapter 08 — Locking & Concurrency. Sandboxes for §3 (two-phase locking)
// and §4 (the lock manager).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own classes — no cross-sandbox state is assumed. They accumulate the
// chapter's machinery: §1's lost update → §2's S/X lock → here §3's 2PL
// transaction wrapper → §4's LockManager (lock table + wait queue), which §5
// then extends with a deadlock detector.
//
// Every string verified under python3 before shipping — both as raw source AND
// by eval'ing the exported template literal (what actually reaches Pyodide):
//   TWOPL_SANDBOX        -> the 2PL rule + the lost update prevented (final 200)
//   LOCKMANAGER_SANDBOX  -> resource -> {granted set, wait queue}; FIFO wakeups
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

export const TWOPL_SANDBOX = `# TWO-PHASE LOCKING (2PL)
# Locks alone are not enough -- WHEN you release matters. 2PL gives every
# transaction two phases: a GROWING phase (acquire only) followed by a
# SHRINKING phase (release only). The single rule -- "no acquire after the
# first release" -- is what makes an interleaved schedule equivalent to running
# the transactions one at a time (serializability). STRICT 2PL goes one step
# further: hold every EXCLUSIVE lock until commit/abort, so no one can read
# your uncommitted writes (this makes aborts cascadeless).

class TwoPLViolation(Exception):
    pass


class LockTable:
    """A tiny shared/exclusive lock table over named items."""
    def __init__(self):
        self.holders = {}                    # item -> { txn_name: 'S' | 'X' }

    def _conflict(self, item, txn, mode):
        for other, held in self.holders.get(item, {}).items():
            if other == txn:
                continue
            if mode == 'X' or held == 'X':   # S/S is the ONLY compatible pair
                return other
        return None

    def acquire(self, item, txn, mode):
        blocker = self._conflict(item, txn, mode)
        if blocker is not None:
            return blocker                   # caller must wait for 'blocker'
        self.holders.setdefault(item, {})[txn] = mode
        return None

    def release(self, item, txn):
        d = self.holders.get(item, {})
        d.pop(txn, None)
        if not d:
            self.holders.pop(item, None)


class Transaction:
    """Wraps a step list and ENFORCES the 2PL rule as the schedule runs.

    A step is one of:
        ('lock', item, mode)   acquire S or X on item   (growing phase only)
        ('read', item)         reg = db[item]
        ('add', n)             reg += n
        ('write', item)        db[item] = reg
        ('unlock', item)       release item             (-> shrinking phase)
        ('commit',)            strict 2PL: release everything still held
    """
    def __init__(self, name, steps):
        self.name = name
        self.steps = steps
        self.pc = 0
        self.reg = None            # one working register: the value last read
        self.shrinking = False     # have we released ANY lock yet?
        self.locks = set()         # items we currently hold
        self.waiting_for = None    # item we are blocked on (for a tidy trace)

    def done(self):
        return self.pc >= len(self.steps)


def run(txns, db, label):
    print("--- %s ---" % label)
    lt = LockTable()
    while not all(t.done() for t in txns):
        progressed = False
        for t in txns:
            if t.done():
                continue
            op = t.steps[t.pc]
            kind = op[0]

            if kind == 'lock':
                _, item, mode = op
                if t.shrinking:
                    raise TwoPLViolation(
                        "%s tried to lock %s after releasing a lock -- an "
                        "acquire in the shrinking phase breaks 2PL" % (t.name, item))
                blocker = lt.acquire(item, t.name, mode)
                if blocker is not None:
                    if t.waiting_for != item:
                        print("%s: WAIT for %s-lock on %s (held by %s)"
                              % (t.name, mode, item, blocker))
                        t.waiting_for = item
                    continue                 # blocked: let another txn run
                t.waiting_for = None
                t.locks.add(item)
                print("%s: lock %s %s" % (t.name, mode, item))

            elif kind == 'read':
                _, item = op
                t.reg = db[item]
                print("%s: read %s = %d" % (t.name, item, t.reg))

            elif kind == 'add':
                t.reg += op[1]

            elif kind == 'write':
                _, item = op
                db[item] = t.reg
                print("%s: write %s = %d" % (t.name, item, t.reg))

            elif kind == 'unlock':
                _, item = op
                lt.release(item, t.name)
                t.locks.discard(item)
                t.shrinking = True
                print("%s: unlock %s" % (t.name, item))

            elif kind == 'commit':
                for item in sorted(t.locks):     # strict 2PL: release at commit
                    lt.release(item, t.name)
                t.locks.clear()
                t.shrinking = True
                print("%s: COMMIT (released all locks)" % t.name)

            t.pc += 1
            progressed = True

        if not progressed:
            print("DEADLOCK: every live transaction is blocked (that is section 5)")
            break
    return db


# 1) The 2PL RULE itself. A transaction that acquires a lock AFTER it has
#    released one is not two-phase -- the wrapper refuses to run it.
print("=== the 2PL rule: no acquire after a release ===")
bad = Transaction("Tbad", [
    ('lock', 'x', 'S'), ('read', 'x'),
    ('unlock', 'x'),                # <- shrinking phase begins here
    ('lock', 'y', 'S'),            # <- illegal: acquiring after releasing
])
try:
    run([bad], {'x': 1, 'y': 2}, "non-two-phase transaction")
except TwoPLViolation as e:
    print("REJECTED:", e)
print()

# 2) The lost update from section 1, now run under STRICT 2PL. Both
#    transactions read the balance, add 50, and write it back. Each takes an
#    X lock first and holds it to commit, so the second transaction must WAIT.
print("=== the lost update, under strict 2PL ===")
def deposit(name):
    return Transaction(name, [
        ('lock', 'bal', 'X'),
        ('read', 'bal'),
        ('add', 50),
        ('write', 'bal'),
        ('commit',),
    ])

db = run([deposit("T1"), deposit("T2")], {'bal': 100}, "two $50 deposits")
print("final balance =", db['bal'], "(correct: 100 + 50 + 50 = 200)")
assert db['bal'] == 200, "lost update!"
print()
print("Without locks both txns read 100 and write 150 -- one deposit vanishes")
print("(final 150). Strict 2PL serialized them: T2 waited for T1 to commit,")
print("read the committed 150, and wrote 200. Correctness, bought with waiting.")
`;

export const LOCKMANAGER_SANDBOX = `# THE LOCK MANAGER
# Everything in sections 2-3 is policy on top of one small data structure: a
# hash table keyed by resource id. Each entry holds a GRANTED SET (who holds
# the lock, in what mode) and a WAIT QUEUE (who is blocked, in arrival order).
#   - lock()        joins the granted set if compatible, else joins the queue
#   - unlock()      drops a holder and WAKES compatible waiters from the FRONT
#   - release_all() drops a transaction everywhere (what commit/abort calls)
# Waking strictly from the front (FIFO) is what stops a stream of readers from
# starving a writer that arrived first.

class LockManager:
    def __init__(self):
        self.table = {}      # resource -> {'granted': {txn: mode}, 'queue': [(txn, mode)]}

    def _entry(self, resource):
        return self.table.setdefault(resource, {'granted': {}, 'queue': []})

    def _gc(self, resource):
        e = self.table.get(resource)
        if e and not e['granted'] and not e['queue']:
            del self.table[resource]

    @staticmethod
    def _compatible(granted, txn, mode):
        # S/S is the only compatible pair; X conflicts with everything.
        for other, held in granted.items():
            if other == txn:
                continue
            if mode == 'X' or held == 'X':
                return False
        return True

    @staticmethod
    def _fmt(granted):
        if not granted:
            return "{}"
        return "{" + ", ".join("%s:%s" % (t, m) for t, m in granted.items()) + "}"

    def lock(self, txn, resource, mode):
        e = self._entry(resource)
        if txn in e['granted']:                      # already a holder
            return 'granted'
        # No barging: even a compatible request waits if someone is queued
        # ahead of it. That is the anti-starvation rule.
        if not e['queue'] and self._compatible(e['granted'], txn, mode):
            e['granted'][txn] = mode
            print("  GRANT  %s wants %s on %s  ->  granted=%s"
                  % (txn, mode, resource, self._fmt(e['granted'])))
            return 'granted'
        e['queue'].append((txn, mode))
        ahead = [q[0] for q in e['queue'][:-1]] or list(e['granted'])
        print("  QUEUE  %s wants %s on %s  ->  BLOCKED behind %s"
              % (txn, mode, resource, ahead))
        return 'waiting'

    def _drain(self, resource):
        e = self.table.get(resource)
        if not e:
            return
        while e['queue']:
            txn, mode = e['queue'][0]
            if self._compatible(e['granted'], txn, mode):
                e['granted'][txn] = mode
                e['queue'].pop(0)
                print("  WAKE   %s gets %s on %s  ->  granted=%s"
                      % (txn, mode, resource, self._fmt(e['granted'])))
            else:
                break                                # stop at first conflict (FIFO)

    def unlock(self, txn, resource):
        e = self.table.get(resource)
        if not e or txn not in e['granted']:
            return
        del e['granted'][txn]
        print("  UNLOCK %s on %s" % (txn, resource))
        self._drain(resource)
        self._gc(resource)

    def release_all(self, txn):
        print("  release_all(%s)" % txn)
        for resource in list(self.table):
            e = self.table[resource]
            if txn in e['granted']:
                del e['granted'][txn]
                print("  UNLOCK %s on %s" % (txn, resource))
                self._drain(resource)
            before = len(e['queue'])
            e['queue'] = [(t, m) for (t, m) in e['queue'] if t != txn]
            if len(e['queue']) != before:
                print("  DEQUEUE %s from %s's wait queue" % (txn, resource))
            self._gc(resource)

    def show(self):
        print("  lock table:")
        if not self.table:
            print("    (empty)")
        for resource, e in self.table.items():
            q = [("%s:%s" % (t, m)) for (t, m) in e['queue']]
            print("    %-4s granted=%s  queue=[%s]"
                  % (resource, self._fmt(e['granted']), ", ".join(q)))


lm = LockManager()

# A blocked acquire that unblocks on release, plus an S/S batch wakeup.
print("=== a write lock blocks two readers, then releases ===")
lm.lock("T1", "A", "X")     # granted: A is free
lm.lock("T2", "A", "S")     # blocked: T1 holds X
lm.lock("T3", "A", "S")     # blocked: queued behind T2
print()
lm.show()
print()

print("=== T1 releases A: the two readers wake together (S/S compatible) ===")
lm.unlock("T1", "A")        # drains the queue: T2 and T3 both get S
print()
lm.show()
print()

# release_all is what a committing (or aborting) transaction calls.
print("=== T4 wants X on A and must wait behind both readers ===")
lm.lock("T4", "A", "X")     # blocked: two S holders
print()
print("=== both readers commit -> release_all wakes the writer ===")
lm.release_all("T2")
lm.release_all("T3")        # now A is free, T4 finally gets X
print()
lm.show()
`;
