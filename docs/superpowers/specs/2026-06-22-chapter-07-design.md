# Chapter 07 — Design Spec

**Status:** Approved (design); implementation
**Date:** 2026-06-22
**Scope:** Author Chapter 07 — "The Query Optimizer" — the second half of the query-processing split. ch06 built the executor (operators, the iterator model, the three joins). ch07 answers *which* plan to run: cost-based optimization — the cost model, cardinality estimation (the hard, central problem), access-path selection (the ch04 `EXPLAIN QUERY PLAN` payoff, finally explained), join ordering, and what happens when the estimates are wrong.

> Shares the reading shell, voice, and conventions of ch01–06. Where silent, the ch04/05/06 specs are authoritative. This is **Wave B** of the query-processing split; ch06 (execution) shipped in Wave A. Uses the post-renumber numbering (this is **Chapter 7**; locking is **Chapter 8**).

---

## 1. Goal
ch06 ended: *"We can run any plan now. We have no idea which one to run. That's the optimizer."* This chapter is the optimizer. The same SQL query maps to many equivalent physical plans — seq scan vs index scan, nested-loop vs hash vs sort-merge, and (with multiple joins) many join *orders* — whose runtimes differ by **orders of magnitude**. The optimizer's job: choose a good plan, fast, without running them all. The reader builds a tiny cost-based optimizer by hand: a cost model, a cardinality estimator, an access-path chooser, and a join-order search — and then sees, viscerally, how wrong cardinality estimates wreck the whole thing.

### Success criteria
A reader can explain: (a) that one query has a large *space* of equivalent plans with wildly different costs; (b) a **cost model** estimates a plan's cost as (roughly) page reads (ch04/05) + CPU per row; (c) **cardinality/selectivity estimation** — predicting how many rows each operator emits — is the central, hardest problem, done with statistics/histograms, and its errors **compound multiplicatively through joins**; (d) **access-path selection** — the index-vs-seqscan decision turns on selectivity (the explicit ch04 `EXPLAIN QUERY PLAN` SCAN-vs-SEARCH payoff); (e) **join ordering** is a combinatorial search (N! orders; left-deep + dynamic programming à la System R, heuristics when N is large); (f) why optimizers go wrong in practice (bad estimates → bad plans; the long tail; `ANALYZE`/statistics, hints).

Built by hand in Python (construction ethos); accumulating sandboxes that reuse ch06's operator/cost vocabulary. No sql.js, though §4 *resolves* ch04's `EXPLAIN QUERY PLAN` output conceptually. 390px. ~6500–7000 words.

---

## 2. Continuity
### Backward
- **ch06 §8** is the handoff ("which one to run?") — §0 opens on it.
- **ch04 `EXPLAIN QUERY PLAN`** showed `SCAN` vs `SEARCH USING INDEX` and explicitly deferred *who chooses* to "the optimizer." **§4 (access-path selection) is that payoff** — explain the selectivity crossover that makes the planner pick a seq scan for a non-selective predicate and an index for a selective one. Call back to ch04 by name.
- **ch06 operators/joins**: the optimizer chooses among the very operators ch06 built (SeqScan/IndexScan; nested-loop/hash/sort-merge). Reference them by name; §5 join-ordering builds on ch06's join cost intuitions.
- **ch04/05 cost reality**: a plan's cost is dominated by page reads, which the buffer pool (ch05) may turn into cheap hits — note that the cost model estimates *logical* IO and the buffer pool muddies it.
- **ch03**: selectivity of a `WHERE`/range predicate connects to the range-scan picture from ch03/ch04.
### Forward
- **§7 teases ch08 (locking/concurrency):** we can now choose a good plan for one query; but many queries run at once and can corrupt each other — concurrency control is next. Use the post-renumber number (**Chapter 8**).

---

