# Chapter 05 — Design Spec

**Status:** Approved (design); implementation
**Date:** 2026-06-21
**Scope:** Author Chapter 05 — "The Buffer Pool" — cashing the promise Chapter 04 ended on. Build a buffer pool by hand in Python: frames, the page table, hit/miss, pin/unpin, the dirty bit, and then go deep on eviction (LRU → its scan pathology → the clock → LRU-K), closing with dirty-page write-back and the WAL write-ahead rule that ties Chapter 02's log to Chapter 04's pages.

> Shares the entire reading shell, voice, and component conventions established in Chapters 01–04. Where this spec is silent on a convention, the Chapter 04 spec (`docs/superpowers/specs/2026-06-21-chapter-04-design.md`) is authoritative — especially §4 (Technical Architecture) and §5 (gotchas). Read that spec's §4–§5 before implementing.

---

## 1. Goal

Chapter 04 ended on an explicit promise: *"That something is the **buffer pool**, and it's the next chapter… We've pointed at it. Next, we build it."* This chapter builds it. The reader has a B-tree that turns a lookup into 3–4 page reads, but every chapter so far has said "read a page" as if reading a page were free. It isn't. Pages live on disk; the database operates on copies in RAM; and something has to decide which pages are resident, which to evict when memory fills, and how to write changes back without losing them. That something is the buffer pool.

### Success criteria
- A reader who finishes Chapter 05 can explain: (a) what a buffer pool is — a fixed array of frames plus a page table mapping page-number → frame — and what a hit and a miss cost; (b) why pages must be **pinned** while in use and what the **dirty bit** is for; (c) how **LRU** eviction works and why a single large **sequential scan** wrecks it; (d) how the **clock (second-chance)** algorithm approximates LRU cheaply, and that it's what PostgreSQL actually uses; (e) the idea behind **LRU-K** and why tracking the *K*th-most-recent access resists scan pollution; (f) why evicting a **dirty** page means writing it first, and the **write-ahead rule** (a dirty page's log records must reach disk before the page does) that connects the WAL of Chapter 02 to the pages of Chapter 04.
- Goes deep on eviction (per the approved scope: "buffer pool + eviction deep-dive"). LRU → scan pathology → clock → LRU-K is the spine's through-line (§3–§6).
- Construction ethos continues: the reader builds the pool by hand in Python (Pyodide), accumulating code section to section. **No SQL sandbox this chapter** — eviction internals (clock sweep, LRU-K history) are the whole point and are not inspectable through sql.js; Python shows them cleanly.
- Connects backward (explicit callbacks to ch01/02/04) and forward (WAL-recovery → ch10; query execution → ch06) without colliding with the book's established chapter numbering.
- Every scene works at 390px. Word budget ~6500–7000.

---

## 2. Continuity (load-bearing — verified against the existing chapters)

This chapter sits in a book that has already made promises about it. Honor them.

### 2.1 Backward connections (must appear in the prose)
- **ch04 §8** ends *"We've pointed at it. Next, we build it."* → **§0 premise must open by cashing exactly this.** The reader arrives expecting the buffer pool; meet them there.
- **ch04 §5** (fan-out): *"the top of the tree is small, hot, and almost always already in memory… The thing deciding which pages stay in memory and which get evicted is the buffer pool."* → **§3 (eviction) must explain *why* the B-tree root stays hot** — it's the most-recently-and-frequently used page, so every sane eviction policy keeps it. Close that loop by name.
- **ch02 §recovery vocabulary**: *"a page in the buffer pool… a dirty page table… the materialized state."* → ch05 makes "buffer pool" and "dirty page" concrete; call back to ch02 by name when introducing the dirty bit (§2) and write-back (§7).
- **ch01**: *"the buffer pool — the database's equivalent of the OS page cache — is one of the most performance-critical components."* → use the OS-page-cache analogy in §1, and note the key difference in §7 (the database controls eviction *and* must coordinate it with its own WAL, which the OS cache does not).

