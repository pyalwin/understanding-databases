// Chapter 07 — The Query Optimizer. Sandboxes for §1 (the plan space),
// §2 (the cost model), and §4 (access-path selection).
//
// Three self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own operators — no cross-sandbox state is assumed. They reuse ch06's
// operator vocabulary (SeqScan / IndexScan / Filter / Project / joins).
//
// Every string verified under python3 before shipping:
//   PLANSPACE_SANDBOX   -> enumerates 3 equivalent plans for one query
//   COSTMODEL_SANDBOX   -> cost(plan, stats); the cheap plan wins by ~79,000x
//   ACCESSPATH_SANDBOX  -> seq-vs-index crossover swept across selectivity
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

export const PLANSPACE_SANDBOX = `# One query, many equivalent PLANS. The SQL
#   SELECT u.name, o.total
#     FROM users u JOIN orders o ON u.id = o.user_id
#     WHERE u.age > 30
# can be computed by several physically different operator trees (ch06's
# operators). They all return the SAME rows; they cost wildly different
# amounts. Here we only ENUMERATE a few and print them with a PLACEHOLDER
# cost -- scoring them for real is the cost model (next sandbox).

class Op:
    def __init__(self, *children):
        self.children = list(children)
    def label(self):
        return self.__class__.__name__
    def show(self, depth=0):
        pad = "   " * depth
        arm = "" if depth == 0 else "|- "
        print(f"{pad}{arm}{self.label()}")
        for c in self.children:
            c.show(depth + 1)

class SeqScan(Op):
    def __init__(self, t): super().__init__(); self.t = t
    def label(self): return f"SeqScan({self.t})            # read every page"

class IndexScan(Op):
    def __init__(self, t, ix): super().__init__(); self.t, self.ix = t, ix
    def label(self): return f"IndexScan({self.t} via {self.ix})  # seek; few fetches"

class Filter(Op):
    def __init__(self, pred, child): super().__init__(child); self.pred = pred
    def label(self): return f"Filter({self.pred})"

class Project(Op):
    def __init__(self, cols, child): super().__init__(child); self.cols = cols
    def label(self): return f"Project({self.cols})"

class HashJoin(Op):
    def __init__(self, on, l, r): super().__init__(l, r); self.on = on
    def label(self): return f"HashJoin(on {self.on})       # build a hash table once"

class NestedLoopJoin(Op):
    def __init__(self, on, l, r): super().__init__(l, r); self.on = on
    def label(self): return f"NestedLoopJoin(on {self.on}) # RESCAN inner per outer row"

# Three equivalent physical plans for the SAME query:
planA = Project("u.name,o.total",
            HashJoin("u.id=o.user_id",
                Filter("u.age>30", SeqScan("users")),
                SeqScan("orders")))

planB = Project("u.name,o.total",
            HashJoin("u.id=o.user_id",
                IndexScan("users", "idx_age"),
                SeqScan("orders")))

planC = Project("u.name,o.total",
            NestedLoopJoin("u.id=o.user_id",
                SeqScan("orders"),
                Filter("u.age>30", SeqScan("users"))))

plans = {
    "A  hash join, scan+filter users": planA,
    "B  hash join, index on users.age": planB,
    "C  nested-loop join (no index)": planC,
}
for name, plan in plans.items():
    print(f"=== plan {name}   cost = ???  (scored in the cost model) ===")
    plan.show()
    print()

print("All three emit identical rows. Their costs are NOT identical --")
print("plan C rescans 'orders' once per matching user and is a disaster.")
print("Correctness is shared across the plan space; cost is not.")
`;

