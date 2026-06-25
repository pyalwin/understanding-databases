// Chapter 13 — Replication. Sandbox for §5 (replication lag).
//
// Self-contained Python string seeded into <PythonSandbox>. Carries a COMPACT copy
// of the canonical model (Node + Cluster) so it runs top-to-bottom in a fresh
// Pyodide with identical field/method names. Do NOT rename. See
// docs/.../ch13-canonical-model.md.
//
//   LAG_SANDBOX (§5) — Cluster in async mode. Write several keys; BEFORE draining,
//                      print cluster.lag() (= leader.applied - follower.applied) and
//                      the follower's stale data: a read-your-writes anomaly -- read
//                      a just-written key off the follower and get the old value or
//                      nothing. Then drain() the queue: lag -> 0, the follower catches
//                      up, and the read becomes correct. Lag is real and user-visible.
//
// Verified under python3 before shipping — the RAW body AND the exported
// template-literal string (what actually reaches Pyodide).

// §5 — Replication lag: the follower trails the leader under async; reading your
// own just-made write off a stale follower returns the old value (the anomaly).
export const LAG_SANDBOX = `# Under async, the follower is always a little behind, and "behind" has a number:
# replication lag = leader.applied - follower.applied. While the leader lives, lag
# is just a consistency nuisance -- but it is USER-VISIBLE, and its sharpest edge is
# reading your OWN recent write off a follower that has not received it yet.

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
        self.queue.append(rec)             # async: ack now, ship in the background
        return rec
    def drain(self):                       # async: deliver the queued records
        while self.queue:
            rec = self.queue.pop(0)
            for f in self.followers:
                f.ingest(rec)
    def lag(self):                         # how far follower 1 trails the leader
        return self.leader.applied - self.followers[0].applied


c = Cluster(n_followers=1, mode='async')
follower = c.followers[0]

# A burst of writes hits the leader. Async acks each immediately; nothing ships yet.
c.write('cart', 'empty')
c.write('cart', 'one item')
c.write('photo', 'new.jpg')
c.write('cart', 'two items')

print("--- right after the writes, BEFORE the stream drains ---")
print("leader   data:", c.leader.data, "applied", c.leader.applied)
print("follower data:", follower.data, "applied", follower.applied)
print("replication lag (leader.applied - follower.applied):", c.lag(), "records")
print("un-shipped queue:", [r['lsn'] for r in c.queue])

# READ-YOUR-WRITES: the user just set photo='new.jpg' on the leader and got success.
# Their next page-load read is load-balanced to the follower -- which has nothing.
print()
print("--- the user reads their OWN just-made write, off the follower ---")
read = follower.data.get('photo', '(missing)')
print("follower says photo =", repr(read), " <- WRONG: the write 'succeeded' but is")
print("   not here yet. The user watched their change vanish. read-your-writes anomaly.")

# Drain the stream: the follower applies the queued records and catches up.
c.drain()
print()
print("--- after drain() -- the follower has caught up ---")
print("follower data:", follower.data, "applied", follower.applied)
print("replication lag:", c.lag(), "records")
print("follower says photo =", repr(follower.data.get('photo', '(missing)')), " <- correct now")
print()
print("Lag is not damage; it is TIMING. While the leader lives, the app routes around")
print("it (read from the leader after a write). The danger is what this same un-drained")
print("queue means when the leader does NOT live -- the next section.")`;
