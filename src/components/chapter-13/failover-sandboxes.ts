// Chapter 13 — Replication. Sandboxes for §6 (failover) and §7 (quorum & consensus).
//
// Self-contained Python strings seeded into <PythonSandbox>. Each carries a COMPACT
// copy of the canonical model (Node + Cluster) so it runs top-to-bottom in a fresh
// Pyodide with identical field/method names. Do NOT rename. See
// docs/.../ch13-canonical-model.md.
//
//   FAILOVER_SANDBOX (§6) — two runs of fail_leader() (promote the most-caught-up
//                           follower). ASYNC: write, DON'T drain -> the un-acked tail
//                           sits in the queue; fail_leader() returns the LOST TAIL and
//                           the promoted node is missing those committed writes. SYNC:
//                           the same writes were on the follower AT commit time, so
//                           fail_leader() returns []. Asserts: async loses the tail,
//                           sync loses nothing. The §4 dial cashed where it matters.
//   QUORUM_SANDBOX   (§7) — Cluster(n_followers=2, mode='quorum'). A write commits as
//                           soon as a MAJORITY (2 of 3) acks -- not waiting for the
//                           slowest. Then fail_leader(): a majority held every record
//                           and the new leader comes from that majority, so it HAS the
//                           data -> no lost tail AND no waiting on the straggler.
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §6 — Failover: promote a follower when the leader dies. Async amputates the
// un-acked tail; sync loses nothing because every commit was already on a follower.
export const FAILOVER_SANDBOX = `# The leader is gone for good. fail_leader() promotes the most-caught-up follower.
# The whole sync-vs-async trade of §4 comes due RIGHT HERE: async's queue held
# records committed-to-the-client but never shipped -- they lived on the one machine
# that just died, so they are silently, permanently LOST. Sync has no such queue.

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
        self.queue = []
    def write(self, key, val):
        self.lsn += 1
        rec = {'lsn': self.lsn, 'key': key, 'val': val}
        self.leader.append(rec); self.leader.apply(rec)
        if self.mode == 'sync':
            self.followers[0].ingest(rec)      # sync: on the follower BEFORE we ack
        else:
            self.queue.append(rec)             # async: ack now, ship later
        return rec
    def fail_leader(self):                      # leader destroyed; promote a follower
        lost = list(self.queue)                 # ack'd to the client but never shipped
        self.queue = []
        new_leader = max(self.followers, key=lambda f: f.applied)
        self.followers.remove(new_leader)
        self.leader = new_leader
        self.lsn = new_leader.applied           # history stops at what the new leader had
        return lost                             # the LOST TAIL


writes = [('a', 1), ('b', 2), ('c', 3)]

print("=== ASYNC: the leader dies with an un-drained tail ===")
c = Cluster(n_followers=1, mode='async')
for k, v in writes:
    c.write(k, v)                # each ack'd to the client as 'committed'
print("before failure -> leader.applied:", c.leader.applied,
      " follower.applied:", c.followers[0].applied)
print("un-acked queue (only on the leader):", [r['lsn'] for r in c.queue])
lost = c.fail_leader()           # the leader is gone; promote the follower
print("fail_leader() LOST TAIL:", [(r['key'], r['val']) for r in lost])
print("new leader data:", c.leader.data, " <- missing writes the client was told were safe")
assert [r['lsn'] for r in lost] == [1, 2, 3], "async must lose the whole un-shipped tail"
print("(split-brain risk: if the OLD leader revives still believing it leads -> two leaders.)")

print()
print("=== SYNC: the same writes, but each was on the follower at commit time ===")
c = Cluster(n_followers=1, mode='sync')
for k, v in writes:
    c.write(k, v)                # commit WAITED until the follower had it
print("before failure -> leader.applied:", c.leader.applied,
      " follower.applied:", c.followers[0].applied)
print("un-acked queue:", c.queue, " <- empty")
lost = c.fail_leader()
print("fail_leader() LOST TAIL:", lost, " <- nothing lost")
print("new leader data:", c.leader.data, " <- every committed write survived")
assert lost == [], "sync must lose nothing on failover"
print()
print("One algorithm, one workload. The durability of your acknowledged commits hinged")
print("entirely on which way the §4 dial was set -- and the bill came due at failover.")`;

// §7 — Quorum & consensus: wait for a MAJORITY, not one and not all. Majorities
// overlap, so a committed record always reaches the next leader -> no lost tail.
export const QUORUM_SANDBOX = `# The way out of "sync stalls vs async loses": stop waiting for ONE specific
# follower and wait for a MAJORITY of several. In a 3-node cluster a write is safe
# once 2 of 3 have it -- the leader plus one follower -- without waiting for the
# slowest third. Any two majorities overlap in at least one node, so a committed
# record (on a majority) is on whatever node a new leader is drawn from.

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
    def __init__(self, n_followers=2, mode='quorum'):
        self.leader = Node('leader')
        self.followers = [Node(f'follower{i+1}') for i in range(n_followers)]
        self.mode = mode
        self.lsn = 0
        self.queue = []
    def write(self, key, val):
        self.lsn += 1
        rec = {'lsn': self.lsn, 'key': key, 'val': val}
        self.leader.append(rec); self.leader.apply(rec)   # leader counts as ack #1
        acks = 1
        for f in self.followers:
            f.ingest(rec); acks += 1
            if acks > (1 + len(self.followers)) // 2:
                break          # a MAJORITY has it -> safe to ack; stop waiting
        return f"commit lsn {rec['lsn']}: durable on {acks} nodes (majority)"
    def fail_leader(self):
        lost = list(self.queue); self.queue = []
        new_leader = max(self.followers, key=lambda f: f.applied)
        self.followers.remove(new_leader)
        self.leader = new_leader
        self.lsn = new_leader.applied
        return lost


c = Cluster(n_followers=2, mode='quorum')     # 3 nodes total: leader + 2 followers
print("3-node cluster, mode='quorum' -- a write needs a MAJORITY (2 of 3):")
for k, v in [('a', 1), ('b', 2), ('c', 3)]:
    print(" ", c.write(k, v))    # acks at 2 nodes; the 3rd may still be catching up

print()
print("leader   applied:", c.leader.applied)
for f in c.followers:
    print(f"  {f.name} applied:", f.applied, " data:", f.data)

# The leader dies. A majority held every committed record, and the promoted node is
# drawn from that majority -- so it HAS the data. No lost tail, no stalling on a straggler.
lost = c.fail_leader()
print()
print("--- leader dies; promote the most-caught-up follower ---")
print("fail_leader() LOST TAIL:", lost, " <- empty: a majority had every record")
print("new leader data:", c.leader.data, "applied", c.leader.applied)
assert lost == [], "quorum loses nothing: the new leader is from the committing majority"
print()
print("Async's speed (wait for the fast majority, not the slow straggler) with sync's")
print("safety (no acknowledged write is ever lost). The overlap that saves the data is the")
print("same overlap that forbids two leaders -- one combinatorial fact under all of consensus.")
print("Beyond this sandbox: vote counting, terms, election timeouts -- Raft, Paxos. The next book.")`;
