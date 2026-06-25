# Chapter 13 — Canonical model (shared contract for all teammates)

One hand-built model runs through ch13: a simplified **leader/follower replication
cluster**, the `Node` + `Cluster` classes below. This is the book's capstone — **the
log returns one last time.** Shipping a leader's WAL records to a second machine and
replaying them there IS replication, and replaying a record on a follower is *exactly*
ch11's **redo**, made idempotent by the same LSN check — only now it is continuous and
remote. The follower is "perpetually recovering" from the leader's log.

Every Python sandbox is **self-contained** (Pyodide shares one runtime across the page —
each sandbox string redefines what it needs, copying forward a COMPACT version of these
classes, the way ch08/09/10/11 re-included prior structures). Use the SAME field/method
names everywhere so the chapter reads as one continuous build. Do NOT rename.

## Continuity (load-bearing callbacks — the user's top priority)
- **ch02:246** already promises: "every modern database can be its own replication system…
  shipping log records to a second machine is, for free, a way to keep a second copy in sync."
  This chapter cashes that note.
- **ch11** — redo replay on a crashed node = redo replay on a replica. The replica runs
  ch11's `_redo` forever, on a stream that never ends. The idempotent `pageLSN`/`applied`
  check is the same trick. Say "the replica is perpetually recovering."
- **ch10** — the log is sequential/append-only; shipping it is cheap because it's a stream.
- **ch12** (distributed txns / 2PC, authored in parallel by Tariq) — replication interacts
  with distributed commit; a sync replica ack is itself a tiny commit handshake. Light nod only.
- **ch11:250 + ch02:246** both forward-ref "Chapter 13 — replication" — deliver exactly that.
- "What's next" closes the book's single-node→cluster arc and gestures at consensus
  (Raft/Paxos) and distributed systems *beyond this book*.

## Vocabulary (the load-bearing ideas)
- **Leader / follower** (a.k.a. primary/replica) — the leader accepts writes; followers
  replay the leader's log stream. Only the leader has a writable state; followers are
  read-only copies kept current by the stream.
- **Replication stream** — the ordered sequence of the leader's log records, shipped to a
  follower and applied in LSN order. = ch11 redo, continuous + remote.
- **applied** — per node, the highest LSN applied to that node's state (the global analog of
  ch11's `pageLSN`). `apply` is idempotent: skip a record whose `lsn <= applied`. Re-shipping
  a record is therefore a harmless no-op — the replica can reconnect and replay safely.
- **Synchronous replication** — commit waits until a follower has persisted+applied the
  record (an ack), THEN reports committed. No data loss on failover, but commit latency
  includes a network round trip; if the follower stalls, the leader stalls.
- **Asynchronous replication** — commit reports success as soon as the record is durable on
  the *leader*; records ship to followers in the background. Fast commits, but a window of
  un-acked records exists only on the leader — a crash there loses them (the **lost tail**).
- **Replication lag** — `leader.applied - follower.applied`; how far the follower trails.
  Under async, lag is the size of the un-shipped queue. Causes **read-your-writes** anomalies:
  write to the leader, read from a stale follower, and your own write is missing.
- **Failover** — promoting a follower to leader when the leader dies. The **lost tail** =
  records committed-to-the-client on the old leader but never replicated (async only).
  **Split-brain** = two nodes both believing they are leader (old leader revives, or a network
  partition) → divergent writes; fixed by fencing/epochs and a majority requirement.
- **Quorum / consensus** — commit waits for a *majority* of nodes to ack (not just one,
  not all). Survives a minority failure with no data loss and no split-brain, because any
  two majorities overlap. This is where Raft/Paxos live — the field's answer, gestured at, not built.

## The model

