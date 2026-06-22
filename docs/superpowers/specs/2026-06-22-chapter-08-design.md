# Chapter 08 — Design Spec

**Status:** Approved (design); implementation
**Date:** 2026-06-22
**Scope:** Author Chapter 08 — "Locking & Concurrency" — the pessimistic concurrency-control mechanism. Build a lock manager by hand in Python: shared/exclusive locks + the compatibility matrix, two-phase locking, the lock-table data structure, and deadlock detection (wait-for graph + victim selection). This is the chapter where ch01's races and ch03's isolation levels finally get their *enforcement mechanism*, and it sets up ch09 (MVCC) as the alternative.

> Shares the reading shell, voice, and conventions of ch01–07. Where silent, the ch04/05/06/07 specs are authoritative (esp. ch04 §4 architecture, ch05 §5 gotchas, the dev-harness guardrail). Uses the post-renumber numbering: this is **Chapter 8**; MVCC is **Chapter 9**, recovery/ARIES is **Chapter 11**.

---

## 1. Goal
ch03 named *what* can go wrong when transactions overlap (lost update, dirty/non-repeatable reads, phantoms, write skew) and named two families of fix: locking and MVCC. This chapter builds the first one. The reader constructs a real **lock manager**: shared and exclusive locks with a compatibility matrix, **two-phase locking** (2PL) that turns lock discipline into serializability, the lock-table structure that tracks who holds what and who's waiting, and **deadlock** detection — the dramatic failure where two transactions each wait forever on a lock the other holds — resolved by a wait-for graph and aborting a victim.

