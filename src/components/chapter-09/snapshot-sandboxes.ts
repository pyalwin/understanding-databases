// Chapter 09 — MVCC & Snapshot Isolation. Sandboxes for §4 (snapshot isolation
// + first-committer-wins) and §5 (write skew).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own classes — no cross-sandbox state is assumed. Both carry a COMPACT
// copy of the canonical MVCCStore (the same xmin/xmax model §2/§3 build up),
// then add ONLY this section's piece:
//   SNAPSHOT_SANDBOX   -> a conflict-aware write(): first-committer-wins. Two
//                         concurrent writers update the same row; the first to
//                         commit wins, the second aborts. A reader on an older
//                         snapshot keeps seeing the old value the whole time.
//   WRITESKEW_SANDBOX  -> the doctors-on-call anomaly. Two txns, same view,
//                         each takes a DIFFERENT doctor off call -> no write-
//                         write conflict, both commit, the invariant breaks.
//
// Every string verified under python3 before shipping — both as raw source AND
// by eval'ing the exported template literal (what actually reaches Pyodide).

export const SNAPSHOT_SANDBOX = `# SNAPSHOT ISOLATION + FIRST-COMMITTER-WINS
# Each transaction reads from the snapshot it took at begin() -- a frozen view
# of which xids had committed by then. Readers never block writers: a reader
# keeps seeing its snapshot's version even as a writer commits a new one beside
# it. The one rule we ADD here is for write-write races: if two concurrent
# transactions update the SAME row, the first to commit wins and the second
# must ABORT (first-committer-wins). The check lives in write(): the row I am
# about to update has already been deleted (xmax set) by a concurrent txn that
# committed -- it moved the row out from under me, so I cannot.

class WriteConflict(Exception):
    pass


class MVCCStore:
    """Compact copy of the canonical version store (see section 2/3)."""
    def __init__(self):
        self.tuples = []          # append-only version list; never overwritten
        self.next_xid = 1
        self.status = {}          # xid -> 'active' | 'committed' | 'aborted'

    def begin(self):
        xid = self.next_xid
        self.next_xid += 1
        self.status[xid] = 'active'
        # snapshot = the OTHER xids still in progress right now. A version made
        # by one of them stays invisible even if it later commits -- that is
        # what freezes my view at this instant.
        snapshot = {x for x, s in self.status.items() if s == 'active' and x != xid}
        return xid, snapshot

    def commit(self, xid):
        self.status[xid] = 'committed'

    def abort(self, xid):
        self.status[xid] = 'aborted'

    def _visible_xact(self, x, xid, snapshot):
        if x == xid:
            return True
        # x < xid is the snapshot ceiling: a txn that STARTED after me (xids are
        # start-ordered) stays invisible even if it commits before my next read,
        # so my snapshot is frozen and repeatable.
        return self.status.get(x) == 'committed' and x < xid and x not in snapshot

    def visible(self, t, xid, snapshot):
        if not self._visible_xact(t['xmin'], xid, snapshot):
            return False
        if t['xmax'] is not None and self._visible_xact(t['xmax'], xid, snapshot):
            return False
        return True

    def read(self, xid, key, snapshot):
        for t in reversed(self.tuples):
            if t['key'] == key and self.visible(t, xid, snapshot):
                return t['value']
        return None

    def write(self, xid, key, value, snapshot):
        for t in reversed(self.tuples):
            if t['key'] == key and self.visible(t, xid, snapshot):
                # FIRST-COMMITTER-WINS: the version I see is the one I would
                # update -- but if a concurrent txn already stamped its xmax on
                # it AND committed, it updated this row first. I lose: abort.
                killer = t['xmax']
                if killer is not None and killer != xid and self.status.get(killer) == 'committed':
                    raise WriteConflict(
                        "xid %d cannot update %r: a concurrent txn (xid %d) already "
                        "updated it and committed (first-committer-wins)" % (xid, key, killer))
                t['xmax'] = xid       # mark the version I saw as deleted by me
                break
        self.tuples.append({'key': key, 'value': value, 'xmin': xid, 'xmax': None})


db = MVCCStore()

# Seed: x = 100, committed by a setup txn so everyone sees it as the base.
x0, _ = db.begin()
db.write(x0, 'x', 100, set())
db.commit(x0)

# Three transactions start, all while x is still 100. T1 begins first, so T1
# lands in the snapshots that R and T2 take after it -- that is what keeps T1's
# later commit invisible to them.
t1, s1 = db.begin()     # writer 1
t2, s2 = db.begin()     # writer 2 (concurrent with t1)
r,  sr = db.begin()     # a reader, holding an older view of x

print("=== readers don't block writers ===")
print("reader R sees x =", db.read(r, 'x', sr), "(its snapshot)")

# T1 reads, updates, and commits a new version of x.
print("T1 reads x =", db.read(t1, 'x', s1), "-> writes x = 150 -> COMMIT")
db.write(t1, 'x', 150, s1)
db.commit(t1)

# The reader took its snapshot before T1 committed, so it STILL sees 100 --
# no waiting, no lock, just the old version sitting beside the new one.
print("reader R re-reads x =", db.read(r, 'x', sr), "(still its snapshot -- unaffected by T1)")
fresh, sf = db.begin()
print("a brand-new txn reads x =", db.read(fresh, 'x', sf), "(sees T1's committed version)")
print()

print("=== first-committer-wins: T2 raced T1 on the same row ===")
print("T2 still sees x =", db.read(t2, 'x', s2), "from its snapshot; it tries x = 200")
try:
    db.write(t2, 'x', 200, s2)
    db.commit(t2)
    print("T2 committed")
except WriteConflict as e:
    db.abort(t2)
    print("T2 ABORTED:", e)
print()

final, sfin = db.begin()
print("Two writers updated the same row from the same starting value. One had")
print("to lose: T1 committed first, so T2's update was a write-write conflict")
print("and rolled back. Meanwhile the reader never waited for either of them.")
print("final committed x =", db.read(final, 'x', sfin), "(T1's value survived; T2 left no trace)")
`;

