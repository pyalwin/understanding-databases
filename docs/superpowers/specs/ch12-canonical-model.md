# Chapter 12 — Canonical model (shared contract for all teammates)

One hand-built model runs through ch12: a simplified **two-phase commit (2PC)** harness —
a `Coordinator` driving a distributed transaction across several `Participant`s. Every Python
sandbox is **self-contained** (Pyodide shares one runtime across the page — each sandbox string
redefines what it needs, copying forward a COMPACT version of the model below, the way
ch08/09/10/11 re-included prior structures). Use the SAME field/method names everywhere so the
chapter reads as one continuous build. Do NOT rename.

This is a deliberately simplified-but-FAITHFUL 2PC. Keep the structure exact: a **prepare/vote**
phase and a **decide/broadcast** phase; **durable logs** on every node (the coordinator's
decision log is the source of truth); the **in-doubt / prepared** state that holds locks; and the
**blocking** window when the coordinator dies after PREPARE. Consistency across sandboxes and
scenes is the whole point.

## Continuity (callbacks — weave these in, do not belabor)
- **ch11 ARIES is the spine:** 2PC is a *recovery protocol*. Each node force-writes a log record
  to durable storage BEFORE it acts on it — the same write-ahead rule as ch11. On restart each node
  replays its log to recover its 2PC state, exactly as ARIES replays to recover page state.
- **ch02 WAL:** "commit = a durable log record." 2PC's commit point is the coordinator's durable
  `commit` decision record — the distributed analogue of ch02's local commit record.
- **ch10 group commit:** the coordinator's decision is one durable log force; the same fsync
  discipline, now gating a *cluster* of nodes rather than one.
- **ch08/09 locks:** a prepared participant keeps its locks held until the verdict arrives — which
  is exactly why blocking is so painful (held locks block everyone else).

## Vocabulary (the load-bearing ideas)
- **Atomic commit across machines** — a transaction spanning N nodes must end with ALL of them
  committed or ALL aborted, never a torn mix, even if nodes crash or the network drops.
- **Coordinator** — the node that runs the protocol: collects votes, makes THE decision, broadcasts it.
- **Participant** (cohort / resource manager) — a node holding part of the data; it votes and obeys.
- **Phase 1 — prepare/vote:** coordinator asks each participant to PREPARE; a participant does the
  work, holds its locks, force-writes a durable `prepared` record, and votes **YES** — or votes
  **NO** and aborts locally.
- **Phase 2 — decide/broadcast:** coordinator commits iff **unanimous YES**, force-writes the
  decision to its durable log (this record IS the commit point), then tells every prepared
  participant to apply it.
- **Prepared / in-doubt** — after voting YES a participant has surrendered the right to abort
  unilaterally; it MUST hold its locks and wait for the verdict. This is the dangerous state.
- **The blocking problem (HERO tension)** — if the coordinator crashes AFTER participants prepared
  but BEFORE they learn the decision, the prepared participants are stuck: they cannot commit (maybe
  someone voted NO) and cannot abort (maybe everyone voted YES and the coordinator already decided
  commit). They block — holding locks — until the coordinator returns. 2PC is *not* non-blocking.
- **Decision log / source of truth** — the coordinator's durable decision record. On restart it is
  re-read and re-broadcast; an in-doubt participant asks the coordinator for it. Recovery is
  idempotent: re-broadcasting a decision a participant already applied is a harmless no-op.
- **Presumed abort** — if recovery finds no decision record for a txn, the outcome is *abort*
  (the coordinator never committed), so coordinators needn't log aborts to remember them.
- **3PC** — three-phase commit inserts a `pre-commit` phase so a timed-out participant can finish
  without the coordinator, removing blocking UNDER CRASHES — but a **network partition** splits the
  cluster into groups that decide differently (split-brain). 3PC trades blocking for unsafety; it is
  not a real fix. The real answer is **consensus** (Paxos/Raft), handed off to later material.

## The model

