// Chapter 09 — MVCC & Snapshot Isolation. Sandboxes for §1 (the cost of waiting),
// §2 (versions) and §3 (visibility).
//
// Three self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// everything it needs — no cross-sandbox state. Per the chapter's canonical model
// (docs/superpowers/specs/ch09-canonical-model.md) every sandbox rebuilds the SAME
// compact MVCCStore (xmin/xmax + one visibility rule), the way ch08's sandboxes
// re-included a compact copy of the §4 lock manager.
//
// All three verified under python3 before shipping — both the raw body AND the
// exported template-literal string (the escaping lesson carried from ch06/ch07):
//   COST_SANDBOX       -> a single-copy cell under an S/X lock: a reader BLOCKS
//                         behind a writer, motivating "what if the old value were
//                         still there?".
//   VERSIONS_SANDBOX   -> introduces MVCCStore; a write APPENDS a new version while
//                         the old one stays. Prints the version list w/ xmin/xmax.
//   VISIBILITY_SANDBOX -> two snapshots taken at different instants read the SAME
//                         key and get DIFFERENT values, purely from the rule.

// §1 — The cost of waiting: collect ch08's debt. One physical copy of a row, one
// S/X lock, and a reader stuck behind a writer it doesn't even conflict with.
export const COST_SANDBOX = `# Chapter 08 left us with a bill. Under locking there is exactly ONE copy of each
# row, so a reader and a writer on the same row must take turns. Here is that cost
# in miniature: a single cell guarded by a shared/exclusive (S/X) lock, with a
# reader arriving while a writer holds the row.

class Cell:
    """One physical copy of a row, guarded by one S/X lock. The single copy is the
    whole problem -- to change the value you must hold X, and X excludes EVERY reader."""
    def __init__(self, value):
        self.value = value      # the ONE copy -- overwritten in place
        self.lock = None        # None | (mode, {holders})

    def acquire(self, who, mode):
        if self.lock is None:
            self.lock = (mode, {who})
            return "granted"
        held_mode, holders = self.lock
        if mode == "S" and held_mode == "S":   # readers share with readers...
            holders.add(who)
            return "granted"
        return "WAIT"                          # ...everything else conflicts

    def release(self, who):
        if self.lock and who in self.lock[1]:
            self.lock[1].discard(who)
            if not self.lock[1]:
                self.lock = None


cell = Cell("$100")

# Writer T_w takes the row exclusively to change $100 -> $150.
print("T_w  X-lock balance:", cell.acquire("T_w", "X"))    # granted

# Reader T_r only wants to SEE the balance -- but there is one copy, and it's taken.
print("T_r  S-lock balance:", cell.acquire("T_r", "S"))    # WAIT  <-- the cost
print("     reader blocked behind a write whose new value it doesn't even want")

# The reader can proceed only once the writer commits and lets go.
cell.value = "$150"
cell.release("T_w")
print("T_w released; T_r S-lock now:", cell.acquire("T_r", "S"))   # granted
print("T_r  reads:", cell.value)

print()
print("The whole chapter is one question: what if the old $100 were STILL THERE,")
print("sitting beside the new $150, so the reader could read it without waiting?")`;

