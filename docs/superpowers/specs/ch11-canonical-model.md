# Chapter 11 — Canonical model (shared contract for all teammates)

One hand-built model runs through ch11: a simplified **ARIES recovery manager**, the `DB` class
below. Every Python sandbox is **self-contained** (Pyodide shares one runtime across the page —
each sandbox string redefines what it needs, copying forward a COMPACT version of this `DB`, the
way ch08/09/10 re-included prior structures). Use the SAME field/method names everywhere so the
chapter reads as one continuous build. Do NOT rename.

This is a deliberately simplified-but-FAITHFUL ARIES. Keep the structure exact: LSN, pageLSN,
prevLSN per-txn chain, recLSN in the dirty-page table, the three passes, and CLRs with
undoNextLSN. Consistency across sandboxes and scenes is the whole point.

## Vocabulary (the load-bearing ideas)
- **LSN** — Log Sequence Number; every log record has a unique, increasing one.
- **pageLSN** — stored on each page; the LSN of the most recent change applied to that page. Lets
  redo be **idempotent**: skip a logged change if the page already reflects it (`pageLSN >= lsn`).
- **prevLSN** — each log record points to the previous record of the SAME transaction (a backward
  per-txn chain), so undo can walk a transaction's changes in reverse.
- **WAL rule** — the log record describing a change reaches durable storage BEFORE the data page
  does, and a transaction's commit record is durable before it's reported committed. (In the model
  the `log` list is always durable; `disk` pages are only what was explicitly flushed.)
- **steal / no-force** (ch05): the buffer pool may write an UNCOMMITTED page to disk (**steal** →
  needs UNDO) and need NOT write a COMMITTED page at commit (**no-force** → needs REDO). This is
  why ARIES needs both passes.
- **DPT (dirty page table)** — `pid -> recLSN`, where recLSN is the LSN of the first log record
  that dirtied the page since it was last clean. redo starts at `min(recLSN)`.
- **ATT (active transaction table)** — `tid -> {status, lastLSN}`; status `'U'` (running/loser) or
  `'C'` (committed). lastLSN is the end of that txn's prevLSN chain.
- **CLR (compensation log record)** — written during undo; it is REDO-only (never undone) and
  carries `undoNextLSN` (the next thing to undo for that txn). CLRs make recovery **restartable**:
  if the machine crashes again mid-undo, redo of the CLRs replays the undo work already done.

## The model

```python
class DB:
    """A simplified ARIES recovery manager. `log` and `disk` survive a crash; `buf`,
    `att`, `dpt` are in-memory and lost. Recovery = analysis -> redo -> undo."""

    def __init__(self):
        self.log = []     # durable log: list of record dicts. Survives crash.
        self.lsn = 0
        self.disk = {}    # on-disk pages: pid -> {'val': v, 'pageLSN': lsn}. Survives crash.
        self.buf = {}     # in-memory pages: pid -> {'val': v, 'pageLSN': lsn}. LOST on crash.
        self.att = {}     # active txn table: tid -> {'status': 'U'|'C', 'lastLSN': lsn}
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
        self.log.append({'lsn': c, 'type': 'commit', 'tid': tid,
                         'prevLSN': self.att[tid]['lastLSN']})
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
        for r in self.log:
            if r['lsn'] < self.redoLSN or r['type'] not in ('update', 'clr'):
                continue
            pid = r['pid']
            if pid not in self.dpt or self.dpt[pid] > r['lsn']:
                continue                        # page not dirty / change predates recLSN
            page = self.disk.get(pid, {'val': None, 'pageLSN': 0})
            if page['pageLSN'] >= r['lsn']:
                continue                        # idempotent: page already has this change
            self.disk[pid] = {'val': r['after'], 'pageLSN': r['lsn']}   # reapply (CLR stores its new val in 'after')

    def _undo(self):                            # PASS 3: roll back losers, logging CLRs
        losers = {t for t, i in self.att.items() if i['status'] == 'U'}
        todo = {self.att[t]['lastLSN'] for t in losers if self.att[t]['lastLSN']}
        byLSN = {r['lsn']: r for r in self.log}
        while todo:
            lsn = max(todo); todo.discard(lsn)
            r = byLSN[lsn]
            if r['type'] == 'update':
                clr = self._next()
                self.log.append({'lsn': clr, 'type': 'clr', 'tid': r['tid'], 'pid': r['pid'],
                                 'after': r['before'],          # CLR re-applies the BEFORE image
                                 'undoNextLSN': r['prevLSN'], 'prevLSN': self.att[r['tid']]['lastLSN']})
                self.att[r['tid']]['lastLSN'] = clr
                self.disk[r['pid']] = {'val': r['before'], 'pageLSN': clr}
                nxt = r['prevLSN']
            elif r['type'] == 'clr':
                nxt = r['undoNextLSN']
            else:                               # commit/end: just follow the chain
                nxt = r.get('prevLSN', 0)
            if nxt:
                todo.add(nxt)
            else:
                e = self._next()
                self.log.append({'lsn': e, 'type': 'end', 'tid': r['tid'], 'prevLSN': lsn})
```

