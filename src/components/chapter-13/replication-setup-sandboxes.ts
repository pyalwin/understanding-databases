// Chapter 13 — Replication. Sandboxes for §3 (the replication stream) and
// §4 (synchronous vs asynchronous).
//
// Self-contained Python strings seeded into <PythonSandbox>. Pyodide shares ONE
// runtime across the page, so each string carries a COMPACT copy of the chapter's
// canonical model (Node + Cluster) and runs top-to-bottom in a fresh Pyodide with
// identical field/method names. Do NOT rename. See docs/.../ch13-canonical-model.md.
//
//   STREAM_SANDBOX     (§3) — Node only. A leader appends + applies a few records;
//                             ship the SAME records into a follower with ingest()
//                             (append-then-apply = ch11 redo, continuous + remote).
//                             Both nodes end identical. Re-ship an already-applied
//                             record -> apply() returns False (the idempotent
//                             pageLSN check, globalized). Re-delivery is harmless.
//   SYNC_ASYNC_SANDBOX (§4) — full Cluster, 1 follower. The SAME writes under
//                             mode='sync' then mode='async': sync commits report
//                             "durable on 2 nodes" (follower already has it); async
//                             reports "durable on leader only" and leaves an un-acked
//                             queue living on ONE machine -- the lost tail in waiting.
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §3 — The replication stream: ship the leader's log, replay it on a follower,
// and re-delivery is a harmless no-op (the idempotent LSN check from ch11).
export const STREAM_SANDBOX = `# One class does all of replication's heavy lifting: Node. A node has a durable
# log, an applied state (its "disk" after redo), and one cursor -- 'applied', the
# highest LSN it has applied. apply() is ch11's redo made idempotent by the SAME
# LSN check: skip anything at or below 'applied'. ingest() is the follower's whole
# life -- append the shipped record, then redo it. The replica is perpetually
# recovering from a stream that never ends.

class Node:
    def __init__(self, name):
        self.name = name
        self.log = []        # durable log: list of {'lsn','key','val'}
        self.data = {}       # applied state: key -> val (the "disk" after redo)
        self.applied = 0     # highest LSN applied (the global 'pageLSN' from ch11)

    def append(self, rec):                  # put a record in this node's durable log
        self.log.append(rec)

    def apply(self, rec):                    # REDO -- idempotent: skip if already seen
        if rec['lsn'] <= self.applied:
            return False                     # the ch11 pageLSN check, globalized
        self.data[rec['key']] = rec['val']
        self.applied = rec['lsn']
        return True

    def ingest(self, rec):                   # follower loop: append THEN redo
        self.append(rec)
        return self.apply(rec)


leader   = Node('leader')
follower = Node('follower')

# The leader accepts writes: each is a numbered, ordered log record, appended then
# applied to its own state. (On a real leader these come from the WAL of ch10/11.)
records = [
    {'lsn': 1, 'key': 'x', 'val': 10},
    {'lsn': 2, 'key': 'y', 'val': 20},
    {'lsn': 3, 'key': 'x', 'val': 11},   # x overwritten -- the log is the true order
]
for rec in records:
    leader.append(rec)
    leader.apply(rec)

print("THE STREAM -- ship each leader record to the follower, in LSN order:")
for rec in records:
    moved = follower.ingest(rec)          # append-then-redo, exactly ch11's loop
    print(f"  lsn {rec['lsn']}: follower applies {rec['key']}={rec['val']}  "
          f"applied? {moved}  follower.applied now {follower.applied}")

print()
print("leader  data:", leader.data,   "applied", leader.applied)
print("follower data:", follower.data, "applied", follower.applied)
print("identical?", leader.data == follower.data and leader.applied == follower.applied)

# A real network drops connections and re-sends. Re-ship lsn 3 -- already applied:
print()
print("--- the link blips; the leader RE-SENDS lsn 3 (the follower already has it) ---")
moved = follower.ingest(records[2])       # append again, but apply() must skip it
print("apply() returned:", moved, " <- False: lsn 3 <= applied 3, so it is a no-op")
print("follower data:", follower.data, "applied", follower.applied, "(unchanged)")
print()
print("That one no-op is the whole guarantee of robust streaming: at-least-once")
print("delivery + an idempotent apply = the follower converges, never double-applying.")
print("A replica can reconnect and replay from a safe earlier point, safely.")`;

// §4 — Synchronous vs asynchronous: the chapter's hero dial. The same writes,
// two modes; sync acks only after the follower has it, async acks on leader-durable.
export const SYNC_ASYNC_SANDBOX = `# Add the Cluster: a leader and a follower under one replication MODE. write() runs
# the commit path; the MODE decides WHEN the client is told "committed". The leader
# always makes the record durable on ITSELF first (ch02's fsync, the D in ACID) --
# the only question is whether it WAITS for the follower before acking.

class Node:
    def __init__(self, name):
        self.name = name
        self.log = []
        self.data = {}
        self.applied = 0
    def append(self, rec): self.log.append(rec)
    def apply(self, rec):
        if rec['lsn'] <= self.applied: return False
        self.data[rec['key']] = rec['val']; self.applied = rec['lsn']; return True
    def ingest(self, rec): self.append(rec); return self.apply(rec)

class Cluster:
    def __init__(self, n_followers=1, mode='async'):
        self.leader = Node('leader')
        self.followers = [Node(f'follower{i+1}') for i in range(n_followers)]
        self.mode = mode
        self.lsn = 0
        self.queue = []       # async: shipped-but-not-yet-delivered (the lag / tail)

    def write(self, key, val):
        self.lsn += 1
        rec = {'lsn': self.lsn, 'key': key, 'val': val}
        self.leader.append(rec)        # WAL: durable on the leader FIRST...
        self.leader.apply(rec)         # ...leader updates its own state...
        return self._commit(rec)       # ...then the MODE decides when to ack

    def _commit(self, rec):
        if self.mode == 'sync':
            self.followers[0].ingest(rec)      # WAIT for the follower to persist+apply
            return f"commit lsn {rec['lsn']}: durable on 2 nodes"   # ...THEN ack
        # async: ack the client NOW; the record ships later, in the background
        self.queue.append(rec)
        return f"commit lsn {rec['lsn']}: durable on leader only (async)"


writes = [('a', 1), ('b', 2), ('c', 3)]

print("=== mode='sync' -- commit WAITS for the follower's ack ===")
c = Cluster(n_followers=1, mode='sync')
for k, v in writes:
    print(" ", c.write(k, v))      # every commit: the follower already has it
print("  leader.applied  :", c.leader.applied)
print("  follower.applied:", c.followers[0].applied, " <- caught up AT commit time")
print("  un-acked queue  :", c.queue, " <- empty: nothing waiting; nothing to lose")
print("  cost: every commit paid a round trip to the follower.")

print()
print("=== mode='async' -- commit acks on leader-durable; ship later ===")
c = Cluster(n_followers=1, mode='async')
for k, v in writes:
    print(" ", c.write(k, v))      # every commit: only the leader has it
print("  leader.applied  :", c.leader.applied)
print("  follower.applied:", c.followers[0].applied, " <- still 0: the follower has NOTHING")
print("  un-acked queue  :", [r['lsn'] for r in c.queue], "= records on ONE machine only")
print("  cost: commits were fast, but this queue is the lost tail in waiting.")
print()
print("Same writes, equally 'committed' to the client -- but sync rests them on two")
print("machines, async on one. The rest of the chapter is the price of that queue:")
print("the lag it causes while the leader lives, and the loss when the leader dies.")`;
