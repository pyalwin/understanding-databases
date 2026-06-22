# Chapter 09 — Canonical MVCC model (shared contract for all teammates)

Every Python sandbox in ch09 is **self-contained** (Pyodide shares one runtime across the page,
so each sandbox string redefines everything it needs — no cross-sandbox state). To keep the
chapter reading as one continuous build, **every sandbox uses the SAME class/method names and the
SAME visibility rule**, copying forward a COMPACT version of this canonical store (the way ch08's
DEADLOCK_SANDBOX re-includes a compact copy of the §4 lock manager).

This is a deliberately simplified **Postgres-style xmin/xmax** model. Do NOT "improve" the names or
signatures — consistency across sandboxes and scenes is the whole point.

## The model

```python
class MVCCStore:
    """A multi-version store. Writes never overwrite: they append a new version
    of the row and mark the old one deleted. Each version (a 'tuple') carries:
        key   - the logical row id
        value - the column value
        xmin  - the xid of the transaction that CREATED this version
        xmax  - the xid of the transaction that DELETED it (None = still live)
    A transaction sees a version iff its creator is visible to the txn's snapshot
    and its deleter is not. That single rule is all of MVCC reads."""

    def __init__(self):
        self.tuples = []          # the version list; append-only, never overwritten in place
        self.next_xid = 1
        self.status = {}          # xid -> 'active' | 'committed' | 'aborted'

    def begin(self):
        xid = self.next_xid
        self.next_xid += 1
        self.status[xid] = 'active'
        # The snapshot: the set of OTHER xids still in progress right now. A version
        # created by an xid in this set is invisible even if it later commits --
        # that is what freezes the txn's view at its start instant.
        snapshot = {x for x, s in self.status.items() if s == 'active' and x != xid}
        return xid, snapshot

    def commit(self, xid):
        self.status[xid] = 'committed'

    def abort(self, xid):
        self.status[xid] = 'aborted'

    def _visible_xact(self, x, xid, snapshot):
        # Visible to (xid, snapshot) iff it's me, or it had already COMMITTED at
        # the instant my snapshot was taken. "Committed as of my snapshot" means:
        #   - committed, AND
        #   - it started before me (x < xid -- xids are handed out in start
        #     order, so a larger xid began later), AND
        #   - it wasn't still in progress when I began (x not in snapshot).
        # The `x < xid` clause is the snapshot's HIGH-WATER MARK. Without it, a
        # transaction that STARTS after me and commits before I next read would
        # wrongly become visible -- my snapshot wouldn't be frozen and my reads
        # wouldn't repeat. (Real Postgres stores this ceiling as the snapshot's
        # xmax; here, monotonic xids let us express it as a single comparison.)
        if x == xid:
            return True
        return self.status.get(x) == 'committed' and x < xid and x not in snapshot

    def visible(self, t, xid, snapshot):
        # Creator must be visible; deleter must NOT be.
        if not self._visible_xact(t['xmin'], xid, snapshot):
            return False
        if t['xmax'] is not None and self._visible_xact(t['xmax'], xid, snapshot):
            return False
        return True

    def read(self, xid, key, snapshot):
        for t in reversed(self.tuples):          # newest version first
            if t['key'] == key and self.visible(t, xid, snapshot):
                return t['value']
        return None

    def write(self, xid, key, value, snapshot):
        # Mark the version I currently see as deleted by me, then append a new one.
        for t in reversed(self.tuples):
            if t['key'] == key and self.visible(t, xid, snapshot):
                t['xmax'] = xid
                break
        self.tuples.append({'key': key, 'value': value, 'xmin': xid, 'xmax': None})
```

## Extensions each section adds (copy the base, then add ONLY its piece)

- **§2 VERSIONS_SANDBOX** — introduce the store; show a write appending a 2nd version and
  `tuples` growing while the old version stays. Print the version list with xmin/xmax. (May
  use a trivial single-txn or auto-commit framing — the point is "append, don't overwrite".)
- **§3 VISIBILITY_SANDBOX** — two snapshots taken at different times read the SAME key and get
  DIFFERENT values, purely from the visibility rule. Print, for one version, why it is/ isn't
  visible to each snapshot.
- **§4 SNAPSHOT_SANDBOX** — snapshot isolation end to end + **first-committer-wins**: two
  concurrent txns write the same key; the first to commit wins, the second must **abort** on a
  write-write conflict. Add a check in `write` (or a wrapper) that detects the conflict: the
  version I'm about to delete already has an xmax set by a txn that committed after my snapshot
  (or another live version of my key was created outside my snapshot) → raise/abort.
- **§5 WRITESKEW_SANDBOX** — the doctors-on-call invariant ("at least one on call"). Two txns,
  same snapshot, each sees 2 on call, each takes a DIFFERENT doctor off call. No write-write
  conflict (different rows!), both commit, invariant violated. Then one line on how SSI /
  serializable would catch it.
- **§6 VACUUM_SANDBOX** — dead versions accumulate. A version is **dead/reclaimable** when its
  xmax is committed AND no still-active snapshot could see it (its xmax committed before the
  oldest live snapshot). `vacuum()` removes reclaimable tuples and reports bytes/rows freed.

## Scenes mirror the same model
- **VersionChainScene (Fig 9.1, HERO, §3)** — a row's version chain (versions with xmin/xmax) and
  a reader's snapshot sliding a timeline, lighting up exactly which version each snapshot sees.
- **SnapshotScene (Fig 9.2, §4)** — two concurrent txns on a timeline; each reads its snapshot;
  show readers-don't-block-writers and first-committer-wins.
- **WriteSkewScene (Fig 9.3, §5)** — the doctors anomaly: two snapshots, both checks pass, both
  write, invariant breaks.
- **VacuumScene (Fig 9.4, §6)** — a heap page filling with dead versions; vacuum sweeps the ones
  no snapshot can see.

## House rules (from ch04/05/08 specs — non-negotiable)
- Components: `src/components/chapter-09/<Name>.tsx`, **default export, no props**, `client:visible`,
  wrapped in `<Figure number="9.x" caption="…">`. Cream palette ONLY via CSS vars
  (`--color-fig-bg`, `--color-fig-fg`, `--color-fig-muted`, `--color-fig-green`, `--color-fig-red`,
  `--color-fig-blue`, `--color-fig-orange`, `fig-card`, `fig-btn`, `fig-btn-primary`,
  `fig-btn-danger`). framer-motion ok. **Must reflow clean at 390px** (stack lanes, scroll/scale
  SVG inside the figure).
- Sandboxes: named exports of template-literal strings in the assigned file. **Self-contained.**
  **`python3`-verify BOTH the raw body AND the exported template-literal string** (eval what
  actually reaches Pyodide — a lesson from ch06/ch07). No sql.js.
- **DEV-HARNESS GUARDRAIL (ENFORCED):** do NOT create ANY file under `src/pages/`. `ls src/pages/`
  must show only `index.astro`, `chapters/index.astro`, `chapters/[slug].astro`. Don't leave
  `astro dev` running.
- Figure numbers are FROZEN: VersionChainScene **9.1**, SnapshotScene **9.2**, WriteSkewScene
  **9.3**, VacuumScene **9.4**.
- Reference templates to match for structure/voice/quality: `src/components/chapter-08/DeadlockScene.tsx`
  (hero/animation/390px), `src/components/chapter-08/deadlock-sandboxes.ts` (sandbox style + the
  "compact self-contained copy" pattern).
