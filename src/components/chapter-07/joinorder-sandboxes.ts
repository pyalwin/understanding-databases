// §5/§6 — join ordering, built by hand. A tiny System R optimizer: left-deep
// plans + dynamic programming over subsets of tables, scored from ESTIMATED
// cardinalities (the §3 row counts). It never RUNS the joins — it searches the
// space of orders for the one that keeps the intermediate results small.
//
// Exported as strings so the MDX integrator seeds them into <PythonSandbox>.
// Each is self-contained valid Python; python3-verified.

// Shared optimizer core, repeated verbatim atop each sandbox so every string
// stands alone: the join-graph model, the cardinality/cost functions, and the
// System R subset-DP search.
const CORE = `from itertools import combinations


def selectivity(a, b, edges):
    # No edge between two tables -> they can only combine by cartesian product.
    return edges.get(frozenset([a, b]), 1.0)


def card(tables, sizes, edges):
    """Estimated rows when \`tables\` are joined together (order-independent)."""
    rows = 1.0
    for t in tables:
        rows *= sizes[t]
    ts = list(tables)
    for i in range(len(ts)):
        for j in range(i + 1, len(ts)):
            rows *= selectivity(ts[i], ts[j], edges)
    return rows


def cost_of_order(order, sizes, edges):
    """Sum of every intermediate result a left-deep plan materializes."""
    total = 0.0
    for k in range(2, len(order) + 1):
        total += card(frozenset(order[:k]), sizes, edges)
    return total


def optimize(sizes, edges):
    """System R DP: cheapest left-deep order, by growing subsets one table at a time."""
    tables = list(sizes)
    n = len(tables)
    best_cost = {}   # subset -> cheapest cost to produce it
    best_plan = {}   # subset -> the left-deep order that achieves it
    for t in tables:
        best_cost[frozenset([t])] = 0.0   # a base scan is ~free in this toy model
        best_plan[frozenset([t])] = [t]
    for size in range(2, n + 1):
        for combo in combinations(tables, size):
            s = frozenset(combo)
            this_card = card(s, sizes, edges)
            best = None
            for t in combo:               # t is the table joined ON last (left-deep)
                sub = s - frozenset([t])
                c = best_cost[sub] + this_card
                if best is None or c < best[0]:
                    best = (c, best_plan[sub] + [t])
            best_cost[s], best_plan[s] = best
    full = frozenset(tables)
    return best_plan[full], best_cost[full]


def shape(order):
    s = order[0]
    for t in order[1:]:
        s = "(" + s + " \\u22c8 " + t + ")"
    return s
`;

// §5 — the join-order search. A 4-table chain; a deliberately bad order forces
// a cartesian product that blows the middle result into the millions, while the
// DP search keeps every intermediate small. Prints both, side by side.
export const JOINORDER_SANDBOX = `${CORE}

# Base table sizes (rows). A tiny analytics schema joined in a chain.
SIZES = {
    "region":   5,
    "customer": 2000,
    "orders":   10000,
    "lineitem": 60000,
}

# The join graph: each predicate links two tables with a SELECTIVITY — the
# fraction of the cross-product that survives. Two tables with NO edge can only
# be combined by a cartesian product, which blows the intermediate up.
EDGES = {
    frozenset(["region", "customer"]): 1 / 5,      # region.id  = customer.region
    frozenset(["customer", "orders"]): 1 / 2000,   # customer.id = orders.custid
    frozenset(["orders", "lineitem"]): 1 / 10000,  # orders.id   = lineitem.orderid
}


def trace(order):
    print("    scan " + order[0].ljust(9) + " -> " +
          format(int(SIZES[order[0]]), ",").rjust(13) + " rows")
    for k in range(2, len(order) + 1):
        rows = card(frozenset(order[:k]), SIZES, EDGES)
        print("    join " + order[k - 1].ljust(9) + " -> " +
              format(int(rows), ",").rjust(13) + " rows  (intermediate)")


# A deliberately BAD order: join region and lineitem first. They share no
# predicate, so that is a 300,000-row cartesian product -- and adding customer
# to it explodes the next intermediate into the millions.
naive_order = ["region", "lineitem", "customer", "orders"]
print("NAIVE order (as written in the FROM clause):")
trace(naive_order)
naive_cost = cost_of_order(naive_order, SIZES, EDGES)
print("    plan: " + shape(naive_order))
print("    total cost (sum of intermediates): " + format(int(naive_cost), ","))
print()

best_order, best_cost = optimize(SIZES, EDGES)
print("DP-OPTIMIZED order (System R left-deep search):")
trace(best_order)
print("    plan: " + shape(best_order))
print("    total cost (sum of intermediates): " + format(int(best_cost), ","))
print()

print("The optimizer's order is " + format(naive_cost / best_cost, ",.0f") +
      "x cheaper --")
print("it keeps every intermediate small by always joining along a predicate.")
`;

