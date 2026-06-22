// Chapter 07 — §3 (cardinality estimation), the hero's sandbox.
//
// One self-contained Python string seeded into <PythonSandbox>. The Pyodide
// runtime is shared across every sandbox on the page, so the string redefines
// everything it needs — no cross-sandbox state is assumed.
//
// Verified under python3 before shipping. The point it makes, mechanically:
//   1. build an equi-width histogram over a column (age),
//   2. estimate (age > x) selectivity off the histogram (uniform-within-bucket),
//   3. compare to the true count,
//   4. chain joins under the INDEPENDENCE assumption and watch the estimate
//      drift from reality MULTIPLICATIVELY — a 2x miss per join -> 16x over four.
//
// Exported as a string so the MDX integrator can drop it into the sandbox.

export const CARDINALITY_SANDBOX = `# Cardinality estimation by hand.
# The optimizer never runs the query: it must PREDICT how many rows each
# operator emits, from statistics gathered ahead of time. Here we build a
# histogram, read a predicate's selectivity off it, then chain joins under the
# independence assumption and watch the estimate diverge from reality.

import random
random.seed(7)

# ---- the data: a 'users' table with an 'age' column ------------------------
def make_ages(n=10_000):
    ages = []
    while len(ages) < n:
        # two clusters: a big young-adult bump, a smaller older one
        a = int(random.gauss(32, 11) if random.random() < 0.75 else random.gauss(60, 8))
        if 0 <= a < 80:
            ages.append(a)
    return ages

ages = make_ages()
N = len(ages)

# ---- equi-width histogram: 8 buckets of width 10 over [0, 80) --------------
BUCKETS, WIDTH = 8, 10

def build_histogram(values):
    counts = [0] * BUCKETS
    for v in values:
        counts[min(v // WIDTH, BUCKETS - 1)] += 1
    return counts

hist = build_histogram(ages)
print("histogram of age (the stats the optimizer stores):")
for b, c in enumerate(hist):
    print(f"  [{b*WIDTH:2d},{b*WIDTH+WIDTH:2d})  {c:5d}  {'#' * (c // 80)}")

# ---- estimate selectivity of (age > x) FROM THE HISTOGRAM ------------------
# Uniform-within-bucket assumption: the bucket holding x contributes the
# fraction of its width that lies above x; buckets fully above x contribute all.
def estimate_rows_gt(x):
    rows = 0.0
    for b in range(BUCKETS):
        lo, hi = b * WIDTH, b * WIDTH + WIDTH
        if lo >= x:
            rows += hist[b]
        elif hi > x:                       # x falls inside this bucket
            rows += hist[b] * (hi - x) / WIDTH
    return rows

def true_rows_gt(x):
    return sum(1 for a in ages if a > x)

x = 35
est = estimate_rows_gt(x)
act = true_rows_gt(x)
print(f"\\npredicate: age > {x}")
print(f"  estimated: selectivity {est/N:.3f}  (~{round(est)} rows)")
print(f"  true:      selectivity {act/N:.3f}  (~{act} rows)")
print(f"  single-predicate error: {est/act:.2f}x  (histograms are exact at")
print(f"                          bucket edges, approximate inside)")

# ---- the join chain, under the INDEPENDENCE assumption --------------------
# Each join to another table multiplies cardinality by a per-join fan-out.
# The estimator assumes columns are INDEPENDENT and uses fan-out fe. Reality
# has correlated columns, so the true fan-out is fe * corr (corr > 1): more
# rows survive than independence predicts. The error MULTIPLIES every join.
fe   = 3.0     # estimated fan-out per join (independence)
corr = 2.0     # per-join correlation the estimator misses

est_rows, act_rows = est, act
print("\\njoin chain (estimate vs actual rows out):")
print(f"  joins=0  est={est_rows:12,.0f}   act={act_rows:12,.0f}   off={act_rows/est_rows:6.1f}x")
for k in range(1, 5):
    est_rows *= fe                          # optimizer's view
    act_rows *= fe * corr                   # what actually happens
    print(f"  joins={k}  est={est_rows:12,.0f}   act={act_rows:12,.0f}   off={act_rows/est_rows:6.1f}x")

print(f"\\nA {corr:.0f}x miss per join compounds: 2 -> 4 -> 8 -> {corr**4:.0f}x over four joins.")
print("The plan is chosen from the ESTIMATE, but pays the ACTUAL bill.")
`;