### 2.2 Forward references (use the book's established numbering)
The recent chapters (02/03/04) consistently number the rest of the book: **ch06 = query execution, ch07 = locking/latching, ch08 = MVCC/vacuum, ch09 = group commit & log-structured storage, ch10 = ARIES/recovery/checkpoints/dirty-page-table, ch12 = replication.** Do not contradict this.
- **§7** introduces the **write-ahead rule** (steal/no-force; a dirty page cannot be written to disk before its log records are durable) — this is genuinely "ch02's WAL meets ch04's pages." But **full crash recovery, checkpoints, and the dirty-page table are Chapter 10** — forward-reference them there, do *not* build them here and do *not* tease them as "the next chapter."
- **§8 next-chapter hook → Chapter 06, query execution.** ch01 already promises *"Chapter 6 covers query execution: how the database turns SQL into a plan and executes it."* Now that the engine can fetch pages quickly, the natural next question is how it decides *which* pages to fetch. That's the tease.

### 2.3 ch01 roadmap patch (in scope for this work)
ch01's overview is **stale** and contradicts the shipped structure. It must be patched as part of this chapter's work (small, surgical):
- ch01 line ~340 and ~618 call the pages/physical-storage chapter **"Chapter 3"** — it is actually **Chapter 04** (Chapter 03 is Isolation Levels).
- ch01 line ~620: *"Chapters 4 and 5 cover indexes — B-trees and their variants, hash indexes…"* — indexes all landed in **Chapter 04**; **Chapter 05 is the buffer pool**. Reword to: ch04 covers pages, heaps, B-trees and indexes; ch05 covers the buffer pool; ch06 query execution.
- Only fix the stale forward-references. Do not rewrite ch01's prose, retune its voice, or touch anything else. Verify ch01 still builds (`astro check`) after the edit.

---

## 3. Chapter 05 Spine

| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | Cash ch04's promise. "Read a page" was never free. Pages live on disk; you work on copies in RAM; something must manage the copies. |
| 1 | the-pool | prose + `BufferPoolScene` + Python | A fixed array of **frames** in RAM; the **page table** maps page-number → frame. Request a page → **hit** (already resident) or **miss** (read from disk into a free frame). The OS-page-cache analogy. |
| 2 | pin-and-dirty | prose + (reuses `BufferPoolScene`) + Python | You can't evict a page someone is reading: the **pin count**. A page you've modified can't just be dropped: the **dirty bit**. Callback to ch02's "dirty page." |
| 3 | eviction-lru | prose + `EvictionScene` (HERO) + Python | The pool fills. To read a new page you must evict a resident one. Build **LRU**: evict the least-recently-used unpinned frame. Explain why the hot B-tree root (ch04) never gets evicted. |
| 4 | lru-breaks | prose + `ScanThrashScene` + Python | One large **sequential scan** touches every page once and evicts the entire hot working set — *sequential flooding*. LRU's pathology, made visceral: watch the hit rate collapse. |
| 5 | the-clock | prose + `ClockScene` + Python | The **clock / second-chance** algorithm: a circular buffer, a **reference bit** per frame, a sweeping hand that clears bits and evicts the first unreferenced frame. Approximates LRU at O(1) with one bit. What **PostgreSQL** actually uses (clock-sweep). |
| 6 | lru-k | prose + `LRUKFigure` | **LRU-K / LRU-2**: track the *K*th-most-recent access time, not just the last one, so a one-shot scan can't promote a page over a genuinely hot one. The idea behind modern scan-resistant policies. |
| 7 | dirty-writeback | prose + Python | Evicting a **dirty** page means writing it back first. The **background writer**. Then the climax: the **write-ahead rule** — a dirty page's WAL records (ch02) must be durable *before* the page itself is written (steal/no-force). Forward-ref full recovery + checkpoints to **ch10**. |
| 8 | whats-next | prose | The engine can now fetch pages fast. The open question: which pages should it fetch to answer a query? Tease **ch06 — query execution**. |
| 9 | sources | bibliography | Curated, annotated. |

---

### Scene 0 — The Premise *(prose)*
Open by collecting ch04's debt verbatim in spirit: ch04 pointed at the buffer pool and said "Next, we build it." This is next. Re-state the lie every prior chapter told for convenience — that "read a page" is free — and puncture it: a page read from an SSD is ~10–100µs and from spinning disk ~10ms, while a page already in RAM is ~100ns. Three to five orders of magnitude. So the database keeps a cache of pages in memory, and the entire game is deciding what stays. Commit to the chapter shape: build the pool, fill it, evict from it well, and finally write its dirty pages back without breaking the WAL.

