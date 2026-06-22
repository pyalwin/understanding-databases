// Chapter 11 — Recovery & ARIES. Sandboxes for §4 (checkpoints) and §5
// (the analysis pass).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string carries a
// COMPACT copy of the canonical `DB` (the simplified ARIES recovery manager
// from docs/superpowers/specs/ch11-canonical-model.md) — same field/method
// names everywhere so the chapter reads as one continuous build. No renaming.
//
// They continue the chapter's arc: §1 staged the disaster, §3 built the WAL
// with LSNs and the per-txn prevLSN chain. Here §4 adds the dirty-page table
// (recLSN) + the active-txn table and the fuzzy checkpoint that snapshots them;
// §5 crashes and runs ANALYSIS only, rebuilding those tables from the durable
// log. §6/§7 (redo + undo, owned by the redo/undo file) consume the ATT, DPT,
// redoLSN and loser set this file produces — identical field names.
//
// Every string verified under python3 before shipping — both as raw source AND
// by eval'ing the exported template literal (what actually reaches Pyodide):
//   CHECKPOINT_SANDBOX -> DPT (pid->recLSN) + ATT (tid->status,lastLSN), then
//                         checkpoint() snapshot in the log; redo starts at
//                         min(recLSN)=2, NOT lsn 1 (checkpoint bounds replay).
//   ANALYSIS_SANDBOX   -> crash() wipes the in-memory tables; _analysis()
//                         rebuilds the EXACT crash-time ATT + DPT from the log
//                         alone, plus redoLSN and the loser set.