## Section extensions (copy the base, add/show ONLY that section's piece)
- **§1 CRASH_SANDBOX** — NO recovery manager yet. Hand-stage the disaster: T1 updates page A and
  COMMITS but its page was never flushed (no-force → committed change missing from disk); T2
  updates page B and its page WAS flushed but T2 never committed (steal → uncommitted change on
  disk). Print the on-disk state and show it is wrong both ways. Motivates redo (recover T1) + undo
  (reverse T2). Self-contained (plain dicts; no full DB needed).
- **§3 LOG_SANDBOX** — the WAL with LSNs: run a few updates, print the log records (lsn, type, tid,
  pid, before/after, prevLSN) and the per-txn prevLSN chain; show pageLSN on a page and state the
  write-ahead rule. Use the canonical `DB` (update/commit), no recovery yet.
- **§4 CHECKPOINT_SANDBOX** — build up some updates + flushes, print the DPT (pid→recLSN) and ATT
  (tid→status,lastLSN), then `checkpoint()` and show the snapshot in the log. Make the point: redo
  will start at `min(recLSN)`, NOT at LSN 1 — the checkpoint bounds replay.
- **§5 ANALYSIS_SANDBOX** — full `DB`: run a workload, `checkpoint()`, more work, `crash()`, then
  `_analysis()` only. Print the reconstructed ATT + DPT and the computed `redoLSN` and the loser
  set. Show analysis rebuilds the crash-time tables purely from the log.
- **§6 REDO_SANDBOX** — `_analysis()` then `_redo()`. Show "repeat history": EVERY change since
  redoLSN is replayed (winners AND losers), and the pageLSN check skips changes already on disk
  (print which records were applied vs skipped-as-idempotent). Disk now matches the pre-crash
  buffer exactly — including the losers' changes, which undo will remove next.
- **§7 UNDO_SANDBOX** — the complete `recover()`. Show undo rolling back the losers, writing a CLR
  per undone update (print the CLRs with undoNextLSN), and the final disk state: committed work
  present, uncommitted work reversed. BONUS: demonstrate restartability — `crash()` again partway
  and re-`recover()`; the CLRs make the re-run redo the already-done undo and finish cleanly (no
  double-undo). Assert the final disk values are correct.

## Scenes (mirror the model)
- **StealNoForceScene (Fig 11.1, §2)** — the 2×2 buffer-policy matrix (steal/no-steal ×
  force/no-force); each cell shows whether it needs REDO, UNDO, both, or neither; land on
  steal+no-force (fastest) as the one needing the full machinery. Interactive: toggle the policy,
  watch the redo/undo requirement light up. Ties to ch05's buffer pool.
- **LogAndCheckpointScene (Fig 11.2, §3-4)** — the log as a row of LSN'd records with the per-txn
  prevLSN chain drawn as arrows; pages carrying pageLSN; a checkpoint marker snapshotting the DPT +
  ATT; show how recLSN/redoLSN bounds where replay begins.
- **ThreePassesScene (Fig 11.3, HERO, §5-7)** — the crash falls on the log; then Analysis (rebuild
  ATT+DPT), Redo (sweep FORWARD from redoLSN, pages updating, idempotent skips), Undo (sweep
  BACKWARD over losers, writing CLRs) — the log/tables/pages lighting up pass by pass, ending with
  committed work persisted and uncommitted work reversed. The defining image of ARIES.
- **CLRScene (Fig 11.4, §7)** — undo writing CLRs, then a SECOND crash mid-undo; on restart the
  CLRs are redone (not re-undone), so recovery is idempotent/restartable. The subtle, satisfying
  payoff: recovery survives a crash during recovery.

## House rules (same as ch08/09/10 — non-negotiable)
- Components: `src/components/chapter-11/<Name>.tsx`, **default export, no props**, `client:visible`,
  wrapped in `<Figure number="11.x" caption>`. Cream palette ONLY via CSS vars
  (`--color-fig-bg/fg/muted/green/red/blue/orange`, `fig-card`, `fig-btn`, `fig-btn-primary/danger`).
  framer-motion ok. **390px reflow** (stack `flex-col sm:flex-row`, SVG `maxWidth:'100%' height:'auto'`
  inside `overflowX:auto`, controls `flex-wrap`, tap targets minHeight 38).
- Sandboxes: named-export template-literal strings in the assigned file. **Self-contained.**
  **python3-verify BOTH the raw body AND the exported template-literal string** (extract via tsx —
  what actually reaches Pyodide). No sql.js.
- **DEV-HARNESS GUARDRAIL (ENFORCED):** create NOTHING under `src/pages/`. Don't leave `astro dev` running.
- Figure numbers FROZEN: StealNoForceScene **11.1**, LogAndCheckpointScene **11.2**,
  ThreePassesScene **11.3** (HERO), CLRScene **11.4**.
- Reference templates: `src/components/chapter-08/DeadlockScene.tsx` (hero/animation/390px),
  `src/components/chapter-08/deadlock-sandboxes.ts` (sandbox style + compact self-contained copy).
- Run the FULL build (`npm run build`), not just `astro check` — MDX nesting errors only show in build.