```python
class Participant:
    """One node holding part of the data. `log` is DURABLE (survives a crash);
    `locks` is in-memory (LOST on a crash). Built on ch11's WAL: a YES vote is
    real only once the 'prepared' record is on durable storage."""

    def __init__(self, name):
        self.name = name
        self.log = []          # durable: list of {'tid','st'} records. Survives crash.
        self.locks = False     # in-memory: locks held while prepared. LOST on crash.

    def status(self, tid):                      # derive state purely from the durable log
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'new'    # 'new'|'prepared'|'committed'|'aborted'

    def prepare(self, tid, vote_yes=True):      # PHASE 1
        if not vote_yes:                        # can't / won't -> vote NO, abort locally
            self.log.append({'tid': tid, 'st': 'aborted'})
            return 'NO'
        self.locks = True                       # hold the locks for this txn...
        self.log.append({'tid': tid, 'st': 'prepared'})   # WAL: durable BEFORE voting YES
        return 'YES'                            # now IN-DOUBT: cannot abort unilaterally

    def finish(self, tid, decision):            # PHASE 2: apply the coordinator's verdict
        self.log.append({'tid': tid, 'st': decision})     # 'committed' | 'aborted', durable
        self.locks = False                      # fate sealed -> release the locks
        return decision

    def crash(self):                            # in-memory state vanishes; self.log survives
        self.locks = False


class Coordinator:
    """Drives one distributed transaction. `log` is the DURABLE decision log -- the
    single source of truth for the outcome."""

    def __init__(self, name='C'):
        self.name = name
        self.log = []          # durable: the decision records. Survives crash.

    def decision(self, tid):                    # the committed verdict, or 'none' if undecided
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'none'   # 'none'|'committed'|'aborted'

    def run(self, tid, participants, votes=None):
        votes = votes or {p.name: 'YES' for p in participants}
        # PHASE 1 -- voting: ask everyone to prepare; collect votes.
        replies = [p.prepare(tid, votes.get(p.name, 'YES') == 'YES') for p in participants]
        # DECIDE: commit iff UNANIMOUS yes. Force the decision to the durable log
        # BEFORE telling anyone -- THIS record is the commit point.
        verdict = 'committed' if all(r == 'YES' for r in replies) else 'aborted'
        self.log.append({'tid': tid, 'st': verdict})
        # PHASE 2 -- broadcast: every prepared participant applies the verdict.
        for p in participants:
            if p.status(tid) == 'prepared':
                p.finish(tid, verdict)
        return verdict

    def recover(self, tid, participants):       # restart: re-broadcast from the decision log
        d = self.decision(tid)
        if d == 'none':                         # never decided -> PRESUMED ABORT
            d = 'aborted'
            self.log.append({'tid': tid, 'st': d})
        for p in participants:                  # idempotent: re-applying a known verdict is a no-op
            if p.status(tid) == 'prepared':
                p.finish(tid, d)
        return d
```

## Section extensions (copy the base, add/show ONLY that section's piece)
- **§2 NAIVE_SANDBOX** — NO coordinator yet. Show why "just commit on each node independently"
  fails: two nodes, plain dicts; node 1 commits its half, node 2 hits an error and aborts its half.
  Print the torn state (half the transfer applied) and name it: there is no point at which both
  nodes agreed. Motivates the need for a *vote then decide* protocol. Self-contained (plain dicts).
- **§3 PREPARE_SANDBOX** — the canonical `Coordinator` + `Participant`. Run the happy path
  (everyone votes YES → global commit); print the two phases (prepare→votes, decide→broadcast) and
  each node's log. Then run it again with ONE participant voting NO → global ABORT, no torn state.
  Show unanimity is required, and that the coordinator's durable decision is the commit point.
- **§4 LOGGING_SANDBOX** — focus on the DURABLE LOG records each node writes, in order, and tie to
  ch11: a participant force-writes `prepared` (its redo+undo promise) BEFORE voting YES; the
  coordinator force-writes the `committed` decision BEFORE broadcasting (that force IS the commit,
  ch02/ch10); a participant force-writes `committed` when it applies. Print the interleaved durable
  writes and mark the exact line that is "the commit point." 2PC = a recovery protocol on WAL.
- **§5 BLOCKING_SANDBOX** — the hero disaster. All participants prepare and vote YES (in-doubt,
  locks held), then the COORDINATOR CRASHES before logging/broadcasting a decision. Show the
  participants are STUCK: each is `prepared`, still holding locks, and cannot decide alone — commit
  (maybe someone voted NO) and abort (maybe the coordinator already chose commit) are both unsafe.
  Print their held locks and in-doubt status. 2PC blocks. (Use `crash()` on the coordinator: drop
  its in-memory driver but it has NOT written a decision.)