**Reveals:** the reader is building the component ch04 promised; the buffer pool is a cache and the chapter is about cache replacement done under database constraints.

---

### Scene 1 — The Pool *(prose + `BufferPoolScene` + Python)*
Introduce frames, the page table, and hit/miss. A buffer pool is a fixed array of fixed-size **frames**, each able to hold one page; a hash map (the **page table**) maps a page-number to the frame holding it, or to nothing. Reading page P: if the table has P, it's a **hit** — return the frame. If not, a **miss** — find a free frame, read P from disk into it, record it in the table.

**Scene (`BufferPoolScene`):** A row/grid of frame boxes (the pool) and, beside it, the page table as a small page#→frame map. The reader requests pages by number; hits flash green, misses animate a disk-read into a free frame and add a table entry. A hit/miss counter and running hit-rate. The pool size is a small slider. This same component is reused in §2 to surface pin counts and dirty bits (props/state toggles), so build it with those affordances from the start.

**Sandbox (Python):** ~40 lines. A `BufferPool` with `get(page_no)` returning a frame, a `page_table` dict, a `frames` list, and a `disk` dict standing in for the on-disk pages. Count hits and misses. The reader requests a sequence with repeats and watches the hit rate. No eviction yet (pool big enough). Self-contained.

**Prose unpacks:** the OS-page-cache analogy (ch01 callback) — the buffer pool is the database's own page cache, living *inside* the process, sized by `shared_buffers` (Postgres) / the InnoDB buffer pool. Why the database keeps its own instead of trusting the OS cache: it knows access patterns the OS can't, and — foreshadow §7 — it must coordinate eviction with its WAL. **Reveals:** a cache hit and a cache miss differ by orders of magnitude, so the page table is the hot path.

---

### Scene 2 — Pin & Dirty *(prose + reuses `BufferPoolScene` + Python)*
Two pieces of bookkeeping the naive pool is missing. **Pin count:** while code is reading or writing a frame, that frame must not be evicted — callers `pin` it (increment) and `unpin` it (decrement); only frames with pin count 0 are eviction candidates. **Dirty bit:** if a caller modifies a page in its frame, the frame's copy now differs from disk; it's **dirty** and cannot simply be dropped — it must be written back first (paid off in §7).

**Scene:** Reuse `BufferPoolScene` with pin/dirty surfaced — each frame shows a pin badge and a dirty marker; the reader can pin/unpin and "modify" a frame to dirty it. (No new component.)

**Sandbox (Python):** Extend §1: add `pin_count` and `dirty` per frame, `pin`/`unpin`, and a `mark_dirty`. Self-contained.

**Prose unpacks:** call back to ch02 by name — this is the "dirty page" ch02 named in its recovery vocabulary; here it gets a definition. Why pinning exists (a page being read by a B-tree descent must survive until the descent is done). **Reveals:** eviction is constrained — you can only evict an unpinned frame, and evicting a dirty one has a hidden write cost.

---

### Scene 3 — Eviction: LRU *(prose + `EvictionScene` (HERO) + Python)*
The hero scene. The pool is finite; to bring in a new page when every frame is full, evict a resident one. The classic choice: **LRU** — evict the least-recently-used (unpinned) frame, betting that recently-used pages will be used again.

**Scene (`EvictionScene`):** A pool of N frames with an LRU recency ordering shown explicitly (e.g. a most-recent → least-recent lane). The reader requests pages; on a miss into a full pool, the scene highlights the LRU victim, evicts it (animating write-back if dirty), and installs the new page at most-recently-used. A hit/miss/eviction counter. Pool-size slider. Crucially, replay an access pattern where one page (the "B-tree root") is touched on every request and watch it permanently sit at most-recently-used and never get evicted — the explicit ch04 callback.

**Sandbox (Python):** Extend §2 with an LRU policy (e.g. an ordered structure / recency timestamps) and `evict()` choosing the LRU unpinned frame, writing it back if dirty. Run a workload with a hot set smaller than the pool and watch a high hit rate. Self-contained.

**Prose unpacks:** LRU's bet (temporal locality) and why it's usually right; why the hot B-tree top from ch04 stays resident under LRU (it *is* the most-recently-used, every time); the cost model (a miss = one disk read; evicting a dirty victim = one disk write + one disk read). **Reveals:** LRU is a good default — and §4 is about the workload where the default betrays you.