export const WRITESKEW_SANDBOX = `# WRITE SKEW -- the anomaly snapshot isolation gets wrong
# Snapshot isolation only stops two txns from clobbering the SAME row. But an
# invariant can span MULTIPLE rows. Hospital rule: at least one doctor must stay
# on call. Two doctors, alice and bob, are both on call. Two txns each take a
# snapshot, each sees TWO doctors on call, each decides it is safe to step out --
# but each removes a DIFFERENT doctor. Different rows means NO write-write
# conflict, so first-committer-wins never fires. Both commit. Now nobody is on
# call: the invariant is broken even though every txn preserved it locally.

class WriteConflict(Exception):
    pass


class MVCCStore:
    """The same conflict-aware store from the snapshot-isolation sandbox."""
    def __init__(self):
        self.tuples = []
        self.next_xid = 1
        self.status = {}

    def begin(self):
        xid = self.next_xid
        self.next_xid += 1
        self.status[xid] = 'active'
        snapshot = {x for x, s in self.status.items() if s == 'active' and x != xid}
        return xid, snapshot

    def commit(self, xid):
        self.status[xid] = 'committed'

    def abort(self, xid):
        self.status[xid] = 'aborted'

    def _visible_xact(self, x, xid, snapshot):
        if x == xid:
            return True
        # x < xid is the snapshot ceiling: a txn that STARTED after me (xids are
        # start-ordered) stays invisible even if it commits before my next read,
        # so my snapshot is frozen and repeatable.
        return self.status.get(x) == 'committed' and x < xid and x not in snapshot

    def visible(self, t, xid, snapshot):
        if not self._visible_xact(t['xmin'], xid, snapshot):
            return False
        if t['xmax'] is not None and self._visible_xact(t['xmax'], xid, snapshot):
            return False
        return True

    def read(self, xid, key, snapshot):
        for t in reversed(self.tuples):
            if t['key'] == key and self.visible(t, xid, snapshot):
                return t['value']
        return None

    def write(self, xid, key, value, snapshot):
        for t in reversed(self.tuples):
            if t['key'] == key and self.visible(t, xid, snapshot):
                killer = t['xmax']
                if killer is not None and killer != xid and self.status.get(killer) == 'committed':
                    raise WriteConflict(
                        "write-write conflict on %r (xid %d lost to %d)" % (key, xid, killer))
                t['xmax'] = xid
                break
        self.tuples.append({'key': key, 'value': value, 'xmin': xid, 'xmax': None})


db = MVCCStore()

# Seed: both doctors on call, committed.
setup, _ = db.begin()
db.write(setup, 'alice', True, set())
db.write(setup, 'bob', True, set())
db.commit(setup)

def on_call(store, xid, snap):
    return [d for d in ('alice', 'bob') if store.read(xid, d, snap)]

# Two doctors each open the scheduling app at the same instant.
t1, s1 = db.begin()
t2, s2 = db.begin()

print("=== both txns check the SAME invariant against the SAME view ===")
print("T1 sees on call:", on_call(db, t1, s1), "-> 2 on call, safe for alice to go off")
print("T2 sees on call:", on_call(db, t2, s2), "-> 2 on call, safe for bob to go off")
print()

# Each removes a DIFFERENT doctor -> different rows -> no write-write conflict.
print("=== each takes a DIFFERENT doctor off call (different rows!) ===")
db.write(t1, 'alice', False, s1)
print("T1: alice off-call -> COMMIT")
db.commit(t1)
db.write(t2, 'bob', False, s2)       # different row from alice: NO conflict
print("T2: bob off-call   -> COMMIT")
db.commit(t2)
print()

# Settle the dust: read the committed truth from a fresh snapshot.
audit, sa = db.begin()
now = on_call(db, audit, sa)
print("=== the invariant is now broken ===")
print("doctors actually on call:", now if now else "(NOBODY)")
assert len(now) == 0, "expected the invariant to be violated"
print("INVARIANT VIOLATED: 'at least one doctor on call' -- yet neither txn")
print("broke it alone. Each preserved it against its own snapshot.")
print()

print("Snapshot isolation only guards single-row write-write races, so it never")
print("noticed. SERIALIZABLE (e.g. Postgres SSI) would: it tracks read-WRITE")
print("dependencies, not just write-write. It sees T1 read bob (which T2 wrote)")
print("AND T2 read alice (which T1 wrote) -- a dangerous cycle of rw-edges -- and")
print("aborts one of them to keep the schedule equivalent to running them serially.")
`;
