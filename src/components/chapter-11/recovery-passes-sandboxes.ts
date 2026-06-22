// Chapter 11 — Recovery & ARIES. Sandboxes for §6 (redo) and §7 (undo + CLRs).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// everything it needs — no cross-sandbox state. Per the ch11 canonical model,
// each carries a COMPACT copy of the same `DB` (a simplified-but-faithful ARIES
// recovery manager) so it stands alone while reading continuous with the
// chapter. Field/method names are IDENTICAL to the canon and to §4/§5's analysis
// sandboxes (att, dpt, redoLSN, prevLSN, pageLSN, recLSN, undoNextLSN): the
// whole point of the chapter is one continuous build.
//
// The two passes are lightly instrumented with print()s so you can WATCH the
// decisions — the structure and names are otherwise verbatim canon.
//
// Both strings verified under python3 before shipping (raw body AND the exported
// template-literal string, the lesson carried from ch06–ch10):
//   REDO_SANDBOX -> analysis then redo. "Repeat history": every change since
//                   redoLSN replayed (winners AND losers); the pageLSN check
//                   skips what disk already has. Disk ends == pre-crash buffer.
//   UNDO_SANDBOX -> the full recover(): analysis -> redo -> undo. Undo rolls the
//                   losers back along prevLSN, writing a CLR (with undoNextLSN)
//                   per undone update. Then the payoff: a SECOND crash MID-UNDO,
//                   and recovery resumes exactly where it left off — CLRs are
//                   REDONE, not re-undone. No double-undo. Asserts the disk.
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

