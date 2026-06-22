// Chapter 06 — Query Execution. Sandboxes for §1 (plan tree), §2 (iterator
// model), §3 (scan/filter/project), and §7 (aggregation & sort).
//
// Four self-contained Python strings seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so each string redefines
// its own operators — no cross-sandbox state is assumed.
//
// Every string verified under python3 before shipping:
//   PLANTREE_SANDBOX         -> prints three plan trees (structure only, no run)
//   ITERATOR_SANDBOX         -> pulls 3 rows one at a time through a SeqScan
//   SCANFILTERPROJECT_SANDBOX-> same result, 5 rows scanned vs 3 with an index
//   AGGSORT_SANDBOX          -> GROUP BY counts/sums + ORDER BY, blocking
//
// Exported as strings so the MDX integrator can drop them into the sandbox.

export const PLANTREE_SANDBOX = `# A query is DATA: a tree of operator objects. The SQL
#   SELECT name FROM users WHERE age > 30
# is not what runs -- this tree is. Leaves are data sources (a scan); interior
# nodes transform (filter, project); the root produces the final rows.
# Here we only BUILD and PRINT the tree. Running it is the next sandbox.

class Plan:
    """Base class for every operator node in a plan tree."""
    def __init__(self, *children):
        self.children = list(children)
    def label(self):
        return self.__class__.__name__
    def explain(self, depth=0):
        # Pretty-print the tree, root at top, leaves indented below.
        pad = "  " * depth
        arm = "" if depth == 0 else "-> "
        print(f"{pad}{arm}{self.label()}")
        for c in self.children:
            c.explain(depth + 1)

class SeqScan(Plan):
    def __init__(self, table):
        super().__init__()
        self.table = table
    def label(self):
        return f"SeqScan[{self.table}]"

class IndexScan(Plan):
    def __init__(self, table, index):
        super().__init__()
        self.table, self.index = table, index
    def label(self):
        return f"IndexScan[{self.table} using {self.index}]"

class Filter(Plan):
    def __init__(self, predicate_text, child):
        super().__init__(child)
        self.predicate_text = predicate_text
    def label(self):
        return f"Filter[{self.predicate_text}]"

class Project(Plan):
    def __init__(self, cols, child):
        super().__init__(child)
        self.cols = cols
    def label(self):
        return f"Project[{', '.join(self.cols)}]"

class HashJoin(Plan):
    def __init__(self, on, left, right):
        super().__init__(left, right)
        self.on = on
    def label(self):
        return f"HashJoin[on {self.on}]"

# SELECT name FROM users WHERE age > 30
plan = Project(["name"], Filter("age > 30", SeqScan("users")))
print("plan A -- SELECT name FROM users WHERE age > 30")
plan.explain()

# The SAME query, different tree: the planner could use the index on age.
# (Which one actually runs is the optimizer's job -- a later chapter.)
plan_idx = Project(["name"], IndexScan("users", "idx_age"))
print("\\nplan A' -- same answer, index leaf instead of a full scan")
plan_idx.explain()

# Add a join: SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id
plan_join = Project(
    ["users.name", "orders.total"],
    HashJoin(
        "users.id = orders.user_id",
        Filter("age > 30", SeqScan("users")),
        SeqScan("orders"),
    ),
)
print("\\nplan B -- a join of two tables")
plan_join.explain()
`;

