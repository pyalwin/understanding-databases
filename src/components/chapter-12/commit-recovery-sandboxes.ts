// Chapter 12 — Distributed Transactions & Two-Phase Commit. Sandboxes for
// §6 (recovery & presumed abort) and §7 (3PC vs network partitions).
//
// Self-contained Python strings seeded into <PythonSandbox>. Each carries a
// COMPACT copy of the canonical 2PC model (Coordinator + Participant) so it runs
// top-to-bottom in a fresh Pyodide with identical field/method names. Do NOT
// rename. See docs/.../ch12-canonical-model.md.
//
//   RECOVERY_SANDBOX   (§6) — recover(). Two cases from one crash point: (a) the
//                             coordinator forced 'committed' before dying ->
//                             re-broadcast; (b) it crashed BEFORE deciding ->
//                             PRESUMED ABORT. An in-doubt participant learns the
//                             verdict by asking the coordinator. recover() run
//                             TWICE is idempotent (like ch11's CLRs).
//   THREEPHASE_SANDBOX (§7) — a 3PC sketch: a 'pre-commit' phase lets a timed-out
//                             participant terminate without the coordinator (no
//                             blocking under a crash). Then a network PARTITION
//                             splits the cluster into groups that reach DIFFERENT
//                             verdicts -- split-brain. 3PC trades blocking for
//                             unsafety; the real fix is consensus (§8).
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §6 — Recovery: re-broadcast a logged decision, or presumed-abort; idempotent.
export const RECOVERY_SANDBOX = `# The coordinator comes back. Recovery reads its DURABLE DECISION LOG -- the
# single source of truth -- and drives every in-doubt participant to the right
# end. Two cases hinge on ONE question: did a decision record reach disk before
# the crash? We also prove recovery is idempotent: safe to run again and again.

class Participant:
    def __init__(self, name):
        self.name = name
        self.log = []
        self.locks = False
    def status(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'new'
    def prepare(self, tid, vote_yes=True):
        if not vote_yes:
            self.log.append({'tid': tid, 'st': 'aborted'})
            return 'NO'
        self.locks = True
        self.log.append({'tid': tid, 'st': 'prepared'})
        return 'YES'
    def finish(self, tid, decision):
        # idempotent: re-applying a verdict the node already holds is a no-op.
        if self.status(tid) == decision:
            return decision
        self.log.append({'tid': tid, 'st': decision})
        self.locks = False
        return decision

class Coordinator:
    def __init__(self, name='C'):
        self.name = name
        self.log = []
    def decision(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'none'
    def recover(self, tid, participants):       # restart: re-broadcast from the log
        d = self.decision(tid)
        if d == 'none':                         # never decided -> PRESUMED ABORT
            d = 'aborted'
            self.log.append({'tid': tid, 'st': d})
            print("    no decision on disk -> PRESUMED ABORT (write 'aborted')")
        else:
            print("    found durable decision '" + d + "' -> re-broadcast it")
        applied = []
        for p in participants:                  # only in-doubt nodes need driving
            if p.status(tid) == 'prepared':
                p.finish(tid, d)
                applied.append(p.name)
        print("    drove in-doubt participants to '" + d + "':", applied or "(none)")
        return d

def staged(tid):                                # rebuild the blocking crash point
    ps = [Participant("A"), Participant("B")]
    for p in ps:
        p.prepare(tid, True)                    # both prepared, in-doubt, locks held
    return ps

# === Case (a): the coordinator DID force 'committed' before crashing ==========
print("=== case (a): decision WAS logged before the crash ===")
ca = Coordinator()
psa = staged("T1")
ca.log.append({'tid': "T1", 'st': 'committed'})   # the decision survived the crash
print("  in-doubt before recovery:", {p.name: (p.status("T1"), p.locks) for p in psa})
print("  participant A asks coordinator: decision('T1') =", ca.decision("T1"))
ca.recover("T1", psa)
print("  after recovery:", {p.name: (p.status("T1"), p.locks) for p in psa})
print()

# === Case (b): the coordinator crashed BEFORE deciding -> presumed abort ======
print("=== case (b): NO decision was logged -> presumed abort ===")
cb = Coordinator()
psb = staged("T2")
print("  in-doubt before recovery:", {p.name: (p.status("T2"), p.locks) for p in psb})
print("  participant A asks coordinator: decision('T2') =", cb.decision("T2"))
cb.recover("T2", psb)
print("  after recovery:", {p.name: (p.status("T2"), p.locks) for p in psb})
print()

# === Idempotency: run recovery AGAIN -- it must change nothing ================
print("=== run recover() a SECOND time (a re-restart) -- must be a no-op ===")
before = ([dict(r) for r in ca.log], [[dict(r) for r in p.log] for p in psa])
ca.recover("T1", psa)                           # nobody is 'prepared' anymore
after = (ca.log, [p.log for p in psa])
print("  state identical to before the 2nd run:", before == after)
print()
print("The decision log is the single source of truth. Recovery re-reads it and")
print("re-broadcasts; a participant that already applied the verdict is unmoved.")
print("No decision on disk means the coordinator never committed -- so PRESUMED")
print("ABORT is safe, and coordinators need not log aborts to remember them.")
print("Idempotent and restartable, exactly like ch11's compensation (CLRs).")`;