### Success criteria
A reader can explain: (a) why uncoordinated interleaving produces the lost update (ch01 callback) and that a lock serializes the conflicting access; (b) **shared (S)** vs **exclusive (X)** locks and the compatibility matrix (S/S compatible; S/X and X/X conflict), and acquire-or-wait; (c) **two-phase locking** — a growing phase that only acquires and a shrinking phase that only releases — and *why* that discipline guarantees a serializable schedule; **strict 2PL** holds exclusive locks to commit and why (cascadeless aborts); (d) the **lock manager** as a hash table from resource → {granted set, wait queue}; (e) **deadlock**: how it arises, detection via a **wait-for graph** cycle, victim selection + abort, and prevention schemes (wait-die / wound-wait) + timeouts; (f) the difference between **latches** (short, cheap, protect in-memory structures like ch05's buffer-pool pages) and **locks** (transaction-duration, protect logical data); and (g) how **lock duration maps onto ch03's isolation levels**.

Built by hand in Python (construction ethos); accumulating sandboxes that grow into a working lock manager + deadlock detector. No sql.js. 390px. ~6500–7000 words.

---

## 2. Continuity (load-bearing — the user asked specifically for tight cross-chapter knitting)
### Backward
- **ch01** opened on the **lost update** and `fcntl.flock` (advisory, single-host, "a real database's locking subsystem fixes both gaps … row-level granularity, deadlock detection" → now Chapter 8). **§0–§1 cash this exact promise**, by name.
- **ch03** named the anomalies and said `REPEATABLE READ` is enforced by "read locks … or snapshot isolation (MVCC)", that a real DB has "a lock manager (chapter 08)", and that predicate/range locks defend against phantoms. **§7 pays this off**: lock *duration* and *granularity* implement ch03's isolation levels.
- **ch04/05**: pages + the buffer pool. **§6 latches** protect those in-memory pages (cheap, short, not transactional) vs **locks** on logical rows (expensive, held to commit). Name the distinction the prior chapters glossed.
- **ch07 (and ch03)**: the cost of serialization is waiting — connect to the performance framing.
### Forward
- **§8 teases ch09 (MVCC):** locking makes readers and writers block each other; the alternative keeps multiple versions so reads never wait. Use the correct number (**Chapter 9**).
- Mention recovery/abort interplay as **Chapter 11** (strict 2PL + rollback) only as a light forward-ref.

---

## 3. Chapter 08 Spine
| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | ch01's lost update + ch03's anomalies named *what* breaks. This chapter builds the first fix the relational world reached for: locks. |
| 1 | the-conflict | prose + Python | Re-stage the lost update as a concrete two-transaction interleaving; both read, both write, one update is lost. Motivate coordination. |
| 2 | shared-exclusive | prose + `LockCompatScene` + Python | S and X locks; the compatibility matrix (S/S ok; S/X, X/X conflict); acquire-or-wait. Build lock/unlock. |
| 3 | two-phase-locking | prose + `TwoPhaseScene` + Python | 2PL: growing (acquire-only) then shrinking (release-only) phase; why it serializes; strict 2PL (hold X to commit) and cascadeless aborts. |
| 4 | the-lock-manager | prose + `LockManagerScene` + Python | The data structure: hash table resource → {granted set, wait queue}; granting, blocking, waking waiters on release. Build it. |
| 5 | deadlock | prose + `DeadlockScene` (HERO) + Python | Two txns each holding what the other wants; the **wait-for graph**, cycle detection, victim selection + abort; prevention (wait-die/wound-wait) + timeouts. |
| 6 | granularity-and-latches | prose + Python | Lock granularity (row/page/table) + intention locks (brief); **latches vs locks** (ties to ch04/05 in-memory pages). |
| 7 | isolation-revisited | prose + `Callout` | Lock **duration** → ch03's levels: early release = READ COMMITTED; hold reads to commit = REPEATABLE READ; range/predicate locks = no phantoms = SERIALIZABLE. |
| 8 | whats-next | prose | Locks make readers and writers wait — contention. The alternative: versions, no read locks. Tease **ch09 MVCC**. |
| 9 | sources | bibliography | Curated, annotated. |

---

### Scene 0 — Premise *(prose)*
Open by collecting two debts. ch01 ended its race scene with `flock` and a promise that a real database's locking subsystem does this properly — row-level, with deadlock detection — "in Chapter 8." ch03 spent the whole chapter on *what* goes wrong when transactions overlap and named, but did not build, the two mechanisms that prevent it. This is the build of the first one. Frame the bargain up front: a lock is a way to make one transaction *wait* so another can finish — correctness bought with waiting — and the rest of the chapter is the machinery to grant, queue, and (when waiting becomes a cycle) break those waits. **Reveals:** concurrency control is the engineering of *who waits for whom*.

### Scene 1 — The Conflict *(prose + Python)*
Re-stage ch01's lost update concretely as an interleaving. Two transactions both read balance=100, both add 50, both write 150; one update vanishes; the account should be 200. Show the schedule as an interleaved sequence of reads/writes and the wrong result. Name the conflict: two writes (or a read and a write) to the same item with no ordering. **Sandbox (Python):** two "transactions" as step lists interleaved by a scheduler; run the bad interleaving and print the lost-update result; no locks yet. Self-contained. **Reveals:** the database must *order* conflicting accesses to the same item — that ordering is what a lock provides.

### Scene 2 — Shared & Exclusive Locks *(prose + `LockCompatScene` + Python)*
The two lock modes. **Shared (S)** for reads — many readers can hold S on the same item at once. **Exclusive (X)** for writes — only one holder, and not while any S is held. The **compatibility matrix**: S/S compatible, S/X and X/X conflict. A transaction must hold the right lock before it touches an item; if the lock conflicts with one already granted, it **waits**.

**Scene (`LockCompatScene`):** the 2×2 compatibility matrix as an interactive grid (current holder mode × requested mode → granted/wait); let the reader request locks from two transactions on one item and watch grants and blocks. **Sandbox (Python):** a `Lock` with `acquire(txn, mode)` / `release(txn)` enforcing the matrix on a single item (queue conflicting requests). Self-contained, builds on §1. **Reveals:** read-read concurrency is free; anything touching a write must serialize — the matrix is the whole rule.

### Scene 3 — Two-Phase Locking *(prose + `TwoPhaseScene` + Python)*
Locks alone don't guarantee correctness — *when* you release matters. **2PL**: every transaction has a **growing phase** (it may acquire locks but not release any) followed by a **shrinking phase** (it may release but not acquire). The single rule "no acquire after the first release" is what makes the schedule equivalent to some serial order. **Strict 2PL** strengthens it: hold all **exclusive** locks until commit/abort, which prevents other transactions from reading uncommitted data and makes aborts cascadeless.

**Scene (`TwoPhaseScene`):** a timeline of one transaction's lock count rising (growing) then falling (shrinking) with the "lock point" marked; toggle strict mode to show X locks held flat until commit. Optionally show two transactions and how 2PL forces a serial order. **Sandbox (Python):** a `Transaction` wrapper that enforces the 2PL rule (raise if it acquires after releasing) over the §2 locks; run the §1 lost-update workload under 2PL and show the lost update is now prevented (one txn waits). Self-contained. **Reveals:** serializability comes from the *shape* of each transaction's lock lifetime, not from the locks alone.

### Scene 4 — The Lock Manager *(prose + `LockManagerScene` + Python)*
The real structure behind §2/§3. A **lock manager** is a hash table keyed by resource id; each entry holds a **granted set** (who holds it, in what mode) and a **wait queue** (who's blocked, in request order). `acquire` either joins the granted set (if compatible) or enqueues and blocks; `release` removes the holder and wakes compatible waiters from the front of the queue (respecting FIFO to avoid starvation).

**Scene (`LockManagerScene`):** visualize the lock table — a few resources, each a row showing its granted set (colored by mode) and its wait queue; step transactions issuing acquire/release and watch entries grant, queue, and drain. **Sandbox (Python):** a `LockManager` with `lock(txn, resource, mode)` / `unlock(txn, resource)` / `release_all(txn)`, the granted-set + wait-queue per resource, FIFO wakeups. This is the accumulation point — §3's 2PL transactions now run against this manager. Self-contained. **Reveals:** the lock manager is a small, concrete data structure; everything above it is policy on top of this table.

### Scene 5 — Deadlock *(prose + `DeadlockScene` (HERO) + Python)*
The hero scene and the dramatic failure of locking. Two transactions deadlock when each holds a lock the other needs: T1 holds A wants B, T2 holds B wants A — both wait forever. Strict 2PL makes this *more* likely (locks held to commit). The standard cure is **detection**: maintain a **wait-for graph** (an edge T_i → T_j when T_i waits for a lock T_j holds); a **cycle** is a deadlock; pick a **victim** (e.g. youngest, or fewest locks held), abort it (releasing its locks), and let the others proceed — the aborted transaction retries. Prevention alternatives: **wait-die** and **wound-wait** (timestamp-ordered, never form a cycle), and the crude-but-common **lock timeout**.

**Scene (`DeadlockScene`):** animate two (then more) transactions acquiring locks until a cycle forms; draw the wait-for graph live; highlight the cycle; select and abort a victim; show the survivors unblock. Let the reader trigger the classic A/B–B/A deadlock and watch detection fire. **Sandbox (Python):** extend the §4 lock manager with a wait-for graph and `detect_deadlock()` returning a cycle; on detection abort a victim (`release_all`) and show the survivor completing. Demonstrate the A/B–B/A deadlock resolved. Self-contained. **Reveals:** deadlock is not a bug to be eliminated but a condition to be *detected and recovered from*; locking trades the lost update for the deadlock, and the deadlock is survivable.

### Scene 6 — Granularity & Latches *(prose + Python)*
Two practical refinements. **Granularity:** you can lock a row, a page, or a whole table — fine granularity means more concurrency but more lock overhead; coarse means less overhead but less concurrency. **Intention locks** (IS/IX) let a transaction signal "I hold/ will hold fine-grained locks below this node" so a table-level lock can coexist correctly with row locks (brief — name them, don't fully build the hierarchy). **Latches vs locks:** the distinction prior chapters glossed. A **latch** is a short, cheap mutex protecting an *in-memory data structure* (e.g. a buffer-pool page from ch05, or a B-tree node from ch04 during a split) for the microseconds of one operation; it is not transactional and not deadlock-managed. A **lock** protects *logical data* (a row) for the *duration of a transaction* and is tracked by the lock manager. Confusing them is a classic source of bugs.

**Sandbox (Python):** a tiny demo contrasting a latch (acquire→mutate→release within one operation) with a lock (held across transaction steps). Self-contained. **Reveals:** databases run two completely different mutual-exclusion systems at two different timescales, and ch04/05's pages are guarded by the cheap one.

### Scene 7 — Isolation, Revisited *(prose + `Callout`)*
Pay off ch03 directly. The isolation level a transaction runs at is, under locking, mostly a choice about **lock duration and scope**:
- **READ COMMITTED:** take a read (S) lock just long enough to read, release immediately; X locks held to commit. Prevents dirty reads; allows non-repeatable reads.
- **REPEATABLE READ:** hold S locks to commit too (strict 2PL on reads). Prevents non-repeatable reads; still allows **phantoms** (a new row matching your predicate can appear).
- **SERIALIZABLE:** add **range/predicate locks** that lock the *gap* a new row would fall into, not just existing rows — defeating phantoms. (Callback to ch03's predicate-lock discussion and ch04's range scans: the predicate maps to a range in the B-tree, and that range is what you lock.)

**Callout:** a short "this is why `SERIALIZABLE` is expensive under locking" aside. **Reveals:** ch03's isolation hierarchy is the same lock discipline at different durations and scopes — the mechanism the reader just built, dialed up or down.

### Scene 8 — What's Next *(prose)*
Short. Locking is correct, but its currency is waiting: a reader blocks a writer and a writer blocks a reader, and under contention throughput collapses. The radical alternative refuses to lock reads at all — keep *multiple versions* of each row and let every reader see a consistent snapshot from the past while writers create new versions alongside. That's multiversion concurrency control, and it's why most modern databases barely take read locks.

> What if readers never had to wait for writers, ever? What if a write didn't block a read because the old value was still lying around?

Tease **Chapter 9 — MVCC.**

### Scene 9 — Sources *(bibliography)*
- **Gray, Lorie, Putzolu & Traiger, 1975 — "Granularity of Locks and Degrees of Consistency in a Shared Data Base."** The foundational paper: lock modes, the compatibility matrix, intention locks, and the original "degrees of consistency" that became isolation levels. §2/§6/§7 trace here.
- **Eswaran, Gray, Lorie & Traiger, 1976 — "The Notions of Consistency and Predicate Locks in a Database System."** Two-phase locking and predicate locks — the theory behind §3 and §7.
- **Gray & Reuter, 1992 — "Transaction Processing: Concepts and Techniques," ch. 7–8.** The encyclopedic treatment of the lock manager, deadlock, and granularity; the reference for this whole chapter.
- **Agrawal, Carey & Livny, 1987 — "Concurrency Control Performance Modeling."** Why deadlock detection vs prevention vs timeouts is a performance question, not just a correctness one (§5).
- **Hellerstein, Stonebraker & Hamilton, 2007 — "Architecture of a Database System," §4 (Concurrency Control) & §6.** Where the lock manager and latches sit in the engine; the locks-vs-latches distinction of §6.
- **Kleppmann, *Designing Data-Intensive Applications*, ch. 7.** The same material one notch up, with 2PL and serializability framed against MVCC/SSI — the bridge to Chapter 9.

---

## 4. Technical Architecture
Inherits ch01–07 infra (see ch04 spec §4). New content + four scene components.

### 4.1 File layout
- MDX: `src/content/chapters/08-locking-and-concurrency.mdx` (slug `08-locking-and-concurrency`).
- Components: `src/components/chapter-08/*.tsx` (default exports, no props, `client:visible`).
- Sandboxes: per-teammate distinct files (e.g. `lock-sandboxes.ts`, `twopl-sandboxes.ts`, `deadlock-sandboxes.ts`) — named exports, self-contained Python, `python3`-verified.
- Frontmatter: `title: Locking & Concurrency`, `chapterNumber: 8`, `status: draft`, voice-matched summary.

### 4.2 New scene components
| Component | Where | What | Mobile (390px) |
|---|---|---|---|
| `LockCompatScene` | §2 | Interactive S/X compatibility matrix; two transactions request locks on one item → grant/wait. | Matrix scales; request controls stack full-width. |
| `TwoPhaseScene` | §3 | Timeline of a txn's lock count rising (growing) then falling (shrinking), lock point marked; strict-mode toggle holds X locks to commit. | Timeline full-width; controls stack; second-txn lane stacks. |
| `LockManagerScene` | §4 | The lock table: resources as rows, each with a granted set (colored by mode) + wait queue; step acquire/release and watch grant/queue/drain. | Resource rows stack; granted set + queue wrap within a row. |
| `DeadlockScene` (HERO) | §5 | Transactions acquire locks until a cycle forms; live wait-for graph; cycle highlighted; victim aborted; survivors unblock. Trigger the A/B–B/A classic. | Graph scales/scrolls in-figure; transaction lanes + controls stack. |

§1, §6, §7 add no new component (prose + Python / Callout).

### 4.3 Figure numbering (sequential, no gaps — pre-assigned, frozen)
`LockCompatScene` **8.1**, `TwoPhaseScene` **8.2**, `LockManagerScene` **8.3**, `DeadlockScene` **8.4**. Each component hard-codes its number; do not renumber concurrently.

### 4.4 Sandboxes
Python-by-hand, `PythonSandbox client:only="react"`. Accumulating into a working lock manager: §1 interleave (lost update) → §2 S/X lock on one item → §3 2PL transaction wrapper → §4 the LockManager (lock table + wait queue) → §5 deadlock detector (wait-for graph + victim abort) → §6 latch-vs-lock demo. Each string self-contained valid Python; **`python3`-verify each, and also eval the actual exported template-literal string** (a ch06/ch07 lesson — verify what actually reaches Pyodide, not just the raw body). No sql.js.

### 4.5 Out of scope (later/none)
- **MVCC / snapshot isolation / SSI** — **ch09** (teased §8).
- **Recovery/rollback mechanics** of an aborted victim — **ch11** (light forward-ref only).
- Full multi-granularity lock hierarchy with the complete intention-lock matrix; lock escalation tuning; distributed locking / 2PC; optimistic CC (beyond naming) — out (name briefly at most).

---

## 5. Implementation Notes (carried gotchas)
- Prose in MDX between `<Section>`; scenes `client:visible`; `PythonSandbox` `client:only="react"`. Never wrap prose in a React component.
- **390px non-negotiable**; reflow first. Highest risk: `DeadlockScene` (graph) and `LockManagerScene` (table with queues).
- Cream palette only (`--color-fig-bg`/`fig-*`/`fig-btn`).
- Figure numbers pre-assigned (§4.3), frozen.
- **Dev-harness guardrail (ENFORCED):** do NOT create ANY page under `src/pages/` — not even `src/pages/_dev/`. Harnesses leaked into the build on ch04/05/06. `ls src/pages/` MUST show only `index.astro`, `chapters/index.astro`, `chapters/[slug].astro` when you report done. A stray `.astro` in `src/pages/` is a slice failure. (Also: don't leave `astro dev` servers running.)
- One sandbox file per teammate; self-contained; `python3`-verify AND eval the exported template string.
- `<Footnote n>` → §9; closing JSX tags (e.g. `</Callout>`) on their own line; MDX must end at `</ChapterReader>` (no trailing tool-XML — a ch07 bug).
- No prose attribution in commits; git directly, `docs(ch08)`/`feat(ch08)`.

## 6. Acceptance
- Reader can explain the lost update→lock motivation, S/X + the matrix, 2PL→serializability + strict 2PL, the lock-manager structure, deadlock detection + victim abort, latches vs locks, and lock-duration→isolation-level mapping.
- Every section quiz makes the reader *use* the model (predict a grant/wait from the matrix, spot a 2PL violation, find the cycle in a wait-for graph, pick the lock duration for a given isolation level).
- 390px clean across all four scenes.
- All Python sandboxes run in Pyodide and pass a `python3` smoke run (including the exported-template eval).
- `astro check` 0 errors, `npm run build` green (route `/chapters/08-locking-and-concurrency/`, 10 pages total), `npm test` 8/8.
- Continuity: §0–§1 cash ch01's flock promise; §7 pays off ch03's isolation levels; §6 ties to ch04/05 latches; §8 teases ch09 (correct number).
- No stray `src/pages/*.astro` routes; no leftover dev servers.

## 7. Open Calls (decisions made)
| Decision | Choice | Rationale |
|---|---|---|
| Scope | Core 2PL lock manager + deadlocks, deep, with tight cross-chapter knitting. | User's steer: deep enough + connections well-woven. |
| Hero | `DeadlockScene` (§5). | The dramatic, most visual idea; the wait-for-graph cycle is the chapter's image. |
| Latches | Included in §6 (vs ch04/05 pages). | User approved; it's a key real-world distinction and a strong continuity tie. |
| Isolation tie-in | §7 maps lock duration/scope → ch03 levels. | Pays off ch03 explicitly (the knitting the user wants). |
| Sandboxes | Python-by-hand, accumulating into a lock manager + deadlock detector. No sql.js. | Construction ethos; concurrency is best *seen* as code. |
| §8 hook | ch09 MVCC (correct post-renumber number). | The alternative to locking; next in the plan. |
| Components | Four (§4.2); §1/§6/§7 prose+Python/Callout. | One per distinct visual idea. |

## 8. Implementation Sequence (parallelizable)
1. Scaffold `08-locking-and-concurrency.mdx` (frontmatter, imports, `<Section>` shells, quiz stubs).
2. `LockCompatScene` + §1/§2 sandboxes. 390px.
3. `TwoPhaseScene` + `LockManagerScene` + §3/§4 sandboxes. 390px.
4. `DeadlockScene` (hero) + §5 sandbox (+ §6 latch sandbox). 390px (graph reflow first).
5. Prose §0–§9 (~6500–7000), quizzes apply the model, continuity callbacks/forward-refs (ch01 flock, ch03 isolation, ch04/05 latches, ch09 tease).
6. §9 Sources.
7. QA: 390px sweep, astro check, build, tests; confirm no stray harness routes / dev servers.

## 9. Out of scope (for this spec)
- ch09 (MVCC) content; ch10+ content.
- Any change to ch01–07 beyond what's required (this chapter should need none — ch03/ch01 already forward-reference "Chapter 8").
- Global shell/tokens/typography.