## 3. Chapter 07 Spine
| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | ch06 callback. One query, many equivalent plans, costs differing by orders of magnitude. The optimizer chooses without running them all. |
| 1 | the-plan-space | prose + `PlanSpaceScene` + Python | Show 2–3 equivalent plans for one query (seqscan+filter vs index scan; two join orders) with their (estimated) costs side by side — the difference is enormous. |
| 2 | the-cost-model | prose + `CostScene` + Python | Cost = estimated page reads (ch04/05) + CPU per row. A simple, explicit cost formula; cost each plan from §1. |
| 3 | cardinality-estimation | prose + `CardinalityScene` (HERO) + Python | The hard core: estimate rows out of each operator. Selectivity, histograms, the independence assumption; errors **compound through joins**. Why this is where optimizers live or die. |
| 4 | access-path-selection | prose + Python | Index vs seq scan: the selectivity crossover. **The ch04 `EXPLAIN QUERY PLAN` payoff** — now we explain who chose SCAN vs SEARCH and exactly when each wins. |
| 5 | join-ordering | prose + `JoinOrderScene` + Python | N! orderings; why order dominates cost; left-deep plans + System R dynamic programming; greedy/heuristic when N is large. |
| 6 | when-it-goes-wrong | prose + `Callout` + Python | Bad estimates → bad plans; multiplicative error through joins; the long tail; `ANALYZE`/statistics, hints, adaptive execution. Honest about limits (Leis 2015). |
| 7 | whats-next | prose | We can choose a good plan for one query. But many queries run at once and can corrupt each other. Tease **ch08 — locking & concurrency**. |
| 8 | sources | bibliography | Curated, annotated. |

---

### Scene 0 — Premise *(prose)*
Open on ch06's handoff. The executor will faithfully run *any* plan you hand it — including a catastrophically bad one. For `SELECT … FROM a JOIN b JOIN c WHERE …`, the same answer can be computed by hundreds of distinct plans, and the slowest can be thousands of times slower than the fastest. Nobody writes the plan by hand; the **optimizer** searches the space and picks one, in milliseconds, *before* a single row is read — which means it must judge plans it never runs, using *estimates*. Commit to the shape: a cost model to score a plan, cardinality estimation to feed the cost model, the index-vs-scan decision, join ordering, and a hard look at what happens when the estimates lie. **Reveals:** the optimizer is a search over plans guided by *predicted* cost — and prediction is the whole game.

### Scene 1 — The Plan Space *(prose + `PlanSpaceScene` + Python)*
One query, many plans. Take a small query and show 2–3 equivalent physical plans (e.g. `SeqScan+Filter` vs `IndexScan`; join order (A⋈B)⋈C vs (B⋈C)⋈A) with an estimated cost on each — and make the cost gap loud.

**Scene (`PlanSpaceScene`):** Show alternative plan trees for one query side by side (or switchable), each annotated with an estimated cost; highlight that they return identical rows but cost wildly differently. Let the reader toggle which is "chosen." **Sandbox:** enumerate a couple of equivalent plans for a query as operator trees (reusing ch06's operator vocabulary) and print each with a placeholder cost. Self-contained. **Reveals:** correctness is shared across the plan space; cost is not — so choosing is everything.

### Scene 2 — The Cost Model *(prose + `CostScene` + Python)*
How to score a plan you won't run. A simple cost model: **cost ≈ (pages read) + cpu_per_row × (rows processed)**, summed over the operator tree. Page reads come from ch04 (seq scan reads all pages; index scan reads few) and ch05 (some are cheap hits — note the model estimates *logical* IO). 

**Scene (`CostScene`):** An operator tree where each node shows its estimated rows and its cost contribution, rolling up to a total; tweak a knob (table size, selectivity) and watch costs change. **Sandbox:** a `cost(plan, stats)` function over ch06-style operators; cost the §1 plans and show the cheap one winning. Self-contained. **Reveals:** cost is mechanical *given* row counts — which throws all the weight onto estimating those row counts (§3).

### Scene 3 — Cardinality Estimation *(prose + `CardinalityScene` (HERO) + Python)*
The hero and the hard part. Every cost depends on how many rows each operator emits, and those counts must be *estimated* before execution. **Selectivity:** the fraction of rows a predicate passes (`age > 30` → maybe 0.4). Estimated from **statistics** — row counts, distinct values, and **histograms** of column value distributions. Joins multiply: estimated join cardinality uses the **independence assumption**, which is often wrong, and errors **compound multiplicatively** up a chain of joins — a 2× error per join becomes 16× over four joins.

**Scene (`CardinalityScene`):** A histogram of a column; the reader sets a predicate (`age > X`) and sees the estimated selectivity read off the histogram vs the true count; then chain joins and watch the estimate diverge from reality as assumptions stack. Make the compounding visceral (estimate vs actual, growing apart). **Sandbox:** build an equi-width (or equi-depth) histogram over a column; estimate selectivity for a predicate; estimate a join cardinality under independence; print estimate vs actual and the error factor across a 2–3 join chain. Self-contained. **Reveals:** the optimizer's quality is capped by its cardinality estimates; this is where real optimizers succeed or fail.

### Scene 4 — Access-Path Selection *(prose + Python)*
The ch04 payoff, finally. For `WHERE col = ?` / `col > ?`, the planner chooses between a **seq scan** (read every page) and an **index scan** (B-tree seek + fetch). The decision is the **selectivity crossover**: an index wins when the predicate is selective (few matching rows → few page fetches), and a seq scan wins when it isn't (many matches → the index's random fetches + heap hops cost more than one sequential sweep). This is exactly the `SCAN` vs `SEARCH USING INDEX` that ch04's `EXPLAIN QUERY PLAN` printed — now explained.