```python
class Node:
    """One database node: a durable log + applied state. A LEADER accepts writes; a
    FOLLOWER replays the leader's shipped log. Replaying a record is ch11's redo, made
    idempotent by the same LSN check (apply only if lsn > applied). `log` and `data`
    are durable on this node; a crash of THIS node loses only what was never shipped."""

    def __init__(self, name):
        self.name = name
        self.log = []        # durable log: list of {'lsn', 'key', 'val'}
        self.data = {}        # applied state: key -> val (ch11's "disk" after redo)
        self.applied = 0      # highest LSN applied to data (the global 'pageLSN')

    def append(self, rec):                    # put a record in this node's durable log
        self.log.append(rec)

    def apply(self, rec):                     # REDO: idempotent — skip if already applied
        if rec['lsn'] <= self.applied:
            return False                      # the ch11 pageLSN check, globalized
        self.data[rec['key']] = rec['val']
        self.applied = rec['lsn']
        return True

    def ingest(self, rec):                    # follower: append THEN apply (perpetual recovery)
        self.append(rec)
        return self.apply(rec)


class Cluster:
    """A leader and its followers under one replication mode. `write` runs the commit
    path; the MODE decides when the client is told 'committed'."""

    def __init__(self, n_followers=1, mode='async'):
        self.leader = Node('leader')
        self.followers = [Node(f'follower{i+1}') for i in range(n_followers)]
        self.mode = mode                      # 'async' | 'sync' | 'quorum'
        self.lsn = 0
        self.queue = []                       # async: shipped-but-not-yet-delivered (the lag/tail)

    def write(self, key, val):
        self.lsn += 1
        rec = {'lsn': self.lsn, 'key': key, 'val': val}
        self.leader.append(rec)               # WAL: durable on the leader FIRST
        self.leader.apply(rec)                # leader updates its own state
        return self._commit(rec)

    def _commit(self, rec):
        if self.mode == 'sync':
            self.followers[0].ingest(rec)     # wait for the follower to persist+apply...
            return f"commit lsn {rec['lsn']}: durable on 2 nodes"      # ...THEN ack
        if self.mode == 'quorum':
            acks = 1                           # the leader itself counts as one
            for f in self.followers:
                f.ingest(rec); acks += 1
                if acks > (1 + len(self.followers)) // 2:
                    break                      # a MAJORITY has it -> safe to ack
            return f"commit lsn {rec['lsn']}: durable on {acks} nodes (majority)"
        self.queue.append(rec)                 # async: ship later; ack the client NOW
        return f"commit lsn {rec['lsn']}: durable on leader only (async)"

    def drain(self):                          # async: deliver the queued records to followers
        while self.queue:
            rec = self.queue.pop(0)
            for f in self.followers:
                f.ingest(rec)

    def lag(self):                            # how far follower 1 trails the leader
        return self.leader.applied - self.followers[0].applied

    def fail_leader(self):                    # leader destroyed; promote the most-caught-up follower
        lost = list(self.queue)               # async: these were ack'd to the client but never shipped
        self.queue = []
        new_leader = max(self.followers, key=lambda f: f.applied)
        self.followers.remove(new_leader)
        self.leader = new_leader
        self.lsn = new_leader.applied         # the new leader's history stops at what it had
        return lost                           # the LOST TAIL: committed-to-client, now gone
```

## Section extensions (copy a COMPACT base, add/show ONLY that section's piece)
- **§3 STREAM_SANDBOX** (the-replication-stream) — `Node` only. Leader appends + applies a
  few records; ship the SAME records to a follower with `ingest`; print both nodes' `data`
  and `applied` — identical. Then re-ship a record already applied and show `apply` returns
  False (idempotent — the ch11 pageLSN check). Point: the replica is perpetually recovering;
  re-delivery is harmless, so a replica can reconnect and catch up safely.
- **§4 SYNC_ASYNC_SANDBOX** (synchronous-vs-asynchronous) — full `Cluster`, 1 follower. Run
  the SAME writes under `mode='sync'` then `mode='async'`; print each commit's return string
  ("durable on 2 nodes" vs "durable on leader only") and, for async, the `queue` of un-acked
  records still sitting only on the leader. The central tension in one run: sync = safe but
  the commit waited on the follower; async = fast but a tail lives only on the leader.
- **§5 LAG_SANDBOX** (replication-lag) — `Cluster` async. Write several keys; print
  `cluster.lag()` and the follower's stale `data` BEFORE draining; read-your-writes: read the
  just-written key from the follower → old/missing value (the anomaly). Then `drain()` and show
  lag → 0, follower caught up. Point: async lag is real and user-visible.
- **§6 FAILOVER_SANDBOX** (failover) — two runs. ASYNC: write, DON'T drain (un-acked tail in
  the queue), `fail_leader()` → it returns the LOST TAIL; the promoted follower is missing
  those committed writes. SYNC: same writes, but each was already on the follower at commit
  time, so `fail_leader()` returns []. Assert sync loses nothing, async loses the tail. This is
  the sync-vs-async tradeoff made concrete at the moment it matters.