// §2 — Versions: introduce the canonical MVCCStore. A write appends a new version;
// the old one stays. tuples grows; xmin (creator) / xmax (deleter) tag each.
export const VERSIONS_SANDBOX = `# The fix: never overwrite. A write APPENDS a new version of the row beside the old
# one. Each version (a "tuple") carries xmin -- the xid that CREATED it -- and xmax
# -- the xid that DELETED it (None while it is still live). This is the whole store;
# every sandbox in this chapter rebuilds exactly this shape.

class MVCCStore:
    def __init__(self):
        self.tuples = []          # append-only version list -- never overwritten in place
        self.next_xid = 1
        self.status = {}          # xid -> 'active' | 'committed' | 'aborted'

    def begin(self):
        xid = self.next_xid
        self.next_xid += 1
        self.status[xid] = 'active'
        # The snapshot: OTHER xids still in progress right now. A version created by
        # an xid in this set stays invisible even if it later commits.
        snapshot = {x for x, s in self.status.items() if s == 'active' and x != xid}
        return xid, snapshot

    def commit(self, xid):
        self.status[xid] = 'committed'

    def _visible_xact(self, x, xid, snapshot):
        if x == xid:
            return True
        return self.status.get(x) == 'committed' and x < xid and x not in snapshot

    def visible(self, t, xid, snapshot):
        if not self._visible_xact(t['xmin'], xid, snapshot):   # creator must be visible
            return False
        if t['xmax'] is not None and self._visible_xact(t['xmax'], xid, snapshot):
            return False                                       # ...deleter must NOT be
        return True

    def read(self, xid, key, snapshot):
        for t in reversed(self.tuples):       # newest version first
            if t['key'] == key and self.visible(t, xid, snapshot):
                return t['value']
        return None

    def write(self, xid, key, value, snapshot):
        for t in reversed(self.tuples):       # mark the version I see as deleted by me...
            if t['key'] == key and self.visible(t, xid, snapshot):
                t['xmax'] = xid
                break
        self.tuples.append({'key': key, 'value': value, 'xmin': xid, 'xmax': None})   # ...then append


db = MVCCStore()

# T1 creates the row and commits.
x1, s1 = db.begin()
db.write(x1, "balance", "$100", s1)
db.commit(x1)

# T2 changes it $100 -> $150. Watch tuples GROW rather than the value changing.
x2, s2 = db.begin()
print("versions before T2's write:", len(db.tuples))
db.write(x2, "balance", "$150", s2)
db.commit(x2)
print("versions after  T2's write:", len(db.tuples))
print()

def show(tuples):
    print(f"{'key':<9}{'value':<8}{'xmin':<6}{'xmax'}")
    for t in tuples:
        print(f"{t['key']:<9}{t['value']:<8}{t['xmin']:<6}{t['xmax']}")

show(db.tuples)
print()
print("The $100 version did not vanish: T1 created it (xmin=1), T2 deleted it (xmax=2),")
print("and the new $150 version (xmin=2, xmax=None) sits beside it. Append, don't overwrite.")`;

// §3 — Visibility: two snapshots taken at DIFFERENT instants read the SAME key and
// get DIFFERENT values, purely from the visibility rule. No locks taken anywhere.
export const VISIBILITY_SANDBOX = `# Same store, same rule -- now the payoff. TWO readers take their snapshots at
# DIFFERENT instants and read the SAME key. They get DIFFERENT values, and nobody
# locked anything. A version is visible iff its CREATOR is visible to your snapshot
# and its DELETER is not.

class MVCCStore:
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

    def _visible_xact(self, x, xid, snapshot):
        # Visible if it's me, or it had committed BEFORE my snapshot was taken:
        # committed, started before me (x < xid -- the snapshot ceiling, since xids
        # are start-ordered), AND not in my in-progress set.
        if x == xid:
            return True
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
                t['xmax'] = xid
                break
        self.tuples.append({'key': key, 'value': value, 'xmin': xid, 'xmax': None})


db = MVCCStore()

# T1 establishes balance = $100 and commits.
x1, s1 = db.begin()
db.write(x1, "balance", "$100", s1)
db.commit(x1)

# T_writer (xid 2) starts and changes the balance to $150 -- but has NOT committed.
xw, sw = db.begin()
db.write(xw, "balance", "$150", sw)

# reader_old takes its snapshot NOW, while T_writer is still in flight. T_writer is
# therefore IN reader_old's snapshot -- frozen out, even after it later commits.
old, snap_old = db.begin()
print("reader_old snapshot (in-progress xids):", snap_old or "{}")

# T_writer commits. Its $150 is now the newest version on the heap.
db.commit(xw)

# reader_new takes its snapshot AFTER that commit.
new, snap_new = db.begin()
print("reader_new snapshot (in-progress xids):", snap_new or "{}")
print()

print("reader_old reads balance:", db.read(old, "balance", snap_old))   # $100
print("reader_new reads balance:", db.read(new, "balance", snap_new))   # $150
print()

# Why the split? Look at the $150 version (created by T_writer, xid 2) through each
# snapshot. Same version, two verdicts.
v150 = [t for t in db.tuples if t['value'] == "$150"][0]
def explain(name, xid, snap):
    creator_ok = db._visible_xact(v150['xmin'], xid, snap)
    seen = "VISIBLE" if db.visible(v150, xid, snap) else "hidden"
    print(f"  {name}: is creator x{v150['xmin']} visible to me? {creator_ok}  ->  $150 is {seen}")

explain("reader_old", old, snap_old)
explain("reader_new", new, snap_new)
print()
print("Same row, two answers. reader_old's snapshot froze while the writer was active,")
print("so the writer's commit is invisible to it -- it still sees the old $100. No locks,")
print("no waiting: the old version was still lying around, and each snapshot picked its own.")`;