**Sandbox:** a `choose_access_path(selectivity, table_pages, …)` that costs seq scan vs index scan and returns the winner; sweep selectivity from 0→1 and print the crossover point. Self-contained. **Prose:** call back to ch04's EXPLAIN explicitly; note the "covering index" case (ch04 §6) removes the heap hop and shifts the crossover. **Reveals:** the index/scan choice the reader saw in ch04 is a cost comparison driven by an estimated selectivity — the optimizer doing arithmetic.

### Scene 5 — Join Ordering *(prose + `JoinOrderScene` + Python)*
The combinatorial heart. Joining N tables, the number of orders explodes (N! for the orderings, more with bushy trees); and order matters enormously because the size of an intermediate result feeds the cost of the next join. **System R**'s answer: restrict to **left-deep** plans and use **dynamic programming** over subsets of tables to find the cheapest order without enumerating all of them; for large N, fall back to **greedy/heuristic** search (genetic, etc.).

**Scene (`JoinOrderScene`):** For 3–4 tables, show a few candidate join orders as trees with their estimated intermediate cardinalities and total costs; highlight how a good order keeps intermediates small. Optionally animate the DP filling subset-by-subset. **Sandbox:** a small DP join-order optimizer over estimated cardinalities for 3–4 relations; print the chosen order and cost vs a naive order. Self-contained. **Reveals:** the optimizer is mostly a search for a good join order, and DP makes it tractable — but it's only as good as the §3 estimates feeding it.

### Scene 6 — When It Goes Wrong *(prose + `Callout` + Python)*
The honest chapter. Cardinality errors compound (§3) and feed join ordering (§5), so one bad estimate near the leaves can pick a disastrous plan. Real-world reality: stale or missing statistics (`ANALYZE`/`auto_analyze`), correlated columns breaking the independence assumption, parameter-sniffing, the long tail of queries where the optimizer picks a plan 1000× too slow. Mitigations: better statistics (multi-column, extended), hints/`pg_hint_plan`, adaptive/runtime re-optimization. Cite Leis et al. 2015 ("How Good Are Query Optimizers, Really?") honestly: estimation is the dominant error source, cost-model details matter less.

**Sandbox:** take the §5 optimizer and feed it a deliberately wrong cardinality (simulate a correlated-column underestimate); show it picks a much worse plan; then "fix the stats" and watch it recover. **Reveals:** the optimizer is a model of reality, and when the model is wrong the plan is wrong — which is why production databases spend so much effort on statistics. **Callout:** a short "in production" aside on `ANALYZE` / stale stats.