// §6 — when the estimates lie. Same optimizer; we just feed it a WRONG
// cardinality. A correlated-column join breaks the independence assumption, so
// the estimator under-counts it 1000x. The planner schedules the "cheap" join
// first -- then it explodes for real. Fix the stats and the plan recovers.
export const WRONGSTATS_SANDBOX = `${CORE}

SIZES = {
    "promo":  10,         # tiny dimension
    "orders": 1000000,    # the big fact table
    "store":  10,         # tiny dimension
}

# What the optimizer BELIEVES (independence assumption). It thinks the
# promo-orders join is wildly selective.
EST_EDGES = {
    frozenset(["promo", "orders"]): 1e-7,   # estimate: ~1 row out. WRONG.
    frozenset(["store", "orders"]): 1e-6,   # estimate: ~10 rows out. correct.
}

# What ACTUALLY happens. promo and orders are correlated, so that join really
# emits 1000x more rows than the independence estimate predicted.
TRUE_EDGES = {
    frozenset(["promo", "orders"]): 1e-2,   # reality: 100,000 rows out!
    frozenset(["store", "orders"]): 1e-6,   # reality matches the estimate.
}

# 1) The optimizer plans using its (wrong) estimates...
plan_bad, _ = optimize(SIZES, EST_EDGES)
# ...but the bill is paid in REALITY:
true_cost_bad = cost_of_order(plan_bad, SIZES, TRUE_EDGES)
est_first = card(frozenset(plan_bad[:2]), SIZES, EST_EDGES)
true_first = card(frozenset(plan_bad[:2]), SIZES, TRUE_EDGES)

print("WITH STALE STATS (correlated columns, independence assumption):")
print("    optimizer picks: " + shape(plan_bad))
print("    joins " + plan_bad[0] + " \\u22c8 " + plan_bad[1] +
      " first, expecting " + format(int(est_first), ",") + " rows...")
print("    ...but that intermediate is REALLY " +
      format(int(true_first), ",") + " rows.")
print("    actual total cost: " + format(int(true_cost_bad), ","))
print()

# 2) Run ANALYZE / add multi-column statistics: the estimator now knows the
#    true correlation, so the optimizer plans against TRUE_EDGES.
plan_fixed, _ = optimize(SIZES, TRUE_EDGES)
true_cost_fixed = cost_of_order(plan_fixed, SIZES, TRUE_EDGES)

print("AFTER FIXING THE STATS (ANALYZE / extended statistics):")
print("    optimizer picks: " + shape(plan_fixed))
print("    now does the genuinely-selective " + plan_fixed[0] + " \\u22c8 " +
      plan_fixed[1] + " first.")
print("    actual total cost: " + format(int(true_cost_fixed), ","))
print()

print("Same optimizer, same data. One wrong number made the plan " +
      format(true_cost_bad / true_cost_fixed, ",.0f") + "x slower.")
print("This is why production databases obsess over statistics.")
`;