export const ITERATOR_SANDBOX = `# The Volcano / iterator model. Every operator implements three methods:
#   open()  -- get ready to produce rows
#   next()  -- return the NEXT row, or None when exhausted
#   close() -- release resources
# The root is asked for a row; it calls next() on its child, which calls next()
# on ITS child, down to a leaf that reads an actual row. One row is in flight at
# a time -- this is pipelining: no intermediate result is ever materialized.

DONE = None  # next() returns DONE (None) when there are no more rows

class Operator:
    """The protocol every physical operator obeys."""
    def open(self):  ...
    def next(self):  ...
    def close(self):  ...

class SeqScan(Operator):
    """A leaf: hand back the table's rows one at a time."""
    def __init__(self, rows):
        self.rows = rows
        self.cursor = 0
    def open(self):
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.rows):
            return DONE
        row = self.rows[self.cursor]
        self.cursor += 1
        return row
    def close(self):
        self.cursor = 0

# A tiny "table": a list of row dicts.
users = [
    {"id": 1, "name": "Ada",   "age": 36},
    {"id": 2, "name": "Lin",   "age": 28},
    {"id": 3, "name": "Grace", "age": 45},
]

scan = SeqScan(users)

# Drive the operator by hand: open, pull until DONE, close. This while-loop is
# exactly what an interior operator does to its child.
scan.open()
pulled = 0
while True:
    row = scan.next()
    if row is DONE:
        break
    pulled += 1
    print(f"pull #{pulled}: {row}")
scan.close()
print(f"\\n{pulled} rows pulled, one at a time -- never more than one in flight.")
`;

export const SCANFILTERPROJECT_SANDBOX = `# Scan, Filter, Project as iterators -- the three simplest operators -- composed
# into the plan from the first sandbox, now RUNNABLE:
#   Project[name]( Filter[age > 30]( SeqScan[users] ) )
# Each operator pulls from its child's next() and transforms one row at a time.
# We count rows_scanned at the leaf to see what the leaf choice costs.

DONE = None

class SeqScan:
    """Read EVERY row of the table -- O(n)."""
    def __init__(self, rows):
        self.rows = rows
    def open(self):
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.rows):
            return DONE
        row = self.rows[self.cursor]
        self.cursor += 1
        scan_counter["rows"] += 1     # one heap row touched
        return row
    def close(self):
        pass

class IndexScan:
    """An alternative leaf: a B-tree on the key returns ONLY matching rows."""
    def __init__(self, rows, key, lo):
        # Pretend the index is a sorted structure; we seek to lo and walk.
        self.matches = [r for r in rows if r[key] > lo]
    def open(self):
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.matches):
            return DONE
        row = self.matches[self.cursor]
        self.cursor += 1
        scan_counter["rows"] += 1     # only matching rows are touched
        return row
    def close(self):
        pass

class Filter:
    """Pull from child; yield only rows where pred(row) is true."""
    def __init__(self, pred, child):
        self.pred, self.child = pred, child
    def open(self):
        self.child.open()
    def next(self):
        while True:
            row = self.child.next()
            if row is DONE:
                return DONE
            if self.pred(row):       # an internal re-pull on a miss
                return row
    def close(self):
        self.child.close()

class Project:
    """Pull from child; keep only the requested columns."""
    def __init__(self, cols, child):
        self.cols, self.child = cols, child
    def open(self):
        self.child.open()
    def next(self):
        row = self.child.next()
        if row is DONE:
            return DONE
        return {c: row[c] for c in self.cols}
    def close(self):
        self.child.close()

def run(plan):
    plan.open()
    out = []
    while True:
        row = plan.next()
        if row is DONE:
            break
        out.append(row)
    plan.close()
    return out

users = [
    {"id": 1, "name": "Ada",   "age": 36},
    {"id": 2, "name": "Lin",   "age": 28},
    {"id": 3, "name": "Grace", "age": 45},
    {"id": 4, "name": "Omar",  "age": 19},
    {"id": 5, "name": "Wei",   "age": 52},
]

# Plan 1: full scan + filter + project.
scan_counter = {"rows": 0}
plan = Project(["name"], Filter(lambda r: r["age"] > 30, SeqScan(users)))
result = run(plan)
print("Project[name](Filter[age>30](SeqScan[users]))")
print("  result:", result)
print("  rows scanned at the leaf:", scan_counter["rows"])

# Plan 2: same answer, but an index leaf only touches the matching rows.
scan_counter = {"rows": 0}
plan_idx = Project(["name"], IndexScan(users, "age", 30))
result_idx = run(plan_idx)
print("\\nProject[name](IndexScan[users on age > 30])")
print("  result:", result_idx)
print("  rows scanned at the leaf:", scan_counter["rows"])
print("\\nSame rows out, fewer rows touched -- the leaf choice already changes cost.")
`;

