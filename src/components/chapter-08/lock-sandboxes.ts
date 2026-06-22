// Chapter 08 — Locking & Concurrency. Sandboxes for §1 (the conflict / lost
// update) and §2 (shared & exclusive locks).
//
// Two self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own machinery — no cross-sandbox state is assumed. They open the
// chapter's accumulating build: a scheduler that interleaves two transactions
// (the lost update, no locks), then a single-item Lock that enforces the S/X
// compatibility matrix and queues conflicting requests.
//
// Every string verified under python3 before shipping — both the raw body AND
// the exact exported template-literal string that reaches Pyodide (a ch06/ch07
// lesson):
//   CONFLICT_SANDBOX -> lost-update interleaving; final 150 (should be 200)
//   LOCKS_SANDBOX    -> Lock.acquire/release; S/S together, X waits for S
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

// §1 — The conflict. Two transactions, no coordination. A scheduler runs their
// steps in an interleaved order; both read 100, both add 50, both write 150.
// One update is silently lost: the account ends at 150 when it should be 200.
export const CONFLICT_SANDBOX = `# THE LOST UPDATE — re-staged from Chapter 1, now as a concrete schedule.
# Two transactions both deposit 50 into the same account (starts at 100).
# Run serially the answer is 200. Interleave them with NO locks and one
# deposit vanishes. We model each transaction as a list of steps and let a
# scheduler run the steps in whatever order we hand it.

DB = {"balance": 100}          # the shared item, on disk
LOCAL = {}                     # each txn's private scratch (its register)

def read(txn, item):
    LOCAL[txn] = DB[item]
    print(f"  {txn}: read  {item} = {DB[item]}  -> local register")

def add(txn, amount):
    LOCAL[txn] += amount
    print(f"  {txn}: add   {amount}            -> register now {LOCAL[txn]}")

def write(txn, item):
    DB[item] = LOCAL[txn]
    print(f"  {txn}: write {item} = {LOCAL[txn]}  -> back to disk")

# Each step is (transaction, operation). The SCHEDULE is the interleaving.
def step(txn, op, *args):
    return (txn, op, args)

T1 = [step("T1", read, "balance"), step("T1", add, 50), step("T1", write, "balance")]
T2 = [step("T2", read, "balance"), step("T2", add, 50), step("T2", write, "balance")]

# The damaging interleaving: T1 reads, T2 reads (BEFORE T1 writes), both add,
# both write. T2's read saw the stale 100, so its write clobbers T1's.
schedule = [T1[0], T2[0], T1[1], T2[1], T1[2], T2[2]]

print("schedule: R1 R2 A1 A2 W1 W2   (T2 reads before T1 writes)\\n")
for txn, op, args in schedule:
    op(txn, *args)

print(f"\\nfinal balance = {DB['balance']}")
print("expected      = 200   (100 + 50 + 50)")
print("LOST UPDATE: T1's deposit was overwritten -> one +50 disappeared.")
print("The two writes to 'balance' were never ORDERED. A lock orders them.")
`;

// §2 — Shared & exclusive locks. A single-item Lock enforcing the compatibility
// matrix: many S holders may coexist; X is exclusive. Conflicting requests are
// queued and granted when the conflict clears on release().
export const LOCKS_SANDBOX = `# SHARED (S) and EXCLUSIVE (X) locks on ONE item, with the compatibility
# matrix as the whole rule:  S/S compatible;  S/X, X/S, X/X conflict.
# Many readers share; a writer is alone. A request that conflicts with what
# is already granted WAITS in a queue until release() clears the conflict.

def compatible(held_modes, want):
    # An empty holder set is compatible with anything. Otherwise: only S-with-S.
    if not held_modes:
        return True
    if want == "S" and all(m == "S" for m in held_modes):
        return True
    return False

class Lock:
    def __init__(self, item):
        self.item = item
        self.granted = {}        # txn -> mode currently held
        self.queue = []          # [(txn, mode)] waiting, in arrival order (FIFO)

    def acquire(self, txn, mode):
        held = list(self.granted.values())
        if compatible(held, mode):
            self.granted[txn] = mode
            print(f"  GRANT  {txn} {mode} on {self.item}   held={self._held()}")
            return "granted"
        self.queue.append((txn, mode))
        why = "+".join(held) if held else "-"
        print(f"  WAIT   {txn} {mode} on {self.item}   (conflicts with {why}) -> queue")
        return "waiting"

    def release(self, txn):
        if txn not in self.granted:
            return
        del self.granted[txn]
        print(f"  RELEASE {txn} on {self.item}            held={self._held()}")
        self._wake()

    def _wake(self):
        # Grant from the FRONT of the queue while the next waiter is compatible
        # (FIFO, so a blocked X doesn't get jumped by later S requests).
        while self.queue:
            txn, mode = self.queue[0]
            if not compatible(list(self.granted.values()), mode):
                break
            self.queue.pop(0)
            self.granted[txn] = mode
            print(f"  WAKE   {txn} {mode} on {self.item}    held={self._held()}")

    def _held(self):
        return "{" + ", ".join(f"{t}:{m}" for t, m in self.granted.items()) + "}"

lock = Lock("balance")

print("--- two readers share (S/S compatible) ---")
lock.acquire("T1", "S")
lock.acquire("T2", "S")

print("\\n--- a writer must wait while any S is held (S/X conflict) ---")
lock.acquire("T3", "X")        # queued: two S holders block it

print("\\n--- readers release; the writer wakes once the item is free ---")
lock.release("T1")             # one reader gone, T2 still holds S -> still waits
lock.release("T2")             # last reader gone -> T3's X is granted

print("\\nThe matrix is the entire policy: read-read is free, anything")
print("touching a write serializes.")
`;