// The shared compact DB, reused verbatim by both sandboxes below. The only
// additions vs. a silent canon: print()s inside _redo/_undo, and an optional
// `crash_after` on _undo to simulate a crash mid-undo (defaults to None, so
// recover() is unchanged).
const DB_MODEL = `class DB:
    """A simplified ARIES recovery manager. \`log\` and \`disk\` survive a crash;
    \`buf\`, \`att\`, \`dpt\` are in-memory and lost. recover() = analysis -> redo -> undo."""

    def __init__(self):
        self.log = []     # durable log: list of record dicts. Survives crash.
        self.lsn = 0
        self.disk = {}    # on-disk pages: pid -> {'val', 'pageLSN'}. Survives crash.
        self.buf = {}     # in-memory pages: pid -> {'val', 'pageLSN'}. LOST on crash.
        self.att = {}     # active txn table: tid -> {'status': 'U'|'C', 'lastLSN'}
        self.dpt = {}     # dirty page table: pid -> recLSN

    def _next(self):
        self.lsn += 1
        return self.lsn

    def _page(self, pid):                       # fault a page into the buffer on first touch
        if pid not in self.buf:
            d = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            self.buf[pid] = {'val': d['val'], 'pageLSN': d['pageLSN']}
        return self.buf[pid]

    # --- normal operation -------------------------------------------------
    def update(self, tid, pid, new_val):
        page = self._page(pid)
        lsn = self._next()
        self.log.append({'lsn': lsn, 'type': 'update', 'tid': tid, 'pid': pid,
                         'before': page['val'], 'after': new_val,
                         'prevLSN': self.att.get(tid, {}).get('lastLSN', 0)})
        page['val'] = new_val
        page['pageLSN'] = lsn
        self.att.setdefault(tid, {'status': 'U', 'lastLSN': 0})['lastLSN'] = lsn
        self.att[tid]['status'] = 'U'
        if pid not in self.dpt:                 # recLSN = first change to dirty this page
            self.dpt[pid] = lsn
        return lsn

    def commit(self, tid):
        c = self._next()
        self.log.append({'lsn': c, 'type': 'commit', 'tid': tid, 'prevLSN': self.att[tid]['lastLSN']})
        e = self._next()
        self.log.append({'lsn': e, 'type': 'end', 'tid': tid, 'prevLSN': c})
        del self.att[tid]                       # committed + ended: leaves the table

    def flush_page(self, pid):                  # STEAL: write a (maybe uncommitted) page to disk
        if pid in self.buf:                     # (WAL already satisfied: the log record exists)
            self.disk[pid] = dict(self.buf[pid])
            self.dpt.pop(pid, None)             # clean again

    def checkpoint(self):                       # fuzzy checkpoint: snapshot ATT + DPT into the log
        k = self._next()
        self.log.append({'lsn': k, 'type': 'checkpoint',
                         'att': {t: dict(i) for t, i in self.att.items()},
                         'dpt': dict(self.dpt)})
        return k

    def crash(self):                            # in-memory state vanishes; log + disk remain
        self.buf, self.att, self.dpt = {}, {}, {}

    # --- recovery: the three passes --------------------------------------
    def recover(self):
        self._analysis(); self._redo(); self._undo()

    def _analysis(self):                        # PASS 1: rebuild ATT + DPT, find redoLSN + losers
        att, dpt, start = {}, {}, 0
        for i, r in enumerate(self.log):
            if r['type'] == 'checkpoint':
                att = {t: dict(x) for t, x in r['att'].items()}
                dpt = dict(r['dpt']); start = i + 1
        for r in self.log[start:]:
            t = r.get('tid')
            if r['type'] in ('update', 'clr'):
                att.setdefault(t, {'status': 'U', 'lastLSN': 0})
                att[t]['lastLSN'] = r['lsn']; att[t]['status'] = 'U'
                if r['pid'] not in dpt:
                    dpt[r['pid']] = r['lsn']
            elif r['type'] == 'commit':
                att.setdefault(t, {'status': 'U', 'lastLSN': 0})
                att[t]['status'] = 'C'; att[t]['lastLSN'] = r['lsn']
            elif r['type'] == 'end':
                att.pop(t, None)
        self.att, self.dpt = att, dpt
        self.redoLSN = min(dpt.values()) if dpt else self.lsn + 1

    def _redo(self):                            # PASS 2: repeat history from redoLSN
        print("REDO from LSN", self.redoLSN, "-- repeat history (winners AND losers):")
        for r in self.log:
            if r['lsn'] < self.redoLSN or r['type'] not in ('update', 'clr'):
                continue
            pid = r['pid']
            tag = "LSN %-2d %-6s %s %s=%s" % (r['lsn'], r['type'], r['tid'], pid, r['after'])
            if pid not in self.dpt or self.dpt[pid] > r['lsn']:
                print("  skip   %-26s (page not dirty / change predates recLSN)" % tag)
                continue                        # page not dirty / change predates recLSN
            page = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            if page['pageLSN'] >= r['lsn']:
                print("  skip   %-26s (idempotent: disk pageLSN %d >= %d)" % (tag, page['pageLSN'], r['lsn']))
                continue                        # idempotent: page already has this change
            self.disk[pid] = {'val': r['after'], 'pageLSN': r['lsn']}   # reapply (CLR stores its new val in 'after')
            print("  APPLY  %-26s (disk pageLSN %d < %d)" % (tag, page['pageLSN'], r['lsn']))

    def _undo(self, crash_after=None):          # PASS 3: roll back losers, logging CLRs
        losers = {t for t, i in self.att.items() if i['status'] == 'U'}
        print("UNDO losers:", sorted(losers))
        todo = {self.att[t]['lastLSN'] for t in losers if self.att[t]['lastLSN']}
        byLSN = {r['lsn']: r for r in self.log}
        written = 0
        while todo:
            lsn = max(todo); todo.discard(lsn)  # always undo the highest LSN next
            r = byLSN[lsn]
            if r['type'] == 'update':
                clr = self._next()
                self.log.append({'lsn': clr, 'type': 'clr', 'tid': r['tid'], 'pid': r['pid'],
                                 'after': r['before'],          # CLR re-applies the BEFORE image
                                 'undoNextLSN': r['prevLSN'], 'prevLSN': self.att[r['tid']]['lastLSN']})
                self.att[r['tid']]['lastLSN'] = clr
                self.disk[r['pid']] = {'val': r['before'], 'pageLSN': clr}
                print("  undo LSN %-2d (%s %s=%s) -> CLR LSN %d: %s=%s, undoNextLSN=%d"
                      % (lsn, r['tid'], r['pid'], r['after'], clr, r['pid'], r['before'], r['prevLSN']))
                written += 1
                nxt = r['prevLSN']
                if crash_after is not None and written >= crash_after:
                    print("  *** CRASH mid-undo after %d CLR(s) -- log+disk durable, in-memory lost ***" % written)
                    return
            elif r['type'] == 'clr':            # already-undone work: redo-only, jump past it
                print("  CLR  LSN %-2d already undid %s -> follow undoNextLSN=%d (never re-undo)"
                      % (lsn, r['pid'], r['undoNextLSN']))
                nxt = r['undoNextLSN']
            else:                               # commit/end: just follow the chain
                nxt = r.get('prevLSN', 0)
            if nxt:
                todo.add(nxt)
            else:
                e = self._next()
                self.log.append({'lsn': e, 'type': 'end', 'tid': r['tid'], 'prevLSN': lsn})
                print("  %s fully undone -> end LSN %d" % (r['tid'], e))


def build():
    """The shared crash scenario. Two transactions, four pages:
      T1 (WINNER) commits; page A never flushed (no-force) -> redo must recover it.
      T2 (LOSER)  never commits; page B was flushed (steal)  -> undo must reverse it.
    A fuzzy checkpoint sits in the middle; one winner page (C) is flushed AFTER
    its update so redo can show an idempotent skip; one loser page (D) is never
    flushed so redo replays it (repeat history) before undo takes it back."""
    db = DB()
    db.update('T1', 'A', 10)   # LSN 1  winner   -- A never flushed -> REDO recovers it
    db.update('T2', 'B', 20)   # LSN 2  loser
    db.flush_page('B')         #        STEAL    -- uncommitted B=20 lands on disk
    db.checkpoint()            # LSN 3  snapshot ATT={T1,T2}, DPT={A}
    db.update('T1', 'C', 30)   # LSN 4  winner
    db.flush_page('C')         #        committed-winner change C=30 already on disk
    db.update('T2', 'D', 40)   # LSN 5  loser    -- D never flushed
    db.commit('T1')            # LSN 6 commit, LSN 7 end  -> T1 is durable
    # T2 never commits. Then the machine dies.
    return db
`;