- **§6 RECOVERY_SANDBOX** — `recover()`. Two cases from one crash point: (a) the coordinator DID
  force a `committed` decision before dying → on restart it re-reads the decision log and
  re-broadcasts; prepared participants commit; locks release. (b) the coordinator crashed BEFORE
  deciding → **presumed abort**: recovery writes `aborted` and broadcasts it. Show an in-doubt
  participant learning the outcome by asking the coordinator. BONUS: run `recover()` TWICE and
  assert the second is a no-op (idempotent / restartable, like ch11's CLRs). The decision log is the
  source of truth.
- **§7 THREEPHASE_SANDBOX** — 3PC sketch. Add a `pre-commit` phase so a participant that times out
  waiting on the coordinator can terminate on its own (commit if it reached pre-commit, abort
  otherwise) — show it no longer blocks when the coordinator merely CRASHES. Then introduce a
  **network partition**: split the participants into two groups that cannot talk; each group's
  timeout-termination reaches a DIFFERENT verdict (one commits, one aborts) → split-brain. Print the
  divergent outcomes and state the lesson: 3PC removes blocking under crashes but is UNSAFE under
  partitions; the real fix is consensus (Paxos/Raft), §8.

## Scenes (mirror the model) — FIGURE NUMBERS FROZEN
- **TwoPhaseCommitScene (Fig 12.1, §3)** — the protocol animated. A coordinator node and 2–3
  participant nodes; messages fly: PREPARE → votes (YES/YES/…) → the coordinator's durable DECISION
  → COMMIT broadcast → acks. Interactive: flip one participant's vote to NO and watch the global
  outcome flip to ABORT (no torn state). Show each node's durable log filling in. The core protocol.
- **BlockingScene (Fig 12.2, HERO, §5)** — the blocking problem made visceral. Step the protocol to
  the moment all participants are PREPARED (in-doubt, locks lit), then CRASH the coordinator. The
  participants sit frozen — locks held, a spinner/"in-doubt" badge — unable to proceed, while other
  transactions queue behind their locks. Let the user move the crash point along a timeline and see
  WHICH crash points are safe (before prepare → everyone aborts; after broadcast → everyone commits)
  and which one blocks (after prepare, before broadcast). The defining tension of the chapter.
- **RecoveryScene (Fig 12.3, §6)** — recovery from the blocking crash. The coordinator restarts and
  reads its DECISION LOG; if a `committed` record is there it re-broadcasts and the in-doubt
  participants commit and release locks; if not, presumed-abort. Show a participant querying the
  coordinator ("what was the verdict for tid?"). Emphasize the decision log as the single source of
  truth and that re-broadcasting is idempotent (a participant that already applied it is unmoved).
- **ThreePhaseScene (Fig 12.4, §7)** — 3PC vs partitions. Show the extra `pre-commit` phase letting
  a timed-out participant finish without the coordinator (no blocking under a crash). Then drop a
  PARTITION line down the middle: the two groups, each terminating on its own timeout, reach
  DIFFERENT decisions — split-brain, lit red. The visual argument that 3PC trades blocking for
  unsafety, motivating consensus.

## House rules (same as ch08/09/10/11 — non-negotiable)
- Components: `src/components/chapter-12/<Name>.tsx`, **default export, no props**, `client:visible`,
  wrapped in `<Figure number="12.x" caption>`. Cream palette ONLY via CSS vars
  (`--color-fig-bg/fg/muted/green/red/blue/orange`, `fig-card`, `fig-btn`, `fig-btn-primary/danger`).
  framer-motion ok. **390px reflow** (stack `flex-col sm:flex-row`, SVG `maxWidth:'100%' height:'auto'`
  inside `overflowX:auto`, controls `flex-wrap`, tap targets minHeight 38).
- Sandboxes: named-export template-literal strings in the assigned file. **Self-contained.**
  **python3-verify BOTH the raw body AND the exported template-literal string** (extract via tsx —
  what actually reaches Pyodide). No sql.js.
- **DEV-HARNESS GUARDRAIL (ENFORCED):** create NOTHING under `src/pages/`. Don't leave `astro dev` running.
- Figure numbers FROZEN: TwoPhaseCommitScene **12.1**, BlockingScene **12.2** (HERO),
  RecoveryScene **12.3**, ThreePhaseScene **12.4**.
- Reference templates: `src/components/chapter-08/DeadlockScene.tsx` (hero/animation/390px),
  `src/components/chapter-11/recovery-setup-sandboxes.ts` (sandbox style + compact self-contained copy).
- Run the FULL build (`npm run build`), not just `astro check` — MDX nesting errors only show in build.

## Sandbox file layout (Dane)
- `src/components/chapter-12/commit-setup-sandboxes.ts` → `NAIVE_SANDBOX` (§2), `PREPARE_SANDBOX` (§3)
- `src/components/chapter-12/commit-logging-sandboxes.ts` → `LOGGING_SANDBOX` (§4), `BLOCKING_SANDBOX` (§5)
- `src/components/chapter-12/commit-recovery-sandboxes.ts` → `RECOVERY_SANDBOX` (§6), `THREEPHASE_SANDBOX` (§7)
</content>
</invoke>