export const CHECKPOINT_SANDBOX = `# CHECKPOINTS: bounding how far back recovery must replay
# A checkpoint writes a snapshot of two in-memory tables into the log:
#   DPT (dirty page table): pid -> recLSN, the LSN of the FIRST change that
#       dirtied a page since it was last clean. redo starts at min(recLSN).
#   ATT (active txn table):  tid -> {status, lastLSN}, the in-flight txns.
# Without a checkpoint, recovery would replay the log from lsn 1 -- the dawn of
# time. The checkpoint BOUNDS replay to the pages that might still be dirty.

class DB:
    """Compact ARIES manager -- just the pieces section 4 needs."""
    def __init__(self):
        self.log = []; self.lsn = 0
        self.disk = {}; self.buf = {}
        self.att = {}; self.dpt = {}

    def _next(self):
        self.lsn += 1; return self.lsn

    def _page(self, pid):                       # fault a page in on first touch
        if pid not in self.buf:
            d = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            self.buf[pid] = {'val': d['val'], 'pageLSN': d['pageLSN']}
        return self.buf[pid]

    def update(self, tid, pid, new_val):
        page = self._page(pid); lsn = self._next()
        self.log.append({'lsn': lsn, 'type': 'update', 'tid': tid, 'pid': pid,
                         'before': page['val'], 'after': new_val,
                         'prevLSN': self.att.get(tid, {}).get('lastLSN', 0)})
        page['val'] = new_val; page['pageLSN'] = lsn
        self.att.setdefault(tid, {'status': 'U', 'lastLSN': 0})['lastLSN'] = lsn
        self.att[tid]['status'] = 'U'
        if pid not in self.dpt:                 # recLSN = first change to dirty it
            self.dpt[pid] = lsn
        return lsn

    def commit(self, tid):
        c = self._next()
        self.log.append({'lsn': c, 'type': 'commit', 'tid': tid,
                         'prevLSN': self.att[tid]['lastLSN']})
        e = self._next()
        self.log.append({'lsn': e, 'type': 'end', 'tid': tid, 'prevLSN': c})
        del self.att[tid]

    def flush_page(self, pid):                  # STEAL: write a page to disk
        if pid in self.buf:                     # it becomes clean -> leaves the DPT
            self.disk[pid] = dict(self.buf[pid])
            self.dpt.pop(pid, None)

    def checkpoint(self):                       # fuzzy checkpoint: snapshot ATT + DPT
        k = self._next()
        self.log.append({'lsn': k, 'type': 'checkpoint',
                         'att': {t: dict(i) for t, i in self.att.items()},
                         'dpt': dict(self.dpt)})
        return k


def show_dpt(dpt):
    if not dpt:
        print("    (empty -- no dirty pages)"); return
    for pid in sorted(dpt):
        print("    page %s  recLSN=%d" % (pid, dpt[pid]))

def show_att(att):
    if not att:
        print("    (empty -- no active txns)"); return
    for tid in sorted(att):
        i = att[tid]
        print("    %s  status=%s  lastLSN=%d" % (tid, i['status'], i['lastLSN']))


db = DB()
print("=== a small workload across two transactions ===")
db.update("T1", "A", 100)     # lsn 1  -- dirties A
db.update("T1", "C", 300)     # lsn 2  -- dirties C
db.update("T2", "B", 200)     # lsn 3  -- dirties B
for r in db.log:
    print("  lsn %d  %-6s %s -> %s" % (r['lsn'], r['type'], r['pid'], r['after']))
print()

print("=== STEAL: the buffer pool flushes page A to disk ===")
db.flush_page("A")            # A is written + becomes CLEAN -> drops out of the DPT
print("  page A flushed -- now clean, dropped from the dirty page table")
print()

print("DIRTY PAGE TABLE (pid -> recLSN): pages whose changes may live only in memory")
show_dpt(db.dpt)
print("ACTIVE TXN TABLE (tid -> status,lastLSN): the in-flight transactions")
show_att(db.att)
print()

print("=== checkpoint(): snapshot both tables into the log ===")
db.checkpoint()               # lsn 4
snap = db.log[-1]
print("  checkpoint record at lsn %d" % snap['lsn'])
print("  snapshot ATT:", {t: (i['status'], i['lastLSN']) for t, i in snap['att'].items()})
print("  snapshot DPT:", snap['dpt'])
print()

start = min(db.dpt.values())
print("Where will REDO begin after a crash?")
print("  the log spans lsn 1 .. %d" % db.lsn)
print("  min(recLSN) over the dirty pages = %d" % start)
print("  ==> redo starts at lsn %d, NOT at lsn 1." % start)
print("  Page A's change (lsn 1) is already durable, so replay can skip it.")
print("  The checkpoint BOUNDS replay: recovery starts near the crash,")
print("  not at the dawn of time.")
`;

