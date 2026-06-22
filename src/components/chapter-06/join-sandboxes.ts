// §4/§5/§6 — the three join algorithms, built by hand as Volcano-style
// iterators over two tiny in-memory tables. Every sandbox joins the SAME data
// (users ⋈ orders on the user id) so the reader can put the comparison counts
// side by side: nested-loop ~n·m, hash ~n+m, sort-merge ~sort + (n+m).
//
// Exported as strings so the MDX integrator seeds them into <PythonSandbox>.
// Each is self-contained valid Python; python3-verified.

/* The shared dataset, repeated verbatim atop each sandbox so every string
 * stands alone. users is the smaller (build/outer-ish) side; orders the larger. */
const DATA = `# --- the two tables every join below runs on -------------------------
# users(id, name) — the smaller side
users = [
    (1, "Ada"),
    (2, "Bob"),
    (3, "Cy"),
    (4, "Di"),
    (5, "Eve"),
]
# orders(uid, item) — the larger side; uid references users.id
orders = [
    (3, "book"),
    (1, "pen"),
    (5, "ink"),
    (1, "ruler"),
    (3, "lamp"),
    (2, "case"),
    (5, "case"),
]
`;

// §4 — Nested-loop join. For each outer row, scan the WHOLE inner side.
// O(n·m): the comparison count is exactly len(users) * len(orders).
export const NESTEDLOOP_SANDBOX = `${DATA}
def nested_loop_join(outer, inner, key_o, key_i):
    """For each outer row, sweep the entire inner side looking for matches."""
    comparisons = 0
    for o in outer:                       # outer cursor steps once per row
        for i in inner:                   # inner cursor sweeps the whole side
            comparisons += 1              # one comparison per (o, i) pair
            if o[key_o] == i[key_i]:
                yield (o, i)
    yield ("__count__", comparisons)

result = []
comparisons = 0
for row in nested_loop_join(users, orders, key_o=0, key_i=0):
    if row[0] == "__count__":
        comparisons = row[1]
    else:
        o, i = row
        result.append((o[1], i[1]))       # (user name, order item)

print("nested-loop join  users \\u22c8 orders")
for name, item in result:
    print(f"  {name:<4} -> {item}")
print(f"\\nrows out    : {len(result)}")
print(f"comparisons : {comparisons}   (= {len(users)} x {len(orders)} = n*m)")
`;

// §5 — Hash join. BUILD a dict on the smaller side (blocking — must finish
// before any probe), then PROBE it with the larger side. O(n + m).
export const HASHJOIN_SANDBOX = `${DATA}
def hash_join(build_side, probe_side, key_b, key_p):
    """Build a hash table on the smaller side, then probe it with the larger."""
    comparisons = 0

    # --- BUILD phase (blocking: nothing is emitted until this finishes) ---
    table = {}
    for b in build_side:                  # one pass over the smaller side
        comparisons += 1                  # one insert ("touch") per build row
        table.setdefault(b[key_b], []).append(b)

    # --- PROBE phase (pipelined: emit matches as we stream the larger side) ---
    for p in probe_side:                  # one pass over the larger side
        comparisons += 1                  # one hash lookup per probe row
        for b in table.get(p[key_p], ()):
            yield (b, p)
    yield ("__count__", comparisons)

result = []
comparisons = 0
for row in hash_join(users, orders, key_b=0, key_p=0):  # users is smaller -> build
    if row[0] == "__count__":
        comparisons = row[1]
    else:
        b, p = row
        result.append((b[1], p[1]))

print("hash join  users \\u22c8 orders   (build on users, probe with orders)")
for name, item in result:
    print(f"  {name:<4} -> {item}")
print(f"\\nrows out    : {len(result)}")
print(f"comparisons : {comparisons}   (~ {len(users)} + {len(orders)} = n+m, not n*m)")
`;

// §6 — Sort-merge join. SORT both sides on the join key, then advance two
// cursors in lockstep merging. Cost is dominated by the two sorts; the merge
// itself is a single linear pass (with a small back-up for duplicate keys).
export const SORTMERGE_SANDBOX = `${DATA}
def sort_merge_join(left, right, key_l, key_r):
    """Sort both sides on the join key, then merge with two lockstep cursors."""
    comparisons = 0

    # --- SORT phase (blocking: both sides must be ordered before merging) ---
    L = sorted(left, key=lambda r: r[key_l])
    R = sorted(right, key=lambda r: r[key_r])

    # --- MERGE phase: walk both cursors forward together ---
    i = j = 0
    while i < len(L) and j < len(R):
        comparisons += 1
        if L[i][key_l] < R[j][key_r]:
            i += 1                        # left key is behind -> advance left
        elif L[i][key_l] > R[j][key_r]:
            j += 1                        # right key is behind -> advance right
        else:
            # keys match: emit every right row sharing this key, then advance.
            k = j
            while k < len(R) and R[k][key_r] == L[i][key_l]:
                comparisons += 1
                yield (L[i], R[k])
                k += 1
            i += 1
    yield ("__count__", comparisons)

result = []
comparisons = 0
for row in sort_merge_join(users, orders, key_l=0, key_r=0):
    if row[0] == "__count__":
        comparisons = row[1]
    else:
        l, r = row
        result.append((l[1], r[1]))

# output comes out already ordered by the join key — a free side effect.
print("sort-merge join  users \\u22c8 orders   (sorted by id, then merged)")
for name, item in sorted(result):
    print(f"  {name:<4} -> {item}")
print(f"\\nrows out    : {len(result)}")
print(f"comparisons : {comparisons}   (after sorting both sides; merge is one pass)")
print("note: the result is sorted on the join key for free.")
`;