### Scene 7 — What's Next *(prose)*
Short. The engine can now find rows (ch04), cache pages (ch05), run a plan (ch06), and choose a good plan (ch07) — everything to answer *one* query well. But databases serve many clients at once, and two transactions touching the same rows can corrupt each other (the very races ch01 opened the book with). Controlling that is concurrency control.

> We can answer one query well. Now run a thousand at once, on the same rows, without them clobbering each other.

Tease **Chapter 8 — locking & concurrency.**

### Scene 8 — Sources *(bibliography)*
- **Selinger et al., 1979 — "Access Path Selection in a Relational Database Management System."** The System R optimizer: cost-based optimization, the selectivity estimates of §3/§4, and the join-ordering DP of §5. The foundational paper for this whole chapter.
- **Leis et al., 2015 — "How Good Are Query Optimizers, Really?"** The honest modern assessment: cardinality estimation is the dominant error source. The backbone of §6.
- **Ioannidis, 2003 — "The History of Histograms (abridged)."** Where the §3 histograms come from and the estimation techniques built on them.
- **Graefe, 1995 — "The Cascades Framework for Query Optimization."** The architecture behind modern extensible optimizers (and the optimizer side of ch06's Volcano).
- **Hellerstein, Stonebraker, Hamilton, 2007 — "Architecture of a Database System," §4 (Query Optimizer).** Where the optimizer sits relative to the executor and the catalog/statistics.
- **PostgreSQL documentation — "Planner/Optimizer" and `EXPLAIN`.** The §1–§5 ideas as a production system exposes them; read with ch04's `EXPLAIN QUERY PLAN` in hand.

---

## 4. Technical Architecture
Inherits ch01–06 infra (see ch04 spec §4). New content + four scene components.

### 4.1 File layout
- MDX: `src/content/chapters/07-query-optimizer.mdx` (slug `07-query-optimizer`).
- Components: `src/components/chapter-07/*.tsx` (default exports, no props, `client:visible`).
- Sandboxes: per-teammate distinct files (e.g. `cost-sandboxes.ts`, `estimation-sandboxes.ts`, `joinorder-sandboxes.ts`) — named exports, self-contained Python, `python3`-verified.
- Frontmatter: `title: The Query Optimizer`, `chapterNumber: 7`, `status: draft`, voice-matched summary.

### 4.2 New scene components
| Component | Where | What | Mobile (390px) |
|---|---|---|---|
| `PlanSpaceScene` | §1 | 2–3 equivalent plan trees for one query, each with an estimated cost; toggle the "chosen" one; cost gap loud. | Plans stack vertically; trees scale/scroll; costs above. |
| `CostScene` | §2 | Operator tree with per-node rows + cost contribution rolling to a total; a knob (size/selectivity) updates costs. | Tree scrolls; knob + total full-width below. |
| `CardinalityScene` (HERO) | §3 | A column histogram; reader sets a predicate → estimated vs true selectivity; chain joins → estimate vs actual diverging (compounding error). | Histogram full-width; estimate/actual readouts stack; compounding shown as a small bar/number. |
| `JoinOrderScene` | §5 | 3–4 tables; candidate join orders as trees with intermediate cardinalities + total cost; good order keeps intermediates small; optional DP fill animation. | Trees stack/scroll; cost table reflows. |

§4 and §6 add no new component (prose + Python).

### 4.3 Figure numbering (sequential, no gaps — pre-assigned, frozen)
`PlanSpaceScene` **7.1**, `CostScene` **7.2**, `CardinalityScene` **7.3**, `JoinOrderScene` **7.4**. Each component hard-codes its number; do not renumber concurrently.

### 4.4 Sandboxes
Python-by-hand, `PythonSandbox client:only="react"`. Accumulating: §1 enumerate plans → §2 cost model → §3 histogram/selectivity/join-cardinality estimator → §4 access-path crossover → §5 join-order DP → §6 wrong-stats demo. Each string self-contained valid Python; `python3`-verify each. No sql.js.

### 4.5 Out of scope (later/none)
- Building a SQL parser or a full Cascades/Volcano optimizer framework (we hand-build a tiny cost-based optimizer; name Cascades, don't implement it).
- Concurrency/locking — **ch08**. MVCC — **ch09**. Recovery — **ch11**.
- Physical-property/interesting-orders optimization beyond a one-line mention; parallel/distributed planning; adaptive execution beyond §6's mention.

---

## 5. Implementation Notes (carried gotchas)
- Prose in MDX between `<Section>`; scenes `client:visible`; `PythonSandbox` `client:only="react"`. Never wrap prose in a React component.
- **390px non-negotiable**; reflow first. Highest risk: `CardinalityScene` (histogram + dual readouts) and `JoinOrderScene` (multiple trees).
- Cream palette only (`--color-fig-bg`/`fig-*`/`fig-btn`).
- Figure numbers pre-assigned (§4.3), frozen.
- **Dev-harness guardrail (enforced):** do NOT create ANY scratch page under `src/pages/` — not even `src/pages/_dev/`. Harnesses leaked into the build on ch04/05/06. If you must visually test, do it without adding a routed page, and `ls src/pages/` MUST show only `index.astro`, `chapters/index.astro`, `chapters/[slug].astro` when you report done. Leaving a stray `.astro` in `src/pages/` is a slice failure.
- One sandbox file per teammate; self-contained, `python3`-verified.
- `<Footnote n>` → §8. Closing JSX tags (e.g. `</Callout>`) on their own line.
- No prose attribution in commits; git directly, `docs(ch07)`/`feat(ch07)`.

## 6. Acceptance
- Reader can explain plan space, cost model, cardinality estimation + compounding error, access-path crossover (the ch04 EXPLAIN payoff), join-order search, and why estimates wreck plans.
- Quizzes make the reader *use* the model (read selectivity off a histogram, pick the access path at a given selectivity, spot how a join-order keeps intermediates small, predict compounding error).
- 390px clean across all four scenes.
- All Python sandboxes run in Pyodide and pass a `python3` smoke run.
- `astro check` 0 errors, `npm run build` green (route `/chapters/07-query-optimizer/`), `npm test` 8/8.
- Continuity: §0 cashes ch06's handoff; §4 resolves ch04's EXPLAIN; §7 teases ch08 (correct post-renumber number).
- No stray `src/pages/*.astro` routes.

## 7. Open Calls (decisions made)
| Decision | Choice | Rationale |
|---|---|---|
| Position | Chapter 7 (new), after the renumber. | The split the user chose; ch06 = execution, ch07 = optimization. |
| Hero | `CardinalityScene` (§3). | Estimation is the central, hardest, most consequential idea. |
| EXPLAIN payoff | §4 access-path selection. | Resolves the SCAN-vs-SEARCH choice ch04 explicitly deferred to the optimizer. |
| Sandboxes | Python-by-hand, no sql.js. | We build the optimizer; the EXPLAIN connection is conceptual. |
| §7 hook | ch08 locking/concurrency (post-renumber number). | Next in the established plan; returns to ch01's races. |
| Components | Four (§4.2); §4/§6 prose+Python. | One per distinct visual idea. |

## 8. Implementation Sequence (parallelizable)
1. Scaffold `07-query-optimizer.mdx` (frontmatter, imports, `<Section>` shells, quiz stubs).
2. `PlanSpaceScene` + `CostScene` + §1/§2/§4 sandboxes. 390px.
3. `CardinalityScene` (hero) + §3 sandbox. 390px (histogram reflow first).
4. `JoinOrderScene` + §5/§6 sandboxes. 390px.
5. Prose §0–§8 (~6500–7000), quizzes apply the model, continuity callbacks/forward-refs (ch04 EXPLAIN, ch06 operators, ch08 tease).
6. §8 Sources.
7. QA: 390px sweep, astro check, build, tests; confirm no stray harness routes.

## 9. Out of scope (for this spec)
- ch06 content (shipped Wave A); ch08+ content.
- The renumber sweep (done in Wave A); ch07 simply uses the new numbers.
- Any change to the global shell/tokens/typography.