export const ANALYSIS_SANDBOX = `# ANALYSIS: rebuilding the crash-time tables from the durable log alone
# A crash wipes the in-memory ATT, DPT and buffer pool. Only the log and the
# pages already flushed to disk survive. Pass 1 of ARIES -- ANALYSIS -- scans
# the log forward from the last checkpoint and RECONSTRUCTS the exact ATT and
# DPT as they stood the instant the machine died, then computes:
#   redoLSN = min(recLSN)   -- where Pass 2 (redo) will begin
#   losers  = txns still 'U' (uncommitted) -- what Pass 3 (undo) rolls back

class DB:
    """Compact ARIES manager -- sections 4-5 (checkpoint + analysis)."""
    def __init__(self):
        self.log = []; self.lsn = 0
        self.disk = {}; self.buf = {}
        self.att = {}; self.dpt = {}

    def _next(self):
        self.lsn += 1; return self.lsn

    def _page(self, pid):
        if pid not in self.buf:
            d = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            self.buf[pid] = {'val': d['val'], 'pageLSN': d['pageLSN']}
        return self.buf[pid]

    def update(self, tid, pid, new_val):
        page = self._page(pid); lsn = self._next()
        self.log.append({'lsn': lsn, 'type': 'update', 'tid': tid, 'pid': pid,
                         'before': page['val'], 'after': new_val,
                         'prevLSN': self.att.get(tid, {}).get('lastLSN', 0)})
        page['val'] = new_val; page['pageLSN'] = lsn
        self.att.setdefault(tid, {'status': 'U', 'lastLSN': 0})['lastLSN'] = lsn
        self.att[tid]['status'] = 'U'
        if pid not in self.dpt:
            self.dpt[pid] = lsn
        return lsn

    def commit(self, tid):
        c = self._next()
        self.log.append({'lsn': c, 'type': 'commit', 'tid': tid,
                         'prevLSN': self.att[tid]['lastLSN']})
        e = self._next()
        self.log.append({'lsn': e, 'type': 'end', 'tid': tid, 'prevLSN': c})
        del self.att[tid]

    def flush_page(self, pid):
        if pid in self.buf:
            self.disk[pid] = dict(self.buf[pid])
            self.dpt.pop(pid, None)

    def checkpoint(self):
        k = self._next()
        self.log.append({'lsn': k, 'type': 'checkpoint',
                         'att': {t: dict(i) for t, i in self.att.items()},
                         'dpt': dict(self.dpt)})
        return k

    def crash(self):                            # in-memory state vanishes
        self.buf, self.att, self.dpt = {}, {}, {}

    def _analysis(self):                        # PASS 1: rebuild ATT + DPT, redoLSN
        att, dpt, start = {}, {}, 0
        for i, r in enumerate(self.log):
            if r['type'] == 'checkpoint':       # restart from the LAST checkpoint
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


def fmt_att(att):
    return {t: (att[t]['status'], att[t]['lastLSN']) for t in sorted(att)}

def fmt_dpt(dpt):
    return {p: dpt[p] for p in sorted(dpt)}


db = DB()
print("=== workload: T1 commits; T2 and T3 are mid-flight ===")
db.update("T1", "A", 10)      # lsn 1
db.update("T1", "B", 20)      # lsn 2
db.commit("T1")               # lsn 3 commit, lsn 4 end  -> T1 is a WINNER
db.update("T2", "C", 30)      # lsn 5
db.flush_page("A")            # A clean -> leaves the DPT
db.flush_page("B")            # B clean -> leaves the DPT
db.checkpoint()               # lsn 6: snapshot ATT={T2}, DPT={C}
db.update("T2", "A", 11)      # lsn 7  -- re-dirties A AFTER the checkpoint
db.update("T3", "D", 40)      # lsn 8  -- T3 first appears after the checkpoint
print("  the log now spans lsn 1 .. %d" % db.lsn)
print()

print("The LIVE in-memory tables, the instant before the crash:")
live_att = fmt_att(db.att)
live_dpt = fmt_dpt(db.dpt)
print("  ATT:", live_att)
print("  DPT:", live_dpt)
print()

print("=== CRASH -- buf, att, dpt all vanish ===")
db.crash()
print("  in-memory ATT:", db.att, " DPT:", db.dpt, " (gone)")
print()

print("=== _analysis(): rebuild the tables from the durable log alone ===")
db._analysis()
rebuilt_att = fmt_att(db.att)
rebuilt_dpt = fmt_dpt(db.dpt)
losers = sorted(t for t in db.att if db.att[t]['status'] == 'U')
print("  reconstructed ATT:", rebuilt_att)
print("  reconstructed DPT:", rebuilt_dpt)
print("  redoLSN =", db.redoLSN, "(= min recLSN -- where redo will begin)")
print("  losers  =", losers, "(status 'U' -- undo will roll these back)")
print()

assert rebuilt_att == live_att, "ATT mismatch!"
assert rebuilt_dpt == live_dpt, "DPT mismatch!"
print("Analysis reconstructed the crash-time ATT and DPT EXACTLY -- purely from")
print("the log. T1 committed before the checkpoint, so it never reappears (a")
print("winner). T2 and T3 are the losers. redoLSN = %d bounds the redo pass:" % db.redoLSN)
print("the checkpoint let analysis skip everything before lsn 6.")
`;
