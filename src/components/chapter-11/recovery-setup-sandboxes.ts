// Chapter 11 — Recovery & ARIES. Sandboxes for §1 (the crash) and §3 (the log).
//
// Two self-contained Python strings seeded into <PythonSandbox>. Pyodide shares
// ONE runtime across every sandbox on the page, so each string redefines what it
// needs — no cross-sandbox state. Following ch08/09/10, the later sandboxes carry
// a COMPACT copy of the canonical ARIES `DB` (see docs/.../ch11-canonical-model.md)
// so the chapter reads as one continuous build with identical field/method names.
//
//   CRASH_SANDBOX (§1) — NO recovery manager yet. Hand-stage the disaster with
//                        plain dicts: a committed change that never reached disk
//                        (no-force) and an uncommitted change that did (steal).
//                        Print the on-disk state and show it is wrong BOTH ways.
//   LOG_SANDBOX   (§3) — the canonical `DB` (update/commit only). Every change is
//                        a numbered, ordered, durable log record BEFORE it touches
//                        a page; trace one txn's prevLSN chain and a page's pageLSN.
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §1 — The crash: what a mid-flight crash leaves on disk, staged by hand.
export const CRASH_SANDBOX = `# No recovery manager yet -- just plain dicts, so we can stage the disaster by
# hand and SEE it. Two stores: 'buf' is the in-memory buffer pool (LOST on a
# crash), 'disk' is what was actually written to durable storage (SURVIVES).
# A change is only safe once it is on 'disk'. The buffer-pool policy from ch05
# decides WHEN pages move from buf to disk -- and that policy is what bites us.

buf  = {}                                  # in-memory pages: pid -> value (volatile)
disk = {"A": 100, "B": 200}                # durable pages, from earlier committed work

def update(pid, val):                      # write lands in the buffer, not on disk
    buf[pid] = val

def flush(pid):                            # buffer manager writes a page out to disk
    disk[pid] = buf[pid]

def crash():                               # power cut: the whole buffer pool vanishes
    buf.clear()

print("start    disk:", disk)

# --- T1: a COMMITTED change that never reached disk (NO-FORCE) ----------------
# No-force = the buffer pool need NOT flush a page just because the txn committed.
update("A", 150)                           # T1 writes A = 150 in the buffer...
# ...T1 COMMITS here. We told the user "committed". But A is still only in buf --
# no-force means we did NOT flush it. (Imagine A got evicted later? It didn't.)
print("T1 commits A=150 (in buffer only, not flushed)")

# --- T2: an UNCOMMITTED change that DID reach disk (STEAL) --------------------
# Steal = the buffer pool may evict (and flush) a dirty page belonging to a txn
# that has NOT committed -- e.g. it needed the frame for someone else.
update("B", 999)                           # T2 writes B = 999 in the buffer...
flush("B")                                 # ...and the buffer pool STEALS the frame:
                                           # B = 999 is now on durable disk.
print("T2's B=999 stolen to disk; T2 has NOT committed")

# --- the crash strikes mid-flight --------------------------------------------
crash()
print()
print("after crash, on-disk state:", disk)

# Disk is now wrong in BOTH directions:
expected = {"A": 150, "B": 200}            # what a correct system must end up with
print("what it SHOULD be:        ", expected)
print()
print("A =", disk["A"], "-> WRONG: T1 committed A=150 but no-force lost it.   need REDO")
print("B =", disk["B"], "-> WRONG: T2 never committed but steal persisted 999. need UNDO")
print()
print("So a crash leaves committed work MISSING (redo it) and uncommitted work")
print("PRESENT (undo it). ARIES is the algorithm that repairs the disk both ways.")`;