- **§7 QUORUM_SANDBOX** (quorum-and-consensus) — `Cluster(n_followers=2, mode='quorum')`.
  Write; show commit acks at a MAJORITY (2 of 3) without waiting for all; then `fail_leader()`
  and show the promoted node HAS the data (a majority had it, and the new leader was in that
  majority) → no lost tail AND no waiting-for-the-slowest. Closes the loop: quorum is async's
  speed with sync's safety, which is why consensus systems use it.

## Scenes (mirror the model — Esha)
- **LogShippingScene (Fig 13.1, §2 leader-and-follower)** — the topology: a LEADER box with a
  log strip, an arrow shipping records to a FOLLOWER that replays them into its own state. Step
  records across the wire; the follower's `applied` cursor advances, its state catches up to the
  leader. Show the follower is read-only and "perpetually recovering" (replaying redo forever).
  Ties to ch11 redo + ch02:246.
- **SyncAsyncScene (Fig 13.2, HERO, §4)** — the commit path under a sync/async toggle. A write
  hits the leader; in SYNC the commit ack waits for the round-trip to the follower (draw the
  latency, the ack returning, "durable on 2 nodes"); in ASYNC the commit acks instantly while
  the record sits in a queue not yet on the follower (draw the fast ack + the un-replicated
  tail). The defining image: the tradeoff is latency vs. a window of loss. Toggle and watch the
  commit clock vs. the size of the un-acked tail move opposite each other.
- **LagScene (Fig 13.3, §5 replication-lag)** — async stream with the follower trailing; a lag
  meter (leader.applied − follower.applied). A client writes to the leader then reads from the
  stale follower → the read-your-writes anomaly (own write missing). Advance the stream and watch
  lag fall to 0 and the read become correct. Show lag is normal, bounded by how fast the stream drains.
- **FailoverScene (Fig 13.4, §6 failover)** — the leader dies. Under ASYNC the un-acked tail is
  lost when a follower is promoted (show those records evaporate; flag split-brain risk if the old
  leader revives). Under SYNC the follower already had every committed record, so promotion loses
  nothing. Toggle sync/async and watch the lost tail appear/disappear at the moment of promotion.

## House rules (same as ch08/09/10/11 — non-negotiable)
- Components: `src/components/chapter-13/<Name>.tsx`, **default export, no props**, `client:visible`,
  wrapped in `<Figure number="13.x" caption>`. Cream palette ONLY via CSS vars
  (`--color-fig-bg/fg/muted/green/red/blue/orange`, `fig-card`, `fig-btn`, `fig-btn-primary/danger`).
  framer-motion ok. **390px reflow** (stack `flex-col sm:flex-row`, SVG `maxWidth:'100%' height:'auto'`
  inside `overflowX:auto`, controls `flex-wrap`, tap targets minHeight 38).
- Sandboxes: named-export template-literal strings in the assigned file. **Self-contained**
  (compact copy of the model). **python3-verify BOTH the raw body AND the exported template-literal
  string** (extract via tsx — what actually reaches Pyodide). No sql.js.
- **DEV-HARNESS GUARDRAIL (ENFORCED):** create NOTHING under `src/pages/`. Don't leave `astro dev` running.
- Figure numbers FROZEN: LogShippingScene **13.1**, SyncAsyncScene **13.2** (HERO),
  LagScene **13.3**, FailoverScene **13.4**.
- Reference templates: `src/components/chapter-11/ThreePassesScene.tsx` + `chapter-08/DeadlockScene.tsx`
  (hero/animation/390px), `src/components/chapter-11/recovery-setup-sandboxes.ts` (sandbox style +
  compact self-contained copy).
- Run the FULL build (`npm run build`), not just `astro check` — MDX nesting errors only show in build.

## Sandbox files (Marco)
- `src/components/chapter-13/replication-setup-sandboxes.ts` → `STREAM_SANDBOX` (§3), `SYNC_ASYNC_SANDBOX` (§4)
- `src/components/chapter-13/replication-lag-sandboxes.ts` → `LAG_SANDBOX` (§5)
- `src/components/chapter-13/failover-sandboxes.ts` → `FAILOVER_SANDBOX` (§6), `QUORUM_SANDBOX` (§7)
```