// §6 — REDO: repeat history forward from redoLSN.
export const REDO_SANDBOX = `${DB_MODEL}
# ---------------------------------------------------------------------------
# REDO repeats history: it replays EVERY logged change since redoLSN -- winners
# AND losers alike -- so the disk is brought back to its exact pre-crash state.
# The pageLSN stamped on each page makes the replay IDEMPOTENT: if the disk
# already reflects a change (pageLSN >= the record's LSN), redo skips it.

db = build()
pre_crash_buf = {p: db.buf[p]['val'] for p in sorted(db.buf)}
print("pre-crash buffer (what was truly in memory):", pre_crash_buf)
print("on disk at crash time:", {p: db.disk[p]['val'] for p in sorted(db.disk)})
print("  -> A (committed) MISSING from disk (no-force); B,D (uncommitted) issues for undo later")
print()

db.crash()                                  # buf/att/dpt vanish; log + disk remain
db._analysis()                              # rebuild the crash-time tables from the log
print("after ANALYSIS:  redoLSN =", db.redoLSN,
      "| DPT =", db.dpt, "| losers =", sorted(t for t, i in db.att.items() if i['status'] == 'U'))
print()

db._redo()                                  # PASS 2
print()
redone = {p: db.disk[p]['val'] for p in sorted(db.disk)}
print("disk after REDO:", redone)
print("pre-crash buffer:", pre_crash_buf)

# "Repeat history" really means EXACTLY equal -- including the losers' B and D,
# which only undo will remove. Redo's job is to recreate the pre-crash memory.
assert redone == pre_crash_buf, "redo must reproduce the pre-crash buffer exactly"
print()
print("REDO reproduced the pre-crash buffer EXACTLY (losers' changes included).")
print("Idempotent skips: C was already on disk (pageLSN check); A and D were replayed.")
print("Next: undo reverses the losers (B, D) along their prevLSN chains.")`;

// §7 — UNDO + CLRs, then the restartability payoff (a second crash mid-undo).
export const UNDO_SANDBOX = `${DB_MODEL}
# ---------------------------------------------------------------------------
# The full recover(): analysis -> redo -> undo. UNDO walks each loser BACKWARD
# along its prevLSN chain, and for every update it reverses it writes a
# COMPENSATION LOG RECORD (CLR). A CLR is redo-only -- it is never itself undone
# -- and it carries undoNextLSN, the next thing left to undo for that txn. That
# one field is what makes recovery RESTARTABLE: crash again mid-undo and the
# restart redoes the CLRs (idempotent) and resumes at undoNextLSN -- no work is
# repeated, nothing is undone twice.

db = build()
db.crash()
print("=== FIRST RECOVERY (analysis -> redo -> undo) ===")
db._analysis()
db._redo()
print()
db._undo()                                  # PASS 3: roll back the losers
print()
final = {p: db.disk[p]['val'] for p in sorted(db.disk)}
print("CLRs written:", [(r['lsn'], r['pid'], r['after'], 'undoNextLSN=%d' % r['undoNextLSN'])
                        for r in db.log if r['type'] == 'clr'])
print("final disk:", final)
assert final == {'A': 10, 'B': None, 'C': 30, 'D': None}    # committed kept, uncommitted reversed
print("committed work present (A=10, C=30); uncommitted reversed (B, D back to None). OK")
print()

# --- RESTARTABILITY: crash DURING recovery, then recover again ---------------
print("=== A SECOND CRASH STRIKES MID-UNDO ===")
db2 = build()
db2.crash()
db2._analysis()
db2._redo()
print()
db2._undo(crash_after=1)                     # write ONE CLR, then the machine dies again
clrs_before = [r['lsn'] for r in db2.log if r['type'] == 'clr']
print("CLRs on disk so far:", clrs_before, "(undo of T2 only half done)")
print("disk mid-undo:", {p: db2.disk[p]['val'] for p in sorted(db2.disk)})
print()

print("--- RESTART: recover() again ---")
db2.crash()                                  # in-memory lost again; log (incl. the CLR) survives
db2.recover()                                # analysis -> redo (replays the CLR!) -> undo (resumes)
print()
clrs_after = [r['lsn'] for r in db2.log if r['type'] == 'clr']
print("CLRs total after restart:", clrs_after)
print("final disk:", {p: db2.disk[p]['val'] for p in sorted(db2.disk)})

# The restart REDID the first CLR (idempotent, page already reflected it) and
# resumed undo at its undoNextLSN -- so the second crash cost nothing.
assert {p: db2.disk[p]['val'] for p in sorted(db2.disk)} == {'A': 10, 'B': None, 'C': 30, 'D': None}
assert len(clrs_after) == 2, "exactly one CLR per undone update -- no double-undo!"
print()
print("Restartable: the half-done undo was NOT repeated. CLRs are redone, never")
print("re-undone, and undoNextLSN told the restart exactly where to resume.")`;