// §7 — 3PC sketch: pre-commit avoids blocking under crashes, but partitions split-brain.
export const THREEPHASE_SANDBOX = `# Three-phase commit inserts a 'pre-commit' phase between vote and commit so a
# participant that loses the coordinator can TERMINATE ON ITS OWN: if it reached
# pre-commit it commits, otherwise it aborts. That removes blocking when the
# coordinator merely CRASHES. We sketch the state, then break it with a partition.

class Node:
    """A 3PC participant. 'phase' tracks how far this node got before it lost
    contact: 'prepared' (voted YES) -> 'precommit' (told 'about to commit')."""
    def __init__(self, name):
        self.name = name
        self.phase = 'new'         # 'new'|'prepared'|'precommit'
        self.outcome = None        # final self-decided verdict on timeout
    def prepare(self):
        self.phase = 'prepared'    # voted YES, in-doubt (as in 2PC)
        return 'YES'
    def precommit(self):
        self.phase = 'precommit'   # coordinator said "everyone's ready, get set"
    def terminate_on_timeout(self):
        # coordinator is gone. Decide ALONE from how far we got:
        self.outcome = 'committed' if self.phase == 'precommit' else 'aborted'
        return self.outcome

# === 3PC under a plain CRASH: no blocking ====================================
print("=== 3PC, coordinator crashes AFTER pre-commit reaches everyone ===")
ns = [Node("A"), Node("B"), Node("C")]
for n in ns: n.prepare()                # phase 1: all vote YES
for n in ns: n.precommit()              # phase 2: all reach pre-commit
print("  coordinator crashes now (all nodes at 'precommit')")
for n in ns:
    print("    " + n.name, "times out, decides alone ->", n.terminate_on_timeout())
print("  no node is stuck: each finished on its own. Blocking is gone -- when the")
print("  only failure is a crash.")
print()

# === 3PC under a NETWORK PARTITION: split-brain ==============================
print("=== 3PC, a network PARTITION splits the cluster mid-protocol ===")
ns = [Node("A"), Node("B"), Node("C"), Node("D")]
for n in ns: n.prepare()                # all voted YES
# The coordinator gets pre-commit to A and B, then the network splits in two
# BEFORE C and D hear it. Now neither group can talk to the other.
groupX = [ns[0], ns[1]]                 # A,B -- reached pre-commit
groupY = [ns[2], ns[3]]                 # C,D -- stuck at 'prepared'
for n in groupX: n.precommit()
print("  partition! group X =", [n.name for n in groupX], "(reached pre-commit)")
print("            group Y =", [n.name for n in groupY], "(still only prepared)")
print()
# Each group times out and applies the 3PC termination rule -- independently.
for n in groupX: n.terminate_on_timeout()
for n in groupY: n.terminate_on_timeout()
print("  each group terminates on its own timeout rule:")
for n in ns:
    print("    " + n.name, "->", n.outcome)
verdicts = set(n.outcome for n in ns)
print("  distinct verdicts across the cluster:", verdicts)
print("  SPLIT-BRAIN:", "YES -- some COMMITTED, some ABORTED" if len(verdicts) > 1 else "no")
print()
print("3PC removed blocking under a crash, but a PARTITION made two halves decide")
print("DIFFERENTLY -- the atomicity it was meant to protect is shattered. 3PC")
print("trades blocking for unsafety; it is not the fix. The real answer is")
print("CONSENSUS -- a majority quorum where two conflicting decisions can never")
print("both win (Paxos, Raft). That is the next chapter (§8).")`;