export const AGGSORT_SANDBOX = `# GROUP BY and ORDER BY -- the BLOCKING operators. Unlike Filter/Project (which
# emit a row as soon as they have one), these must consume ALL their input
# before they can emit anything:
#   HashAggregate -- a group's final value isn't known until the last row lands.
#   Sort          -- you can't know the first row of sorted output until you've
#                    seen them all.
# Both buffer their whole input in memory (or spill to disk), and they stall the
# pipeline until the source is exhausted.

DONE = None

class SeqScan:
    def __init__(self, rows):
        self.rows = rows
    def open(self):
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.rows):
            return DONE
        r = self.rows[self.cursor]
        self.cursor += 1
        return r
    def close(self):
        pass

class HashAggregate:
    """GROUP BY group_cols, accumulating an aggregate per group.
    BLOCKING: drains the child fully in open() before emitting anything."""
    def __init__(self, group_cols, agg_col, agg, child):
        self.group_cols, self.agg_col = group_cols, agg_col
        self.agg, self.child = agg, child   # agg in {"count","sum"}
    def open(self):
        self.child.open()
        table = {}                          # group-key -> accumulator
        while True:                         # <-- consume EVERYTHING first
            row = self.child.next()
            if row is DONE:
                break
            key = tuple(row[c] for c in self.group_cols)
            if key not in table:
                table[key] = 0
            if self.agg == "count":
                table[key] += 1
            elif self.agg == "sum":
                table[key] += row[self.agg_col]
        self.child.close()
        # Only now -- after the last row -- can we produce results.
        self.out = []
        for key, val in table.items():
            row = dict(zip(self.group_cols, key))
            row[f"{self.agg}({self.agg_col or '*'})"] = val
            self.out.append(row)
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.out):
            return DONE
        r = self.out[self.cursor]
        self.cursor += 1
        return r
    def close(self):
        pass

class Sort:
    """ORDER BY keys. BLOCKING: buffers all rows in open(), then releases
    them in order."""
    def __init__(self, keys, child, desc=False):
        self.keys, self.child, self.desc = keys, child, desc
    def open(self):
        self.child.open()
        self.buffer = []
        while True:                         # <-- buffer EVERY row
            row = self.child.next()
            if row is DONE:
                break
            self.buffer.append(row)
        self.child.close()
        self.buffer.sort(key=lambda r: tuple(r[k] for k in self.keys),
                          reverse=self.desc)
        self.cursor = 0
    def next(self):
        if self.cursor >= len(self.buffer):
            return DONE
        r = self.buffer[self.cursor]
        self.cursor += 1
        return r
    def close(self):
        pass

def run(plan):
    plan.open()
    out = []
    while True:
        r = plan.next()
        if r is DONE:
            break
        out.append(r)
    plan.close()
    return out

sales = [
    {"region": "west", "rep": "Ada",   "amount": 90},
    {"region": "east", "rep": "Lin",   "amount": 40},
    {"region": "west", "rep": "Omar",  "amount": 60},
    {"region": "east", "rep": "Grace", "amount": 75},
    {"region": "west", "rep": "Wei",   "amount": 30},
]

# GROUP BY region -- count and sum.
print("SELECT region, COUNT(*)  FROM sales GROUP BY region")
for r in run(HashAggregate(["region"], None, "count", SeqScan(sales))):
    print("  ", r)

print("\\nSELECT region, SUM(amount) FROM sales GROUP BY region")
for r in run(HashAggregate(["region"], "amount", "sum", SeqScan(sales))):
    print("  ", r)

# ORDER BY amount DESC -- the whole input is buffered, then released in order.
print("\\nSELECT * FROM sales ORDER BY amount DESC")
for r in run(Sort(["amount"], SeqScan(sales), desc=True)):
    print("  ", r)

print("\\nBoth operators had to see the LAST row before emitting the FIRST.")
`;
