// Chapter 09 — MVCC & Snapshot Isolation. Sandbox for §6 (vacuum).
//
// One self-contained Python string seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so this string redefines
// everything it needs — it carries a COMPACT copy of the canonical MVCCStore
// (the same xmin/xmax model from §2–§5, see docs/superpowers/specs/
// ch09-canonical-model.md), then adds ONLY its own piece: an oldest-xmin
// horizon and a vacuum() that reclaims dead versions no live snapshot can see.
//
// Verified under python3 before shipping — BOTH the raw body AND the exported
// template-literal string (the lesson carried from ch06/ch07): VACUUM_SANDBOX
// builds up dead versions through a chain of updates, shows that a long-running
// reader PINS them (its old snapshot might still read them), vacuums what is
// safe, then closes the reader and vacuums the rest.

export const VACUUM_SANDBOX = `# A compact copy of the canonical MVCC store (§2-§5), extended with the one
# thing §6 needs: a VACUUM. Writes never overwrite -- they append a new version
# and stamp the old one's xmax with the deleting xid. So every UPDATE leaves a
# DEAD version behind. Those dead versions are the bill for never overwriting,
# and vacuum is how it gets paid: reclaim the tuples that no live snapshot
# could ever read again.

class MVCCStore:
    def __init__(self):
        self.tuples = []          # the version list; append-only
        self.next_xid = 1
        self.status = {}          # xid -> 'active' | 'committed' | 'aborted'
        self.live = []            # snapshots still open: [{'xid', 'snapshot'}]

    def begin(self):
        xid = self.next_xid
        self.next_xid += 1
        self.status[xid] = 'active'
        snapshot = {x for x, s in self.status.items() if s == 'active' and x != xid}
        snap = {'xid': xid, 'snapshot': snapshot}
        self.live.append(snap)    # register it: it pins the horizon while open
        return xid, snapshot

    def commit(self, xid):
        self.status[xid] = 'committed'
        self.live = [s for s in self.live if s['xid'] != xid]   # snapshot closes

    def abort(self, xid):
        self.status[xid] = 'aborted'
        self.live = [s for s in self.live if s['xid'] != xid]

    def _visible_xact(self, x, xid, snapshot):
        if x == xid:
            return True
        # x < xid is the snapshot's high-water mark: a txn that STARTED after me
        # (higher start-ordered xid) is invisible even once it commits.
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

    # --- the new part: the horizon, and the sweep ------------------------
    def oldest_xmin(self):
        # The horizon: the smallest xid any still-open snapshot might still
        # need to test. Each live snapshot cares about itself and every xid it
        # recorded as in-progress; the global horizon is the minimum over all
        # of them. With nobody live, everything is settled -> next_xid.
        if not self.live:
            return self.next_xid
        return min(min(s['snapshot'] | {s['xid']}) for s in self.live)

    def reclaimable(self, t):
        # A version is DEAD when its deleter committed. It is RECLAIMABLE only
        # when that deleter committed *below the horizon* -- older than every
        # live snapshot's view -- so no open snapshot can still see the version.
        if t['xmax'] is None:
            return False
        if self.status.get(t['xmax']) != 'committed':
            return False
        return t['xmax'] < self.oldest_xmin()

    def vacuum(self):
        horizon = self.oldest_xmin()
        before = len(self.tuples)
        freed = [t for t in self.tuples if self.reclaimable(t)]
        self.tuples = [t for t in self.tuples if not self.reclaimable(t)]
        return {'horizon': horizon, 'freed': len(freed),
                'remaining': len(self.tuples), 'was': before}


def show(db):
    for i, t in enumerate(db.tuples):
        live = t['xmax'] is None
        dead = (not live) and db.status.get(t['xmax']) == 'committed'
        tag = 'live' if live else ('DEAD' if dead else 'del?')
        mark = '  <- reclaimable' if db.reclaimable(t) else ('  <- PINNED' if dead else '')
        print(f"  slot {i}: {t['key']}={t['value']:<3} xmin={t['xmin']} "
              f"xmax={t['xmax'] if t['xmax'] is not None else '-'}  {tag}{mark}")


db = MVCCStore()

# Setup: one committed txn inserts two rows.
s, snap = db.begin(); db.write(s, 'a', 1, snap); db.write(s, 'b', 1, snap); db.commit(s)

# An UPDATE that commits *before* the long reader arrives -- it kills a=1, and
# because it settles below the horizon to come, vacuum will be free to reclaim.
u_pre, snap = db.begin(); db.write(u_pre, 'a', 2, snap); db.commit(u_pre)

# A writer opens... and so does a long-running reader, CONCURRENTLY. The reader
# records the writer as in-progress in its snapshot, freezing its view at a=2.
writer, wsnap = db.begin()
reader, rsnap = db.begin()
print("writer is xid", writer, "| long reader is xid", reader,
      "with snapshot", rsnap)

# The writer updates 'a' twice and commits -- all while the reader sits there
# (a report, an analytics query, a forgotten 'BEGIN'). The reader can't see any
# of it: the writer is in the reader's snapshot, so its commits stay invisible.
db.write(writer, 'a', 3, wsnap)
db.write(writer, 'a', 4, wsnap)
db.commit(writer)

print()
print("version list now (horizon = oldest_xmin =", db.oldest_xmin(), "):")
show(db)
print("the reader still reads a =", db.read(reader, 'a', rsnap),
      "-- which is WHY the versions the writer deleted can't be freed yet")

print()
r = db.vacuum()
print(f"vacuum with reader open: freed {r['freed']}, "
      f"{r['remaining']} versions remain (horizon {r['horizon']})")
show(db)

# The reader finally commits. Its snapshot closes, the horizon jumps forward,
# and the versions it was pinning are now unreachable by anyone.
print()
db.commit(reader)
r = db.vacuum()
print(f"reader done -> vacuum again: freed {r['freed']}, "
      f"{r['remaining']} versions remain (horizon {r['horizon']})")
show(db)
print()
print("Lesson: a long-running snapshot bloats the table. Vacuum can only")
print("reclaim what is dead AND below the oldest open snapshot's horizon --")
print("one forgotten transaction keeps a pile of dead rows alive.")`;