// §3 — The log: the WAL with LSNs (canonical DB, update/commit only, no recovery).
export const LOG_SANDBOX = `# A COMPACT copy of the chapter's canonical ARIES \`DB\` -- only the normal-running
# parts (update / commit); recovery comes later. The point of this sandbox: every
# change becomes a numbered, ordered, DURABLE log record BEFORE it touches a page.
#
# WRITE-AHEAD LOGGING (WAL) rule: the log record describing a change reaches
# durable storage BEFORE the data page does, and a txn's commit record is durable
# before the commit is reported. In this model 'log' is always durable; a 'disk'
# page is only what was explicitly flushed. So the log is the source of truth.

class DB:
    def __init__(self):
        self.log = []     # durable log: list of record dicts. Survives a crash.
        self.lsn = 0
        self.disk = {}    # on-disk pages: pid -> {'val', 'pageLSN'}. Survives.
        self.buf = {}     # in-memory pages: pid -> {'val', 'pageLSN'}. LOST on crash.
        self.att = {}     # active txn table: tid -> {'status': 'U'|'C', 'lastLSN'}

    def _next(self):
        self.lsn += 1
        return self.lsn

    def _page(self, pid):                       # fault a page in on first touch
        if pid not in self.buf:
            d = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            self.buf[pid] = {'val': d['val'], 'pageLSN': d['pageLSN']}
        return self.buf[pid]

    def update(self, tid, pid, new_val):
        page = self._page(pid)
        lsn = self._next()
        # WAL: append the log record FIRST (it is durable as soon as it's here)...
        self.log.append({'lsn': lsn, 'type': 'update', 'tid': tid, 'pid': pid,
                         'before': page['val'], 'after': new_val,
                         'prevLSN': self.att.get(tid, {}).get('lastLSN', 0)})
        # ...THEN stamp the page and its pageLSN (the LSN of its latest change).
        page['val'] = new_val
        page['pageLSN'] = lsn
        self.att.setdefault(tid, {'status': 'U', 'lastLSN': 0})['lastLSN'] = lsn
        self.att[tid]['status'] = 'U'
        return lsn

    def commit(self, tid):
        c = self._next()
        self.log.append({'lsn': c, 'type': 'commit', 'tid': tid,
                         'prevLSN': self.att[tid]['lastLSN']})
        e = self._next()
        self.log.append({'lsn': e, 'type': 'end', 'tid': tid, 'prevLSN': c})
        del self.att[tid]                       # committed + ended: leaves the table


db = DB()
# Two transactions interleave their writes -- the log records the true order.
db.update("T1", "A", 150)     # lsn 1
db.update("T2", "B", 200)     # lsn 2
db.update("T1", "C", 300)     # lsn 3  (T1's second change)
db.commit("T1")               # lsn 4 commit, lsn 5 end
db.update("T2", "B", 250)     # lsn 6  (T2 overwrites B)

print("THE LOG -- every change is a numbered, ordered, durable record:")
for r in db.log:
    if r['type'] == 'update':
        print(f"  lsn {r['lsn']}: update {r['tid']} {r['pid']} "
              f"{r['before']!r}->{r['after']!r}  prevLSN={r['prevLSN']}")
    else:
        print(f"  lsn {r['lsn']}: {r['type']:<7}{r['tid']}            prevLSN={r['prevLSN']}")

# prevLSN chains each txn's records backward -- undo will walk this in reverse.
def chain(db, tid):
    last = max((r['lsn'] for r in db.log if r.get('tid') == tid), default=0)
    by_lsn = {r['lsn']: r for r in db.log}
    seq = []
    while last:
        seq.append(last)
        last = by_lsn[last]['prevLSN']
    return list(reversed(seq))

print()
print("T2's prevLSN chain (its records, oldest->newest):", chain(db, "T2"))
print("T1's prevLSN chain:                              ", chain(db, "T1"))

# pageLSN lives ON the page: the LSN of the most recent change applied to it.
# Recovery compares it to a log record's lsn to make redo idempotent (skip if
# pageLSN >= lsn -- the page already reflects that change).
print()
print("page B in buffer:", db.buf["B"], "  <- pageLSN", db.buf["B"]["pageLSN"],
      "= lsn of B's last update")
print("the log has", len(db.log), "records; lsn counter at", db.lsn,
      "-- the durable, ordered story of every change.")`;