---

### Scene 4 — LRU Breaks *(prose + `ScanThrashScene` + Python)*
LRU's failure mode, made visceral. A single large **sequential scan** (e.g. the §3-of-ch04 full table scan) reads every page exactly once. Under LRU, each of those one-shot pages is installed as most-recently-used and evicts a genuinely hot page — by the end of the scan the entire hot working set is gone and every subsequent lookup misses. *Sequential flooding.*

**Scene (`ScanThrashScene`):** Show a hot working set sitting happily in the pool with a high hit rate, then launch a sequential scan larger than the pool and watch it bulldoze the hot pages out frame by frame, the hit rate collapsing to near zero. A clear before/after hit-rate readout. Toggle to compare with a scan-resistant policy (foreshadow §5/§6) showing the hot set surviving.

**Sandbox (Python):** Reuse the §3 LRU pool. Warm a hot set, measure hit rate, run a big scan, measure again — the collapse is a number. Self-contained.

**Prose unpacks:** why this is common and dangerous (one analytics query thrashing an OLTP cache); that real engines defend against exactly this; name the two defenses the next two sections build (clock with a twist / ring buffers for scans; LRU-K). Note Postgres uses a small ring buffer for large sequential scans precisely so they don't trash `shared_buffers`. **Reveals:** "evict the least-recently-used" is naive about *one-shot* accesses; recency alone isn't enough.

---

### Scene 5 — The Clock *(prose + `ClockScene` + Python)*
True LRU needs to reorder a structure on every single access — too expensive on the hot path at scale. The **clock (second-chance)** algorithm approximates it with one bit. Frames sit in a circle; each has a **reference bit** set on access. A **hand** sweeps: if the frame under the hand has its reference bit set, clear it and move on (a second chance); if clear, evict it.

**Scene (`ClockScene`):** Frames arranged in a circle with reference bits and a rotating hand. Requests set reference bits; an eviction sweeps the hand, clearing set bits and stopping at the first clear one. Animate the hand. Show that a frequently-touched page keeps getting its bit re-set and survives, while one-shot pages get evicted on the next sweep. Side counter vs LRU's behavior on the same trace.

**Sandbox (Python):** A `ClockPool` with a circular frame list, `ref` bits, a `hand` index, and a clock-based `evict()`. Run the §4 scan workload and show the hit rate holds up better than naive LRU. Self-contained.

**Prose unpacks:** why O(1)-per-access matters at the scale of millions of page touches per second; that clock is a *cheap approximation* of LRU, not LRU; that **PostgreSQL** uses a clock-sweep over `shared_buffers` (with a usage counter — a generalization of the single bit). **Reveals:** the practical policy is the cheap approximation, not the textbook ideal — and clock alone still doesn't fully solve scan flooding, which motivates §6.

---

### Scene 6 — Smarter: LRU-K *(prose + `LRUKFigure`)*
The principled fix for scan pollution. Plain LRU/clock judge a page by its *single* most-recent access, so one touch from a scan looks identical to one touch from a hot page. **LRU-K** judges a page by the time of its *K*th-most-recent access (LRU-2 = the 2nd-most-recent). A page touched once (a scan) has no 2nd-most-recent access, so it's evicted ahead of a page with a real access history. Recency *and* frequency, in one rule.

**Scene (`LRUKFigure`):** A mostly-static comparative figure (small interactive toggle allowed, no heavy animation): two pages — one scanned once, one accessed repeatedly — with their access-history timestamps; show how LRU-1 (plain) would keep the scanned page (more recent single touch) while LRU-2 correctly evicts it because it lacks a 2nd reference. Make the "2nd-most-recent access" the visual focal point.