export const COSTMODEL_SANDBOX = `# The COST MODEL: score a plan you will NOT run. A plan's cost is, roughly,
#   cost ~= page reads (ch04/05)  +  cpu_per_row * rows processed
# summed up the operator tree. Page reads dominate; the buffer pool (ch05) may
# turn some into cheap hits, so this estimates *logical* IO. Row counts come
# from selectivity estimates (the hard part -- cardinality estimation, next).
# We cost the plans from the previous sandbox and watch the cheap one win.

CPU = 0.01          # cpu cost to process one row -- cheap, but it adds up
IO  = 1.0           # cost of reading one page

STATS = {
    "users":  {"rows": 100_000, "pages": 1_000},   # 100 rows per page
    "orders": {"rows": 500_000, "pages": 6_000},
    "sel_age>30": 0.40,                 # ~40% of users are over 30
    "fetch_per_match": 1.0,             # index: ~1 random heap fetch per match
}

class Op:
    def __init__(self, *children): self.children = list(children)
class SeqScan(Op):
    def __init__(self, t): super().__init__(); self.t = t
class IndexScan(Op):
    def __init__(self, t, sel): super().__init__(); self.t, self.sel = t, sel
class Filter(Op):
    def __init__(self, sel, child): super().__init__(child); self.sel = sel
class Project(Op):
    def __init__(self, child): super().__init__(child)
class HashJoin(Op):
    def __init__(self, l, r, join_sel): super().__init__(l, r); self.join_sel = join_sel
class NestedLoopJoin(Op):
    def __init__(self, l, r, join_sel): super().__init__(l, r); self.join_sel = join_sel

def cost(node):
    """Return (total_cost, rows_out) for a plan subtree, bottom-up."""
    if isinstance(node, SeqScan):
        st = STATS[node.t]
        return st["pages"] * IO + st["rows"] * CPU, st["rows"]
    if isinstance(node, IndexScan):
        st = STATS[node.t]
        matched = st["rows"] * node.sel
        # one btree descent + a random heap fetch per matching row
        return 3 * IO + matched * STATS["fetch_per_match"] * IO + matched * CPU, matched
    if isinstance(node, Filter):
        c, rows = cost(node.children[0])
        return c + rows * CPU, rows * node.sel
    if isinstance(node, Project):
        c, rows = cost(node.children[0])
        return c + rows * CPU, rows
    if isinstance(node, HashJoin):
        lc, lr = cost(node.children[0])
        rc, rr = cost(node.children[1])
        # scan both inputs once; build+probe a hash table
        return lc + rc + (lr + rr) * CPU, lr * rr * node.join_sel
    if isinstance(node, NestedLoopJoin):
        lc, lr = cost(node.children[0])
        rc, rr = cost(node.children[1])
        # the inner subtree is re-evaluated for EVERY outer row
        return lc + lr * rc + (lr * rr) * CPU, lr * rr * node.join_sel
    raise TypeError(node)

SEL = STATS["sel_age>30"]
JOIN_SEL = 1.0 / STATS["users"]["rows"]    # join on the unique users.id

planA = Project(HashJoin(Filter(SEL, SeqScan("users")), SeqScan("orders"), JOIN_SEL))
planC = Project(NestedLoopJoin(SeqScan("orders"), Filter(SEL, SeqScan("users")), JOIN_SEL))

results = []
for name, plan in [("A  hash join (scan+filter)", planA),
                   ("C  nested-loop join", planC)]:
    c, rows = cost(plan)
    results.append((name, c))
    print(f"plan {name:28s} cost = {c:16,.0f}   rows out = {rows:,.0f}")

results.sort(key=lambda r: r[1])
cheap, dear = results[0], results[-1]
print(f"\\nchosen: plan {cheap[0].strip()}")
print(f"it is {dear[1] / cheap[1]:,.0f}x cheaper than the nested-loop plan.")
print("Cost is mechanical GIVEN the row counts. Everything now rides on")
print("estimating those row counts -- that is cardinality estimation.")
`;

export const ACCESSPATH_SANDBOX = `# ACCESS-PATH SELECTION: the ch04 EXPLAIN QUERY PLAN payoff. For "WHERE col ?"
# the planner picks between a SEQ SCAN (read every page -- ch04's "SCAN") and an
# INDEX SCAN (a B-tree seek, then a heap fetch per match -- ch04's "SEARCH USING
# INDEX"). Which wins is a COST comparison, and it turns on *selectivity*: the
# fraction of rows the predicate keeps. Few matches -> index wins; many matches
# -> the index's random fetches cost more than one sequential sweep.

def seq_scan_cost(table_pages):
    # read every page, top to bottom -- cost is independent of selectivity
    return table_pages

def index_scan_cost(selectivity, table_rows, fetch_per_match=1.0, btree_descent=3):
    matched = selectivity * table_rows
    # descend the B-tree once, then one random heap fetch per matching row
    return btree_descent + matched * fetch_per_match

def choose_access_path(selectivity, table_rows, table_pages):
    seq = seq_scan_cost(table_pages)
    idx = index_scan_cost(selectivity, table_rows)
    return ("INDEX (SEARCH)", idx) if idx < seq else ("SEQ (SCAN)", seq)

# A table like ch04's: 100k rows packed 100 per page -> 1000 pages.
TABLE_ROWS, TABLE_PAGES = 100_000, 1_000

print(f"table: {TABLE_ROWS:,} rows in {TABLE_PAGES:,} pages "
      f"({TABLE_ROWS // TABLE_PAGES} rows/page)\\n")
print(f"{'selectivity':>11} {'matches':>9} {'seq cost':>10} {'index cost':>11}   winner")

# a curated sweep, dense around the crossover so the flip is visible
sels = [0.001, 0.005, 0.01, 0.02, 0.05, 0.10, 0.25, 0.50, 1.00]
prev = None
crossover = None
for sel in sels:
    winner, _ = choose_access_path(sel, TABLE_ROWS, TABLE_PAGES)
    seq = seq_scan_cost(TABLE_PAGES)
    idx = index_scan_cost(sel, TABLE_ROWS)
    matched = int(sel * TABLE_ROWS)
    print(f"{sel:>11.3f} {matched:>9,} {seq:>10,.0f} {idx:>11,.0f}   {winner}")
    if prev is not None and prev != winner and crossover is None:
        crossover = sel
    prev = winner

# Solve seq == index exactly: table_pages = btree + sel*rows
exact = (TABLE_PAGES - 3) / TABLE_ROWS
print(f"\\ncrossover near selectivity ~= {exact:.4f} "
      f"({exact * 100:.2f}% of rows, ~{int(exact * TABLE_ROWS):,} matches).")
print("Below it the index (SEARCH) wins; above it the seq scan (SCAN) wins.")
print("A COVERING index (ch04 sec.6) skips the heap fetch, pushing the")
print("crossover much higher -- the index stays cheaper for longer.")
`;
