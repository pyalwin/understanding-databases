// Chapter 12 — Distributed Transactions & Two-Phase Commit. Sandboxes for
// §4 (the durable log) and §5 (the blocking disaster, HERO).
//
// Self-contained Python strings seeded into <PythonSandbox>. Each carries a
// COMPACT copy of the canonical 2PC model (Coordinator + Participant) so it runs
// top-to-bottom in a fresh Pyodide with identical field/method names. Do NOT
// rename. See docs/.../ch12-canonical-model.md.
//
//   LOGGING_SANDBOX  (§4) — the DURABLE LOG records each node writes, in disk
//                           order. A participant force-writes 'prepared' BEFORE
//                           voting YES; the coordinator force-writes 'committed'
//                           BEFORE broadcasting -- THAT force is the commit point
//                           (ch02/ch10); a participant force-writes 'committed'
//                           on apply. 2PC = a recovery protocol on WAL (ch11).
//   BLOCKING_SANDBOX (§5) — the hero disaster. All prepare and vote YES (in-doubt,
//                           locks held), then the COORDINATOR CRASHES before
//                           logging/broadcasting a decision. Participants are STUCK.
//
// Both strings verified under python3 before shipping — the RAW body AND the
// exported template-literal string (what actually reaches Pyodide).

// §4 — The durable log: every node's write-ahead records, in disk order.
export const LOGGING_SANDBOX = `# Same 2PC harness, but now we record the EXACT order of DURABLE WRITES across
# the cluster -- one shared timeline ('disk_order'), the way you'd see records
# hit the write-ahead logs in real time. The WAL rule from ch11 holds on every
# node: the log record is forced to durable storage BEFORE the node acts on it.

disk_order = []     # global timeline of force-writes, in the order they hit disk

class Participant:
    def __init__(self, name):
        self.name = name
        self.log = []
        self.locks = False
    def status(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'new'
    def _force(self, tid, st):                  # write-ahead: durable BEFORE acting
        self.log.append({'tid': tid, 'st': st})
        disk_order.append(self.name + ": force " + st)
    def prepare(self, tid, vote_yes=True):
        if not vote_yes:
            self._force(tid, 'aborted')
            return 'NO'
        self.locks = True
        self._force(tid, 'prepared')            # redo+undo promise, durable, THEN vote YES
        return 'YES'
    def finish(self, tid, decision):
        self._force(tid, decision)              # durable record of the applied verdict
        self.locks = False
        return decision

class Coordinator:
    def __init__(self, name='C'):
        self.name = name
        self.log = []
    def decision(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'none'
    def run(self, tid, participants, votes=None):
        votes = votes or {p.name: 'YES' for p in participants}
        replies = [p.prepare(tid, votes.get(p.name, 'YES') == 'YES') for p in participants]
        verdict = 'committed' if all(r == 'YES' for r in replies) else 'aborted'
        # THE force-write that decides everything -- the commit point:
        self.log.append({'tid': tid, 'st': verdict})
        disk_order.append("** " + self.name + ": force DECISION " + verdict + "  <== THE COMMIT POINT **")
        for p in participants:
            if p.status(tid) == 'prepared':
                p.finish(tid, verdict)
        return verdict

c  = Coordinator()
ps = [Participant("A"), Participant("B")]
verdict = c.run("T1", ps)

print("DURABLE WRITES, in the order they reached disk:")
for i, line in enumerate(disk_order, 1):
    print(f"  {i}. {line}")

print()
print("Read the timeline top to bottom. Every 'prepared' is forced BEFORE its")
print("node votes YES (ch11 WAL). The coordinator forces its DECISION before it")
print("tells anyone -- the instant that record hits disk the txn's fate is sealed,")
print("exactly like ch02's local commit record and ch10's group-commit fsync,")
print("now gating the whole cluster. Everything after it is just delivery: even")
print("if every node crashed now, recovery would re-read that one record and")
print("drive all participants to COMMIT. 2PC is a recovery protocol built on WAL.")
print()
print("global outcome:", verdict.upper(), " | coordinator log:", c.log)`;

// §5 — The blocking problem (HERO): coordinator crashes after prepare, pre-decision.
export const BLOCKING_SANDBOX = `# The defining disaster of 2PC. We step the protocol by hand to the worst
# possible moment: every participant has PREPARED and voted YES -- in-doubt,
# locks held -- and the COORDINATOR CRASHES before it forces or broadcasts any
# decision. Now nobody can safely move. This is why 2PC is called BLOCKING.

class Participant:
    def __init__(self, name):
        self.name = name
        self.log = []          # durable: survives a crash
        self.locks = False     # in-memory
    def status(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'new'
    def prepare(self, tid, vote_yes=True):
        if not vote_yes:
            self.log.append({'tid': tid, 'st': 'aborted'})
            return 'NO'
        self.locks = True
        self.log.append({'tid': tid, 'st': 'prepared'})   # durable, THEN vote YES
        return 'YES'

class Coordinator:
    def __init__(self, name='C'):
        self.name = name
        self.log = []
        self.alive = True
    def decision(self, tid):
        rs = [r for r in self.log if r['tid'] == tid]
        return rs[-1]['st'] if rs else 'none'
    def crash(self):                            # in-memory driver dies; log unchanged
        self.alive = False

c  = Coordinator()
ps = [Participant("A"), Participant("B"), Participant("C")]

# --- PHASE 1 only: everyone prepares and votes YES ---------------------------
votes = [p.prepare("T1", True) for p in ps]
print("phase 1 -- votes:", {p.name: v for p, v in zip(ps, votes)})
print("every participant is now PREPARED: in-doubt, holding its locks.")
print()

# --- DISASTER: the coordinator dies BEFORE forcing/broadcasting a decision ---
c.crash()
print("*** the coordinator CRASHED before deciding ***")
print("coordinator decision log:", c.log, " -> decision('T1') =", c.decision("T1"))
print()

# --- where everyone is stuck -------------------------------------------------
print("participant states, frozen mid-protocol:")
for p in ps:
    print("  " + p.name, "status:", p.status("T1"), " locks held:", p.locks)
print()

# --- why neither choice is safe ----------------------------------------------
print("Each prepared participant is trapped. It cannot decide ALONE:")
print("  - commit? maybe another participant voted NO -- committing would tear it.")
print("  - abort?  maybe everyone voted YES and the coordinator ALREADY chose")
print("            commit before dying -- aborting would tear it the other way.")
print("Having voted YES it surrendered the right to abort unilaterally, so it")
print("must WAIT -- holding its locks the entire time. Every other transaction")
print("that needs those rows now queues behind a coordinator that may be down")
print("for hours. The cluster blocks. 2PC has no escape from this window; only")
print("the coordinator's return (recovery, next) can release them.")`;
