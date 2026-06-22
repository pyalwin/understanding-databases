# Chapter 06 — Design Spec

**Status:** Approved (design); implementation
**Date:** 2026-06-22
**Scope:** Author Chapter 06 — "Query Execution" — picking up ch05's closing question ("we can fetch any page fast; which pages *should* a query touch, and how?"). Build a query executor by hand in Python: a plan tree, the Volcano/iterator model, the physical operators (scan, filter, project), and the three join algorithms (nested-loop, hash, sort-merge), plus aggregation and sort. Ends by teasing ch07 (the optimizer — *who chooses* the plan).

> Shares the entire reading shell, voice, and component conventions of Chapters 01–05. Where this spec is silent, the Chapter 04 and 05 specs are authoritative (esp. ch04 §4 Technical Architecture, ch05 §5 gotchas). This chapter is the first half of the two-chapter split of query processing; **ch07 (Query Optimizer) is a separate spec/wave.**

---

## 1. Goal

ch05 ended: *"We can fetch any page fast now. We still have no idea which pages a query should touch. That's the next chapter."* This chapter answers the *how a query runs* half. A SQL statement says **what** you want, not **how** to get it. The engine turns it into a **plan** — a tree of physical **operators** — and runs that tree by pulling rows up through it. The reader builds that machinery: the operators, the iterator protocol that drives them, and the three ways to join two tables. The *which plan and why* question is deliberately deferred to ch07.