**Prose unpacks:** the LRU-K idea (O'Neil, O'Neil & Weikum 1993) in plain words; that real systems use relatives of this (segmented LRU, MySQL InnoDB's midpoint-insertion young/old sublists, ARC) rather than literal LRU-K, but the principle — don't let a single touch promote a page — is shared. Keep it honest: this is the idea, not a full implementation. **Reveals:** scan resistance comes from counting accesses, not just timing the last one.

---

### Scene 7 — Dirty Pages & Write-Back *(prose + Python)*
Tie the room together. Evicting a **dirty** frame (§2) isn't free — its contents must be written to disk first, or the modification is lost. Engines use a **background writer** that proactively flushes dirty pages so eviction rarely has to wait on a write. Then the climax: you cannot write a dirty data page to disk willy-nilly, because if the machine crashes mid-write the page is torn and the only thing that can fix it is the WAL — so the **write-ahead rule** demands that *the log records describing a page's changes must be durable before that page is written to disk.* This is where **ch02's WAL** and **ch04's pages** finally sit at the same table (the exact image ch04 §8 used).

**Sandbox (Python):** Extend the pool so frames carry the LSN of their last modification; `evict()`/flush asserts the log is durable up to that LSN before writing the page (a `wal.flush_through(lsn)` call), demonstrating the ordering. Crash *without* honoring the rule and show a torn/un-recoverable page; honor it and recovery is possible. Self-contained (a tiny stub WAL, callback to ch02).

**Prose unpacks:** steal (a dirty page *may* be written before the transaction commits) and no-force (a committed transaction's pages need *not* be on disk at commit) — the policy combination real engines use, and why it makes the WAL mandatory; that the **dirty page table, checkpoints, and the full recovery algorithm are Chapter 10** (forward-ref, do not build); how this differs from the OS page cache (the OS has no WAL to coordinate with — ch01 callback). **Reveals:** the buffer pool is not just a cache; it's a cache that must obey the log. That constraint is the whole reason databases write their own.

---

### Scene 8 — What's Next *(prose)*
Short. The engine can now find a row's page (ch04) and keep hot pages in memory (ch05). The unasked question: faced with a SQL query, *which* pages should it read, and in what order — scan the heap, or descend an index, or join two tables, and how does it choose? That's the query planner and executor.

> We can fetch any page fast now. We still have no idea which pages a query *should* touch. That's the next chapter.

Tease **Chapter 06 — query execution**.

---

### Scene 9 — Sources *(bibliography)*
Curated, annotated; one to two sentences each on why it's worth the reader's time.

- **Effelsberg & Härder, 1984 — "Principles of Database Buffer Management" (ACM TODS).** The foundational paper on database buffer pools: frames, the page table, pinning, replacement, and why the database manages its own buffers. Everything in §1–§3 traces here.
- **O'Neil, O'Neil & Weikum, 1993 — "The LRU-K Page Replacement Algorithm for Database Disk Buffering."** The §6 idea, from the source: judge a page by its *K*th-most-recent reference to get scan resistance.
- **Megiddo & Modha, 2003 — "ARC: A Self-Tuning, Low Overhead Replacement Cache."** A modern scan-resistant policy that balances recency and frequency automatically; the natural next read after LRU-K.
- **PostgreSQL source & docs — buffer manager / clock-sweep** (`src/backend/storage/buffer/README`, and the `shared_buffers` docs). The §5 clock algorithm exactly as a production engine implements it, with a usage counter generalizing the reference bit.
- **Hellerstein, Stonebraker, Hamilton, 2007 — "Architecture of a Database System," §4 (Buffer Management).** Where the buffer pool sits relative to the access methods, the WAL, and the rest of the engine — the same map this book is drawing.
- **Kleppmann, *Designing Data-Intensive Applications*, Chapter 3.** The OS-page-cache vs database-buffer-pool framing and the operational consequences, one notch above this book.

---

## 4. Technical Architecture

Inherits everything from Chapters 01–04 unchanged (content collection, `[slug].astro` route, `ChapterReader`/`Section` shell, scene primitives, cream figure palette, `PythonSandbox`, footnote interception). See the Chapter 04 spec §4 for the authoritative description. This chapter adds only new content, five new scene components, and the small ch01 patch.

### 4.1 File layout
- MDX: `src/content/chapters/05-the-buffer-pool.mdx` (slug → `05-the-buffer-pool`).
- Scene components: `src/components/chapter-05/*.tsx` (default exports, no required props, hydrate `client:visible`).
- Python sandbox strings: `src/components/chapter-05/sandboxes.ts` (named exports). To avoid the ch04 file-collision, **each teammate that contributes sandbox strings uses a distinct file** (e.g. `sandboxes.ts` for the pool/dirty/writeback set, `eviction-sandboxes.ts` for LRU/scan, `clock-sandbox.ts` for clock) and tells the integrator the exact export names.
- Frontmatter: `title: The Buffer Pool`, `chapterNumber: 5`, `status: draft`, voice-matched `summary`.

### 4.2 New scene components

| Component | Where | What it does | Mobile (390px) |
|---|---|---|---|
| `BufferPoolScene` | §1, reused §2 | Frame grid + page table; request pages → hit (green flash) / miss (disk-read animation); hit-rate counter; pool-size slider. Surfaces pin badges + dirty markers for §2. | Frames wrap to a grid (fewer cols <520px); page table stacks below; controls full-width. |
| `EvictionScene` (HERO) | §3 | Pool with explicit MRU→LRU recency lane; on a full-pool miss, highlight + evict the LRU victim (animate write-back if dirty), install new page at MRU; hit/miss/eviction counters; "hot root never evicts" demo. | Recency lane becomes vertical; frames stack; controls full-width. |
| `ScanThrashScene` | §4 | Hot set resident with high hit rate → launch an over-pool sequential scan → watch hot pages get bulldozed and hit rate collapse; toggle a scan-resistant comparison. | Single column; the hit-rate readout is the focal point; scan progress is a compact bar. |
| `ClockScene` | §5 | Circular frames with reference bits + a rotating hand; requests set bits; eviction sweeps clearing bits and stops at the first clear frame. | Circle scales to width; if too tight, fall back to a vertical ring list with the hand as a moving marker. |
| `LRUKFigure` | §6 | Mostly-static comparison: a scanned-once page vs a repeatedly-accessed page with their access-history timestamps; shows LRU-1 keeping the wrong one and LRU-2 evicting it. Light toggle ok, no heavy animation. | Two panels stack vertically; timeline rows remain legible. |

§2 and §7 add **no new component** (§2 reuses `BufferPoolScene`; §7 is prose + Python).

### 4.3 Reused primitives
`<Figure>` (number + caption), `<Slider>` (pool size, etc.), `<Callout>` (e.g. the Postgres clock-sweep aside in §5, the write-ahead-rule warning in §7), `<Footnote n>` (→ §9), `<Section>` + `<ChapterReader chapterId="05-the-buffer-pool">`.

### 4.4 Figure numbering (sequential in document order, no gaps — the verified ch01/ch02/ch04 convention)
Number figures sequentially as they appear, skipping figureless sections. §2 and §7 have no `<Figure>`. Canonical set:
- `BufferPoolScene` (§1) → **5.1**
- `EvictionScene` (§3) → **5.2**
- `ScanThrashScene` (§4) → **5.3**
- `ClockScene` (§5) → **5.4**
- `LRUKFigure` (§6) → **5.5**

These are assigned here to prevent the concurrent-edit thrash that hit ch04. **Do not deviate.** Each component hard-codes its own number from this list.

### 4.5 Sandboxes
Python-by-hand only, via `PythonSandbox client:only="react"`. Accumulating: §1 pool → §2 pin/dirty → §3 LRU → §4 scan-thrash (reuses §3) → §5 clock → §7 dirty write-back + WAL ordering. **Each sandbox string must be self-contained valid Python** (the Pyodide runtime is shared across sandboxes on a page; do not rely on cross-sandbox state). Verify each by running it through `python3` before claiming done. No `SqlSandboxReact` this chapter.

### 4.6 Out of scope (deferred — do not build)
- **Full crash recovery, the dirty-page table, checkpoints, fuzzy checkpointing, ARIES.** Forward-ref to **ch10** only (§7).
- **Query planning/execution.** Teased as **ch06** (§8); not built.
- **Group commit / log-structured storage.** **ch09.**
- **Concurrency on the buffer pool (latching, lock-free hash tables), prefetching/readahead beyond a one-line mention, NUMA, direct IO, double-write buffers.** Out.
- **A real SQL/sql.js sandbox.** Not used this chapter.

---

## 5. Implementation Notes (gotchas carried from Chapters 01–04)
- **Astro slot mechanism.** Prose lives in MDX between `<Section>` tags; scenes are React islands (`client:visible`). Never wrap MDX prose inside a React component.
- **Mobile 390px is non-negotiable.** Build each scene's reflow first. Highest risk: `ClockScene` (the circle) and `EvictionScene` (the recency lane). Verify at 390px before writing prose around them.
- **Cream figure palette only** (`--color-fig-bg` / `fig-*` / `fig-btn`). No dark surfaces, no new accent colors.
- **Figure numbers are pre-assigned in §4.4 and frozen.** Each component hard-codes its number. Do not renumber concurrently.
- **Sandbox files: one per teammate** to avoid the ch04 collision; each sandbox string self-contained and `python3`-verified.
- **Footnotes** via `<Footnote n>` (inline anchor + §9 list). No custom anchors.
- **No prose attribution in commits.** Standing rule. (The `commit` skill is not installed in this environment; commit via git directly with no Claude attribution, matching the repo's `docs(chNN)` / `feat(chNN)` convention.)
- **ch01 patch is surgical** — only the stale forward-references (§2.3). Re-run `astro check` after editing ch01.

---

## 6. Acceptance for Chapter 05
The chapter is done when:
- A reader can explain frames + page table + hit/miss, pin/dirty, LRU and its scan pathology, the clock approximation (and that Postgres uses it), the LRU-K idea, and the write-ahead rule connecting the WAL to dirty-page write-back.
- Every section quiz asks the reader to *use* the model the section built.
- Every scene works at 390px.
- All Python sandboxes run end-to-end in Pyodide without throwing (and pass a `python3` smoke run).
- The ch01 roadmap patch is applied and ch01 still builds.
- `astro check` 0 errors, `npm run build` green (route `/chapters/05-the-buffer-pool/`), `npm test` 8/8.
- Continuity holds: §0 cashes ch04's promise, the backward callbacks (§2.1) are present, and the forward refs use the established numbering (recovery→ch10, query exec→ch06).

---

## 7. Open Calls (decisions made)
| Decision | Choice | Rationale |
|---|---|---|
| Topic / position | Buffer pool = Chapter 05. | ch04 §8 explicitly promises it as the next chapter; fits before ch06 query-exec / ch07 locking / etc. |
| Depth | Eviction deep-dive: LRU → scan pathology → clock → LRU-K. | Approved scope. |
| Sandbox language | Python-by-hand only; no sql.js. | Eviction internals are the point and aren't inspectable in sql.js. Construction ethos from ch02/04. |
| Hero scene | `EvictionScene` (§3, LRU). | Eviction is the chapter's center of gravity. |
| §7 climax | Write-ahead rule (steal/no-force), WAL meets pages. Full recovery deferred. | Genuinely ties ch02↔ch04; recovery is the established **ch10**. |
| §8 hook | Chapter 06 — query execution. | Matches ch01's roadmap; avoids colliding with ch10. |
| ch01 patch | Fix stale roadmap (pages=ch04, buffer pool=ch05, query exec=ch06). | Approved; keeps the book internally consistent. |
| New components | Five (§4.2); §2 reuses `BufferPoolScene`, §7 is prose+Python. | One per distinct visual; pin/dirty folds into the pool scene. |

---

## 8. Implementation Sequence (parallelizable across a team)
1. Scaffold `05-the-buffer-pool.mdx` (frontmatter, imports, `<Section>` shells, quiz stubs).
2. `BufferPoolScene` (+ pin/dirty affordances) and §1/§2 sandboxes. Verify 390px.
3. `EvictionScene` (hero) + `ScanThrashScene` and §3/§4 sandboxes. Verify 390px (recency lane reflow first).
4. `ClockScene` + `LRUKFigure` and §5 clock sandbox. Verify 390px (circle reflow first).
5. §7 dirty-writeback + WAL-ordering sandbox.
6. Prose §0–§9 (~6500–7000 words), authored in order, each `Section` quiz applies the model; bake in the §2.1 backward callbacks and §2.2 forward refs.
7. ch01 roadmap patch (§2.3); re-run `astro check`.
8. §9 Sources.
9. QA: 390px sweep (all five scenes), `astro check`, `npm run build`, `npm test`, phone + desktop walkthrough.
10. (Separate, on request) publish + commit.

---

## 9. Out of scope (for this spec)
- Chapter 06+ prose/components.
- Any change to ch02/03/04, or to the global reading shell/tokens/typography.
- The ch01 change is limited to the stale forward-references in §2.3 — nothing else in ch01.
