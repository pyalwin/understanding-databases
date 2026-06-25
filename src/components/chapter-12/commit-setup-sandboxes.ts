// Chapter 12 — Distributed Transactions & Two-Phase Commit. Sandboxes for
// §2 (the naive tear) and §3 (the canonical prepare/decide protocol).
//
// Two self-contained Python strings seeded into <PythonSandbox>. Pyodide shares
// ONE runtime across every sandbox on the page, so each string redefines what it
// needs — no cross-sandbox state. Following ch08/09/10/11, the later sandboxes
// carry a COMPACT copy of the canonical 2PC model (Coordinator + Participant,
// see docs/.../ch12-canonical-model.md) so the chapter reads as one continuous
// build with identical field/method names. Do NOT rename.
//
//   NAIVE_SANDBOX   (§2) — NO coordinator yet. Two nodes commit independently
//                          with plain dicts; one fails mid-way and the transfer
//                          tears in half. Names the problem: no point where both
//                          nodes agreed. Motivates "vote, THEN decide."
//   PREPARE_SANDBOX (§3) — the canonical Coordinator + Participant. Happy path
//                          (all YES -> global commit) then a NO vote (-> global
//                          abort, no tear). Unanimity rule; durable decision is
//                          the commit point.
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §2 — The naive tear: independent commits with no coordinator.
export const NAIVE_SANDBOX = `# No coordinator yet -- just two nodes, each with its own durable store, each
# deciding for ITSELF whether to commit. We move $50 from an account on node A
# to an account on node B. Atomicity demands BOTH halves land or NEITHER does.
# Watch what happens when one node can commit and the other cannot.

nodeA = {"alice": 100}      # durable store on machine A
nodeB = {"bob":    100}     # durable store on machine B

def commitA(acct, val):
    nodeA[acct] = val       # node A writes and commits its half, locally
    print("  node A committed:", acct, "=", val)

def commitB(acct, val):
    # node B is out of disk / crashed / a constraint trips -- it CANNOT commit.
    raise RuntimeError("node B failed before it could commit its half")

print("start:   nodeA =", nodeA, "  nodeB =", nodeB)
print("goal:    move 50 from alice (A) to bob (B) -- all or nothing")
print()

# Each node just commits on its own as soon as it's done its piece.
try:
    commitA("alice", 100 - 50)     # A succeeds: alice -> 50, committed for good
    commitB("bob",   100 + 50)     # B fails AFTER A already committed
except RuntimeError as e:
    print("  ERROR:", e)

print()
print("after:   nodeA =", nodeA, "  nodeB =", nodeB)
print()
# A already committed and cannot take it back; B never applied its half.
print("alice lost 50, bob never got it -- the transfer is TORN in half.")
print("$50 has vanished. And nodeA cannot undo: it already committed locally.")
print()
print("The bug: each node decided ALONE. There was never a single moment where")
print("both nodes had AGREED to commit. We need a referee who first asks every")
print("node 'can you commit?' and only THEN tells everyone to do it -- a vote,")
print("then a decision. That two-step dance is two-phase commit.")`;

// §3 — The canonical protocol: Coordinator + Participant, prepare then decide.
export const PREPARE_SANDBOX = `# The canonical 2PC harness (compact copy carried through the whole chapter).
# A Coordinator drives one distributed txn across several Participants in TWO
# phases: (1) prepare/vote, (2) decide/broadcast. Each node derives its state
# purely from its own DURABLE log -- the same write-ahead discipline as ch11.

class Participant:
    """One node holding part of the data. 'log' is DURABLE (survives a crash);
    'locks' is in-memory (lost on a crash). A YES vote is real only once the
    'prepared' record is on durable storage (ch11 WAL)."""
    def __init__(self, name):
        self.name = name
        self.log = []          # durable: list of {'tid','st'} records
        self.locks = False     # in-memory: held while prepared

    def status(self, tid):                     # state is derived from the log alone
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'new'   # 'new'|'prepared'|'committed'|'aborted'

    def prepare(self, tid, vote_yes=True):     # PHASE 1
        if not vote_yes:                       # won't/can't -> vote NO, abort locally
            self.log.append({'tid': tid, 'st': 'aborted'})
            return 'NO'
        self.locks = True                      # hold locks for this txn...
        self.log.append({'tid': tid, 'st': 'prepared'})   # WAL: durable BEFORE voting YES
        return 'YES'                           # now IN-DOUBT: cannot abort alone

    def finish(self, tid, decision):           # PHASE 2: apply the verdict
        self.log.append({'tid': tid, 'st': decision})     # 'committed'|'aborted', durable
        self.locks = False                     # fate sealed -> release locks
        return decision


class Coordinator:
    """Drives one distributed txn. 'log' is the DURABLE decision log -- the single
    source of truth for the outcome."""
    def __init__(self, name='C'):
        self.name = name
        self.log = []          # durable: decision records

    def decision(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'none'  # 'none'|'committed'|'aborted'

    def run(self, tid, participants, votes=None):
        votes = votes or {p.name: 'YES' for p in participants}
        # PHASE 1 -- voting: ask everyone to prepare; collect the votes.
        replies = [p.prepare(tid, votes.get(p.name, 'YES') == 'YES') for p in participants]
        print("  phase 1 votes:", {p.name: v for p, v in zip(participants, replies)})
        # DECIDE: commit IFF unanimous YES. Force the decision to the durable log
        # BEFORE telling anyone -- THIS record is the commit point.
        verdict = 'committed' if all(r == 'YES' for r in replies) else 'aborted'
        self.log.append({'tid': tid, 'st': verdict})
        print("  decision (durable, = the commit point):", verdict.upper())
        # PHASE 2 -- broadcast: every prepared participant applies the verdict.
        for p in participants:
            if p.status(tid) == 'prepared':
                p.finish(tid, verdict)
        return verdict


def show(tag, c, ps):
    print("  " + tag + " coordinator log:", c.log)
    for p in ps:
        print("    " + p.name, "log:", p.log, " locks:", p.locks)

# --- Happy path: everyone can commit -> unanimous YES -> global COMMIT --------
print("=== run T1: all participants vote YES ===")
c  = Coordinator()
ps = [Participant("A"), Participant("B"), Participant("C")]
out = c.run("T1", ps)
print("  global outcome:", out.upper())
show("after T1", c, ps)
print()

# --- One NO vote -> global ABORT, and crucially NO torn state -----------------
print("=== run T2: participant B votes NO ===")
c2  = Coordinator()
ps2 = [Participant("A"), Participant("B"), Participant("C")]
out2 = c2.run("T2", ps2, votes={"A": "YES", "B": "NO", "C": "YES"})
print("  global outcome:", out2.upper())
show("after T2", c2, ps2)
print()
print("Unanimity is the rule: ALL yes -> commit, even one NO -> abort. Either")
print("way every node ends in the SAME state -- never the torn half-transfer of")
print("the naive version. The coordinator's durable decision is the commit point.")`;