### Success criteria
- A reader can explain: (a) that a query is compiled into a tree of operators (scan/filter/project/join/aggregate/sort) and that the tree, not the SQL, is what runs; (b) the **Volcano / iterator model** — every operator exposes `open`/`next`/`close`, rows are pulled one at a time from the root down, and most operators are *pipelined* (no materialization) while some (sort, hash-build) are *blocking*; (c) the three **join algorithms** — nested-loop (O(n·m), great for tiny/indexed inner), hash (O(n+m), the workhorse for equijoins), sort-merge (wins when inputs are already sorted or for range/merge cases) — and the cost trade between them; (d) how **GROUP BY** and **ORDER BY** are executed (hash aggregation vs sort), and why blocking operators stall a pipeline.
- Built by hand in Python over the ch04 heap/B-tree mental model (the executor reads "pages"/rows from a tiny table abstraction). Construction ethos from ch02/04/05; accumulating sandboxes. No sql.js (we're building the engine, not driving one) — though §1 may *show* an `EXPLAIN`-style plan tree for familiarity.
- Connects backward (ch04 SeqScan/IndexScan + the `EXPLAIN QUERY PLAN` we saw; ch05 pages/buffer-pool as what scans pull through) and forward (ch07 optimizer chooses among these operators/orders; ch08 locking once numbering is fixed).
- Every scene works at 390px. Word budget ~6500–7000.

---

## 2. Continuity
### Backward
- **ch05 §8** is the literal handoff ("which pages should a query touch?") — §0 opens on it.
- **ch04** built `SeqScan` (the O(n) heap scan) and `IndexScan` (B-tree seek), and showed `EXPLAIN QUERY PLAN` printing `SCAN` vs `SEARCH USING INDEX`. ch06 §3 makes those the first two operators by name; the *choice* between them is named as ch07's job (the EXPLAIN payoff lands fully in ch07).
- **ch05** pages/buffer pool: a scan operator pulls pages that the buffer pool serves; reference it when discussing operator cost (cheap if hot, expensive if cold).
- **ch03** range scans / predicates: a `WHERE` becomes a Filter (or an index range scan) — tie the phantom discussion's "range" back here.
### Forward
- **§8 teases ch07 (the optimizer):** the same query has many valid operator trees with wildly different costs; choosing one is a whole problem of its own. Do **not** build cost/cardinality here — that's ch07.
- Mention locking/concurrency as **ch08** (post-renumber). The renumber sweep (separate task) makes the rest of the book's numbers consistent; ch06 itself should only forward-ref ch07 (optimizer) and, lightly, ch08 (locking).

---

## 3. Chapter 06 Spine

| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | ch05 callback. SQL says *what*, not *how*. The engine compiles a query into a tree of operators and runs the tree. |
| 1 | the-plan-tree | prose + `PlanTreeScene` + Python | A `SELECT … WHERE … ` becomes a tree: Scan → Filter → Project (root at top, data sources at leaves). Read a plan tree; relate it to `EXPLAIN`. |
| 2 | the-iterator-model | prose + `VolcanoScene` + Python | The **Volcano/iterator model**: every operator has `open`/`next`/`close`; the root's `next()` pulls one row by recursively pulling from children. Pipelining; one row in flight. |
| 3 | scan-filter-project | prose + Python | Build `SeqScan` (over the ch04 heap), `Filter(pred)`, `Project(cols)` as iterators and compose them. Re-meet ch04's `IndexScan` as an alternative leaf. |
| 4 | nested-loop-join | prose + `JoinScene` (HERO) + Python | The first join: for each outer row, scan the inner. O(n·m). Cheap when inner is tiny or indexed (index-nested-loop); ruinous otherwise. |
| 5 | hash-join | prose + (reuses `JoinScene`) + Python | Build a hash table on the smaller side, probe with the other. O(n+m) for equijoins. The build side is **blocking**. The workhorse. |
| 6 | sort-merge-join | prose + (reuses `JoinScene`) + Python | Sort both inputs, merge in one pass. Wins when inputs are already sorted (e.g. a clustered index) or for merge/range scenarios. |
| 7 | aggregation-and-sort | prose + `AggSortScene` + Python | `GROUP BY` via hash aggregation; `ORDER BY` via sort. Blocking vs pipelined operators and why a sort stalls the pipeline until the last row. |
| 8 | whats-next | prose | We can *run* any plan. But one query has many valid plans whose costs differ by orders of magnitude. Who picks, and how? Tease **ch07 — the query optimizer**. |
| 9 | sources | bibliography | Curated, annotated. |

---

### Scene 0 — Premise *(prose)*
Open on ch05's handoff. The engine can fetch pages fast; now a user types `SELECT name FROM users WHERE age > 30`. That sentence names a result, not a procedure. Between the SQL and the answer sits the part of the engine that decides *how*: it compiles the query into a **plan** — a tree of operators, each doing one small thing (scan a table, drop rows that fail a predicate, keep some columns, join two inputs) — and then runs the tree. This chapter builds the running. Commit to the shape: plan tree, the iterator protocol that drives it, the operators, the joins, and the blocking ones that have to see all their input before they can emit a row. **Reveals:** a query is data; the plan is the program; the executor is the interpreter.

### Scene 1 — The Plan Tree *(prose + `PlanTreeScene` + Python)*
A query is a tree. Leaves are data sources (a table scan, an index scan); interior nodes transform (filter, project, join, sort, aggregate); the root produces the final rows. Data flows up; control (the `next()` pull) flows down.

**Scene (`PlanTreeScene`):** Render the operator tree for a small query (e.g. `SELECT name FROM users WHERE age > 30`): `Project[name]` → `Filter[age>30]` → `SeqScan[users]`. Let the reader toggle the query between a couple of presets (add a join, swap scan→index scan) and watch the tree change. Annotate each node with what it does. Optionally show the `EXPLAIN`-style text beside the tree to connect to ch04.

**Sandbox (Python):** A tiny `Row`/table abstraction and a plan represented as nested operator objects; print the tree. No execution yet — just structure. Self-contained.

**Prose unpacks:** SQL is declarative; the planner/executor are where "how" lives; the same query can map to different trees (foreshadow ch07). **Reveals:** the tree is the unit of execution.

### Scene 2 — The Iterator Model *(prose + `VolcanoScene` + Python)*
How the tree runs. The **Volcano (iterator) model**: every operator implements `open()`, `next()` (returns the next row or "done"), and `close()`. The root is asked for a row; it calls `next()` on its child, which calls `next()` on *its* child, down to a leaf that reads an actual row — then the row flows back up, transformed at each level. One row is in flight at a time; this is **pipelining**.

**Scene (`VolcanoScene`):** Animate a single `next()` pull traveling down the tree to a leaf and a row bubbling back up through Filter/Project to the root, step by step. A "pull next row" button drives it; show rows being skipped by Filter (a `next()` that pulls again internally). Make the demand-driven, one-row-at-a-time nature visceral.

**Sandbox (Python):** Define the operator base protocol (`open/next/close`) and a `SeqScan` leaf; drive it with a `while` loop pulling rows. Self-contained.

**Prose unpacks:** demand-driven vs push; why pipelining keeps memory bounded (you don't materialize intermediate results); name that some operators can't be pipelined (§7). Reference ch05: each leaf `next()` ultimately pulls a page through the buffer pool. **Reveals:** execution is a recursive pull from the root.

### Scene 3 — Scan, Filter, Project *(prose + Python)*
Build the three simplest operators as iterators and compose them into the §1 tree, now runnable. `SeqScan` reads every row of the ch04 heap; `Filter(pred)` pulls from its child and yields only rows passing `pred`; `Project(cols)` pulls and reshapes. Re-introduce ch04's `IndexScan` as an alternative leaf that returns only matching rows via the B-tree.

**Sandbox (Python):** Implement `SeqScan`, `Filter`, `Project` over a seeded in-memory table; run `Project[name](Filter[age>30](SeqScan[users]))` and print results + rows-scanned. Then swap in `IndexScan` and show fewer rows touched. Self-contained. **Reveals:** real queries are these small pieces stacked; the leaf choice (seq vs index) already changes cost (→ ch07).

### Scene 4 — Nested-Loop Join *(prose + `JoinScene` (HERO) + Python)*
The hero scene: joining two tables, three ways, starting with the obvious one. **Nested-loop join:** for each row of the outer input, scan the entire inner input for matches. O(n·m). It's the right choice when the inner is tiny, or when the inner has an index on the join key (**index-nested-loop** — each outer row does a cheap B-tree seek instead of a full inner scan). It's catastrophic for two large unindexed tables.

**Scene (`JoinScene`):** A reusable join visualizer used in §4/§5/§6. For nested-loop: two row lists (outer/inner); animate the outer cursor stepping, and for each outer row the inner cursor sweeping the whole inner, matches highlighted; a comparisons counter climbing as n·m. A mode switch toggles between the three algorithms (this scene is reused in §5 and §6), and a counter compares comparisons/work across them on the same data. Build the nested-loop mode here.

**Sandbox (Python):** `NestedLoopJoin(outer, inner, pred)` as an iterator; run it on two small tables, print result + comparison count. Self-contained. **Reveals:** the naive join is quadratic; structure (an index, or a better algorithm) is what saves it.

### Scene 5 — Hash Join *(prose + reuses `JoinScene` + Python)*
The workhorse for equijoins. **Hash join:** scan the smaller input once and build a hash table keyed on the join column (the **build** phase — blocking, it must finish before probing); then scan the larger input and probe the hash table for matches (the **probe** phase). O(n+m) instead of O(n·m), at the cost of memory for the hash table.

**Scene:** `JoinScene` in hash mode — animate the build side filling a hash table, then the probe side hitting buckets; comparisons counter stays near n+m vs nested-loop's n·m on the same data. **Sandbox:** `HashJoin` iterator (build dict, then probe). Self-contained. **Reveals:** trading memory for time turns the quadratic join linear — the single most important operator-level optimization.

### Scene 6 — Sort-Merge Join *(prose + reuses `JoinScene` + Python)*
The third way. **Sort-merge join:** sort both inputs on the join key, then walk them together in a single merge pass. O(n log n + m log m) dominated by the sorts — but if the inputs are *already* sorted (e.g. coming from a clustered index or an upstream sort), the sorts are free and the merge is linear. Also the natural choice for range/merge joins and when the output needs to be sorted anyway.

**Scene:** `JoinScene` in sort-merge mode — show both sides sorting, then two cursors advancing in lockstep. **Sandbox:** `SortMergeJoin`. Self-contained. **Reveals:** the best join depends on the inputs (sorted? indexed? sizes?), which is exactly the decision ch07 automates.

### Scene 7 — Aggregation & Sort *(prose + `AggSortScene` + Python)*
`GROUP BY` and `ORDER BY`. **Hash aggregation:** scan once, accumulate per-group state in a hash table keyed by the group columns (blocking — you don't know a group's final value until the last row). **Sort:** materialize and order all rows (blocking). Introduce the **blocking vs pipelined** distinction sharply: a pipelined operator emits a row as soon as it has one; a blocking operator must consume *all* its input before it can emit anything, which stalls the pipeline and needs memory (or spills to disk).

**Scene (`AggSortScene`):** Show a hash-aggregation table filling as rows stream in (groups accumulating counts/sums), and separately a sort buffering all rows then releasing them in order — with a "blocked until last row" indicator contrasting against the pipelined operators from §2. **Sandbox:** `HashAggregate(group_cols, agg)` and `Sort(keys)` iterators. Self-contained. **Reveals:** some operators break the pipeline; that's why `ORDER BY` on a huge result can be the expensive part of a query.

### Scene 8 — What's Next *(prose)*
Short. The reader can now build and run a plan for any query. But for a single query there are many valid plans — seq scan vs index scan, nested-loop vs hash vs sort-merge, and (with multiple joins) many possible *orders* — and their costs differ by orders of magnitude. Running the wrong one can be thousands of times slower. Something has to choose, fast, without trying them all.

> We can run any plan now. We have no idea which one to run. That's the optimizer.

Tease **Chapter 07 — the query optimizer** (and the `EXPLAIN QUERY PLAN` choice from ch04 finally gets explained there).

### Scene 9 — Sources *(bibliography)*
- **Graefe, 1994 — "Volcano — An Extensible and Parallel Query Evaluation System."** The iterator model in §2, from the source.
- **Graefe, 1993 — "Query Evaluation Techniques for Large Databases" (ACM Computing Surveys).** The encyclopedic survey of operators, joins, and aggregation; the map for this whole chapter.
- **Shapiro, 1986 — "Join Processing in Database Systems with Large Main Memories."** The classic on hash join vs sort-merge and the memory trade.
- **Hellerstein, Stonebraker, Hamilton, 2007 — "Architecture of a Database System," §4 (Query Processor).** Where the executor sits relative to the optimizer and the storage engine.
- **Kleppmann, *Designing Data-Intensive Applications*, Chapter 3 ("Query Execution" sections).** The same material one notch up.

---

## 4. Technical Architecture
Inherits ch01–05 infra unchanged (see ch04 spec §4). Adds new content + four scene components.

### 4.1 File layout
- MDX: `src/content/chapters/06-query-execution.mdx` (slug `06-query-execution`).
- Components: `src/components/chapter-06/*.tsx` (default exports, no required props, `client:visible`).
- Sandboxes: per-teammate distinct files (e.g. `exec-sandboxes.ts`, `join-sandboxes.ts`) — named exports, self-contained Python, `python3`-verified.
- Frontmatter: `title: Query Execution`, `chapterNumber: 6`, `status: draft`, voice-matched summary.

### 4.2 New scene components
| Component | Where | What | Mobile (390px) |
|---|---|---|---|
| `PlanTreeScene` | §1 | Operator tree for a query; preset query toggles; optional EXPLAIN-style text. | Tree scales/scrolls; nodes stack; controls full-width. |
| `VolcanoScene` | §2 | Animate one `next()` pull descending and a row bubbling up through Filter/Project; "pull next row" button. | Vertical tree; animation stays within the figure. |
| `JoinScene` (HERO) | §4 reused §5/§6 | Two-input join visualizer with a 3-way mode switch (nested-loop / hash / sort-merge); comparisons/work counter comparing modes on the same data. | Inputs stack; counters above; animation reflows. |
| `AggSortScene` | §7 | Hash-aggregation table filling as rows stream; a sort buffering then releasing in order; blocking-vs-pipelined indicator. | Single column; table + sort buffer stack. |

§3, §5, §6 add no new component (§3 prose+Python; §5/§6 reuse `JoinScene`).

### 4.3 Figure numbering (sequential, no gaps — verified convention; pre-assigned, frozen)
§2 has no Figure if VolcanoScene is folded — but it IS a Figure. Assignments: `PlanTreeScene` **6.1**, `VolcanoScene` **6.2**, `JoinScene` **6.3**, `AggSortScene` **6.4**. (§3/§5/§6 have no standalone Figure.) Each component hard-codes its number; do not renumber concurrently.

### 4.4 Sandboxes
Python-by-hand only, `PythonSandbox client:only="react"`. Accumulating: §1 plan tree → §2 iterator protocol → §3 scan/filter/project → §4 nested-loop → §5 hash → §6 sort-merge → §7 agg/sort. Each string self-contained valid Python; `python3`-verify each. No sql.js.

### 4.5 Out of scope (→ ch07 or later)
- **Cost model, cardinality/selectivity estimation, join ordering, access-path *selection*** — all **ch07**. ch06 builds operators and *names* that choosing them is ch07's job.
- Parsing/SQL grammar internals (we hand-construct plans; don't build a parser).
- Parallel/vectorized/compiled execution, spilling to disk in detail, adaptive execution. Out (maybe a one-line mention).
- Locking/MVCC interaction — ch08/ch09 (post-renumber).

---

## 5. Implementation Notes (carried gotchas)
- Prose in MDX between `<Section>`; scenes are `client:visible` islands; `PythonSandbox` is `client:only="react"`. Never wrap prose in a React component.
- **390px non-negotiable**; build reflow first. Highest risk: `JoinScene` (two inputs + animation) and `PlanTreeScene` (tree width).
- Cream palette only (`--color-fig-bg`/`fig-*`/`fig-btn`).
- Figure numbers pre-assigned (§4.3), frozen.
- **Dev-harness guardrail:** any scratch test page MUST go in a gitignored location, NOT `src/pages/` (ch04/05 leaked `*.astro` harnesses into the build). If you make a harness page, put it under `src/pages/_dev/` AND confirm `src/pages/_dev/` is gitignored + excluded from build, or delete it before reporting done. Do not leave routes behind.
- One sandbox file per teammate; self-contained, `python3`-verified.
- `<Footnote n>` for citations → §9.
- No prose attribution in commits; `commit` skill isn't installed → git directly, `docs(ch06)`/`feat(ch06)`.

## 6. Acceptance
- Reader can explain the plan tree, the iterator model, the three joins + their trade-offs, and blocking vs pipelined operators.
- Every section quiz makes the reader *use* the model.
- 390px clean across all four scenes.
- All Python sandboxes run in Pyodide and pass a `python3` smoke run.
- `astro check` 0 errors, `npm run build` green (route `/chapters/06-query-execution/`), `npm test` 8/8.
- Continuity: §0 cashes ch05's handoff; §3 reuses ch04's scan/index-scan + EXPLAIN; §8 teases ch07.
- No stray `src/pages/*.astro` harness routes in the build.

## 7. Open Calls (decisions made)
| Decision | Choice | Rationale |
|---|---|---|
| Split | ch06 execution + ch07 optimizer (separate specs/waves). | User chose deep coverage of both; one chapter would be 10–12k words. |
| ch06 weight | Execution only: operators + iterator model + 3 joins + agg/sort. | Optimization is ch07. |
| Hero | `JoinScene` (the three joins). | The meatiest, most visual idea. |
| Sandboxes | Python-by-hand, no sql.js. | We build the engine; EXPLAIN payoff lands in ch07. |
| §8 hook | ch07 optimizer. | Direct setup; the EXPLAIN choice from ch04 is explained in ch07. |
| Renumber | Separate task (see renumber-plan doc). | Inserting ch07 bumps 7→8…12→13; cited-book chapters protected. |

## 8. Implementation Sequence (parallelizable)
1. Scaffold `06-query-execution.mdx` (frontmatter, imports, `<Section>` shells, quiz stubs).
2. `PlanTreeScene` + `VolcanoScene` + §1/§2/§3 sandboxes. 390px.
3. `JoinScene` (hero) + §4/§5/§6 sandboxes. 390px (reflow first).
4. `AggSortScene` + §7 sandbox. 390px.
5. Prose §0–§9 (~6500–7000), quizzes apply the model, continuity callbacks/forward-refs.
6. §9 Sources.
7. QA: 390px sweep, astro check, build, tests; confirm no stray harness routes.
8. (Separate) renumber sweep (its own task/teammate) + later commit/publish.

## 9. Out of scope (for this spec)
- ch07 optimizer content (separate spec).
- The renumber sweep mechanics (separate plan doc) — though ch06's own forward-refs use the new numbering (ch07 optimizer, ch08 locking).
- Any change to the global shell/tokens/typography.
