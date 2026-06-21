/**
 * §7 — The Payoff. Seed SQL for the SQLite (sql.js) sandbox.
 *
 * Runs end-to-end in a single connection and demonstrates, by the engine's
 * own names, the three access paths the reader built by hand earlier in the
 * chapter:
 *
 *   1. SCAN accounts                                  → §3 the full scan
 *   2. SEARCH accounts USING INDEX ...                → §4/§5 the index seek
 *   3. SEARCH accounts USING COVERING INDEX ...       → §6 the covering index
 *
 * Verified against the sqlite3 CLI (3.51.0) — these exact plan lines appear.
 */
export const SQL_PAYOFF = `-- §7 THE PAYOFF: the same mechanisms you built by hand, named by a real engine.

-- A heap table (§2): rows land wherever there's room, in no useful order.
CREATE TABLE accounts (
  id      INTEGER PRIMARY KEY,   -- the rowid: SQLite's physical row address
  owner   TEXT    NOT NULL,      -- what we'll search by; NOT the rowid
  balance INTEGER NOT NULL
);

-- Seed a few thousand rows with a recursive CTE (no host language needed).
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 5000
)
INSERT INTO accounts (id, owner, balance)
SELECT n, 'user_' || n, (n * 37) % 10000
FROM seq;

-- ── §3 THE FULL SCAN ────────────────────────────────────────────────
-- No index on \`owner\`, so the planner can only read every page, every row.
-- Expect:  SCAN accounts   <- SQLite's own name for the §3 sequential scan.
EXPLAIN QUERY PLAN
SELECT balance FROM accounts WHERE owner = 'user_4242';

-- ── §4/§5 THE INDEX SEEK ────────────────────────────────────────────
-- Build a B-tree on \`owner\`. Descent is O(log n) with huge fan-out (§5).
CREATE INDEX idx_accounts_owner ON accounts(owner);

-- Same query, same predicate -- now the planner descends the B-tree.
-- Expect:  SEARCH accounts USING INDEX idx_accounts_owner (owner=?)
--          <- the §4 index seek, then a hop back to the heap for \`balance\`.
EXPLAIN QUERY PLAN
SELECT balance FROM accounts WHERE owner = 'user_4242';

-- ── §6 THE COVERING INDEX ───────────────────────────────────────────
-- Put \`balance\` in the index too, so the leaf carries every column the
-- query needs. The heap hop from §6 disappears entirely.
CREATE INDEX idx_accounts_owner_balance ON accounts(owner, balance);

-- Expect:  SEARCH accounts USING COVERING INDEX idx_accounts_owner_balance (owner=?)
--          <- descent only. No trip back to the heap. This is §6's payoff.
EXPLAIN QUERY PLAN
SELECT balance FROM accounts WHERE owner = 'user_4242';
`;
