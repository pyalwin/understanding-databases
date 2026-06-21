# Chapter 04 — Design Spec

**Status:** Approved (design); spec under review
**Date:** 2026-06-21
**Scope:** Author Chapter 04 — "Where Data Actually Lives" — picking up the page promise made in Chapter 02. Build a page, a heap file, and a B-tree index by hand in Python, go deep on B-tree internals (splits, fan-out/height, clustered vs secondary), and close with the payoff in real SQLite.

---

## 1. Goal

Chapter 02 left a promise on the table: *"real databases pack many rows per file because IO is page-granular, and you cannot rewrite the whole file on every transfer."* Chapter 03 handled isolation. Chapter 04 cashes the page promise. The reader can now commit transactions safely and isolate them — but their "database" is still a JSON file they rewrite whole. This chapter is the reader discovering, by building it, *where a row actually sits on disk and how you find one without reading the entire file.*

### Success criteria
- A reader who finishes Chapter 04 can explain: (a) why storage engines deal in fixed-size **pages**, not rows, and what a slot directory buys them; (b) why a **heap file** makes inserts cheap and point lookups O(n); (c) how a **B-tree** turns that O(n) scan into O(log n), mechanically, including what happens on a **node split**; (d) why real B-trees are only 3–4 levels deep even for billions of rows (**fan-out**); (e) the difference between a **clustered** and a **secondary** index and the cost of the extra hop.
- The chapter goes deep on the B-tree (per the approved scope: "Core + deep B-tree internals"). Four of the eight content scenes (§4–§7) are B-tree-centric.
- Construction ethos from Chapter 02 carries: the reader builds pages → heap → scan → B-tree by hand in Python (Pyodide), accumulating code section to section. The chapter closes with a real-SQLite (sql.js) payoff showing `EXPLAIN QUERY PLAN`.
- Every scene works at a 390px viewport. No exceptions.
- The chapter reads as the next chapter of the same book — same cream page, same cream figure surfaces, same voice, same primitives.
- Word budget ~6500–7000 (deeper than ch02/03, per scope).

---

## 2. Reading Experience

Inherits the entire reading shell from Chapters 01–03 — cream background, serif body at 18–19px, warm cream figure cards (`--color-fig-bg`), amber chapter chrome, marginalia gutter, `ChapterReader` progress/TOC, `Section` quiz gating. No new design tokens, no new typography.

### 2.1 Voice
Identical to Chapters 01–03. Narrative, second-person, tension-first. Definitions are earned by the story, not declared. We never say "a B-tree is…" before the reader has been made to want one by feeling the full-scan pain themselves.

Sample register (in this chapter's voice):

> Your heap file works beautifully right up until someone asks it a question. `SELECT balance FROM accounts WHERE id = 8675309`. There are forty million rows in this file and the row you want is, as far as the file is concerned, nowhere in particular. So you do the only thing the file lets you do: you start at the first page and you read. Page after page after page, four kilobytes at a time, comparing every id to the one you're looking for, until you either find it or fall off the end. The database did exactly what you asked. It just had to read the entire disk to do it.

### 2.2 Word budget
- Total prose: ~6500–7000 words across scenes 0–9.
- Scene 4 (the B-tree hero scene) gets the largest slice — roughly 1300–1500 words — because it's where the chapter earns its name.
- Every non-trivial claim either gets unpacked in prose or carries a footnote into §9 Sources.

### 2.3 Content depth
We name real mechanisms by their real names: page, slot directory, heap file, tuple/row id (ctid), B-tree, node split, fan-out, leaf vs internal node, clustered index, secondary index, covering index, sequential scan, index seek. We forward-reference the buffer pool (next chapter), and back-reference the WAL (ch02) and isolation (ch03). We do not invent vocabulary.

---

## 3. Chapter 04 Spine

Structured as a **guided act of construction**, like Chapter 02. The reader builds a real storage engine bottom-up: a page, a file of pages, the scan that hurts, the index that fixes it, then the internals that make the index practical, then the same idea in a real engine.

| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | You can commit and isolate now. But your database is still a JSON blob you rewrite whole. Watch that fall apart at scale. |
| 1 | the-page | prose + `PageLayoutScene` + Python sandbox | Why disks and DBs deal in fixed-size **pages**, not rows. Build a 4KB page with a slot directory by hand. |
| 2 | the-heap | prose + Python sandbox | Stack pages into a **heap file**. Append rows across pages. Inserts are cheap. |
| 3 | the-scan | prose + `ScanScene` + Python sandbox | Query it. Point lookup → read every page. O(n). The pain that motivates indexing. |
| 4 | the-btree | prose + `BTreeScene` (HERO) + Python sandbox | Build a B-tree index: search, insert, **node split**. Reader inserts keys and watches the tree grow and split. |
| 5 | fan-out | prose + `FanoutScene` | The height math: why a 3–4 level tree indexes billions of rows. Interactive fan-out → height/IO calculator. |
| 6 | index-kinds | prose + `IndexKindsScene` | **Clustered** (rows in the leaf) vs **secondary** (leaf points back to the heap). The extra hop; covering indexes. |
| 7 | the-payoff | prose + SQLite (sql.js) sandbox | Same query, `EXPLAIN QUERY PLAN`, with and without `CREATE INDEX`: sequential scan vs index seek in a real engine. |
| 8 | whats-next | prose | Tease the **buffer pool**: these pages don't live on disk while you use them — they live in memory, and managing that is its own chapter. |
| 9 | sources | bibliography | Curated, annotated reading list. |

---

### Scene 0 — The Premise *(prose)*
Open by collecting the winnings from Chapters 02–03: we can commit a transaction so it survives a crash, and we can run two of them in the same room without corrupting each other. Then puncture it: the "database" underneath all that is still a single JSON file we rewrite in full on every change. That was fine for a demo and is catastrophic for anything real — re-serializing forty million rows to move fifty dollars. This chapter is where we throw out the JSON blob and build the thing real engines actually use to store rows on disk and find them again.

**Reveals:** the reader's role — they're building a storage engine bottom-up, not reading about one.

---

### Scene 1 — The Page *(prose + `PageLayoutScene` + Python sandbox)*
Why fixed-size pages exist at all: disks and the OS move data in fixed blocks, IO is page-granular, and a database that wants predictable IO matches that granularity. Introduce the **page** (commonly 4KB/8KB/16KB) and the **slot directory** — the little array of offsets at the top of the page that lets rows be variable-length and still be addressable, deletable, and compactable without rewriting the whole page.

**Scene (`PageLayoutScene`):** A single page drawn as a box: a header, a slot directory growing down from the top, row data growing up from the bottom, free space in the middle. The reader inserts and deletes rows; slots and the free-space pointer update live. Deleting a row leaves a tombstoned slot; inserting reuses free space. Caption names the parts.

**Sandbox:** ~30 lines of Python. A `Page` class backed by a fixed-size `bytearray` (e.g. 4096 bytes), with `insert(row_bytes) -> slot` and `read(slot) -> bytes`, a slot directory, and a free-space pointer. Raises when the page is full. The reader inserts rows until the page rejects one, proving pages are finite.

**Prose unpacks:** why variable-length rows need indirection (the slot directory) rather than fixed offsets; why deletes leave slots rather than shifting bytes; the page is the unit of IO and the unit of caching (forward-reference to §8 buffer pool). Footnote to the SQLite and PostgreSQL page-layout docs.

**Reveals:** a database file is not a stream of rows. It's an array of fixed-size pages, each a tiny self-describing heap.

---

### Scene 2 — The Heap *(prose + Python sandbox)*
One page holds a few rows; a table holds millions. Stack pages into a **heap file**: an ordered array of pages on disk, rows appended wherever there's room. Introduce the (page number, slot) pair as a row's physical address — name it as PostgreSQL's `ctid` / the generic "row id."

**Sandbox:** Extends §1. A `Heap` class wrapping a list of `Page`s (persisted to one file via the §1 byte layout), with `insert(row) -> (page_no, slot)` that appends to the last page or allocates a new one when full, and `get(page_no, slot)`. The reader bulk-inserts a few hundred rows and watches the page count climb. Cheap, append-only inserts.

**Prose unpacks:** why the heap is the default table storage in many engines (Postgres) — inserts are O(1) appends, no reorganization. The cost is deferred, not avoided: the heap has no order, so finding a row by value means you have no idea which page it's on. Set up §3.

**Reveals:** insert got cheap. Lookup is about to get expensive — that's the trade we just made.

---

### Scene 3 — The Full Scan *(prose + `ScanScene` + Python sandbox)*
The heap answers `WHERE id = ?` the only way it can: read every page, check every row. O(n) in the number of pages.

**Scene (`ScanScene`):** A row of page boxes (wraps to a grid on mobile). The reader picks a target id; an animated cursor walks page by page, each page lighting as it's read, a running "pages read" counter climbing, until it hits the match (or the end). A slider sets the table size (pages); the worst-case and average pages-read numbers scale visibly. The point lands viscerally: doubling the table doubles the work.

**Sandbox:** Extends §2. A `scan(heap, predicate)` that iterates every page and every slot, counting pages touched, and returns matches plus the count. The reader runs a lookup on a few-hundred-row heap and sees the pages-read number equal the page count. Run it again for a value that doesn't exist — same cost, full scan.

**Prose unpacks:** O(n) is fine at small scale and ruinous at large scale; the database isn't being dumb, it genuinely has no other option *given only a heap*. Name what we need: a way to know which page a value lives on without reading them all. Footnote: this is exactly the sequential-scan node we'll see by name in §7's `EXPLAIN QUERY PLAN`.

**Reveals:** the heap's missing ingredient is *order you can search*. That's the index.

---

### Scene 4 — The B-Tree *(prose + `BTreeScene` (HERO) + Python sandbox)*
The chapter's hero scene. The reader builds a B-tree (B+-tree flavor: keys in internal nodes route, values/row-ids live in the leaves) and watches it stay balanced as it grows.

**Scene (`BTreeScene`):** An animated tree, cream figure palette. The reader inserts keys one at a time (preset sequence buttons + a free input). Each insert animates: descend to the correct leaf, place the key in sorted order, and — when a node overflows its fixed capacity — **split** it, push the median up to the parent, and (when the root splits) grow a new level. A "search" mode highlights the root-to-leaf path for a queried key and counts nodes visited (compare to §3's pages-read). Capacity (max keys per node) is a small slider so the reader can force splits quickly.

**Sandbox:** ~70 lines of Python. A `BTree` with a small `order`, `insert(key, row_id)`, `search(key) -> row_id`, and the leaf/internal split logic, printing the tree shape after each insert so the reader sees structure emerge in text alongside the animation. Then wire it to the §2 heap: the B-tree maps `id -> (page_no, slot)`, and `lookup(id)` does search-then-heap-fetch, counting pages touched — a single-digit number against §3's hundreds.

**Prose unpacks:** *why a tree and not a sorted array* (sorted array makes search cheap but insert O(n) from shifting; the B-tree keeps both cheap by being balanced and node-granular). What "balanced" means and why splits preserve it. Why nodes are sized to a page (each node is one page → each level is one IO). B vs B+ in one honest sentence (values in leaves, leaves often linked for range scans). Footnotes: Bayer & McCreight 1972; Comer's *The Ubiquitous B-Tree*.

**Reveals:** O(log n), and the log base is huge because each node holds hundreds of keys — which is exactly §5.

---

### Scene 5 — Fan-Out & Height *(prose + `FanoutScene`)*
The B-tree's real superpower isn't that it's logarithmic; it's that the logarithm's *base* is enormous. A page holds hundreds of keys, so each level multiplies reachable rows by hundreds.

**Scene (`FanoutScene`):** An interactive calculator/figure. Sliders for keys-per-node (fan-out) and number of rows; the figure reports tree height and worst-case IO (levels touched) and renders a schematic few-level pyramid with the row count at the bottom. The headline number: with fan-out ~400, three levels already addresses tens of millions of rows; four levels, billions. The reader drags fan-out down to 2 (a binary tree) and watches the height explode — making the case for wide nodes concrete.

**Prose unpacks:** the height formula `h ≈ log_fanout(N)` in plain words; why fan-out is set by page size / key size, which is why bigger pages or smaller keys mean shallower trees; why height ≈ IO count is the number that actually matters because each level is (at most) one page read. Tie back to §4 (node = page) and forward to §8 (and most of the top levels live cached in the buffer pool, so real lookups touch disk even less).

**Reveals:** "logarithmic" undersells it. A 3–4 level B-tree is, for practical table sizes, effectively constant-depth — that's why every relational database reaches for one.

---

### Scene 6 — Clustered vs Secondary *(prose + `IndexKindsScene`)*
Two ways to attach a B-tree to a table, with different costs.

**Scene (`IndexKindsScene`):** Two side-by-side diagrams (stack on mobile). **Clustered:** the B-tree leaves *are* the table rows, stored in key order — one structure, lookup ends at the leaf. **Secondary:** the B-tree leaves hold the key plus a pointer (row id / primary key) back into the heap (or clustered index) — lookup ends with an extra hop to fetch the full row. The reader toggles a query and watches the access path: clustered = one descent; secondary = descent + heap fetch; **covering** secondary (all needed columns in the index) = descent only, hop skipped. A small label notes the engines: SQLite/Postgres primary tables are heap+secondary by default; InnoDB/MySQL clusters on the primary key.

**Prose unpacks:** the trade — a clustered index makes range scans on the cluster key fast and avoids the hop, but there can be only one clustering order per table; secondary indexes are free to add but pay the hop unless they cover the query. Define **covering index** as the optimization that removes the hop. Honest one-liner on insert cost: a clustered index must keep rows in order, so inserts can cause page splits in the table itself, not just the index.

**Reveals:** "add an index" is not one decision. It's a choice about where the row data lives relative to the search structure, and that choice is a read/write trade.

---

### Scene 7 — The Payoff *(prose + SQLite (sql.js) sandbox)*
Everything built by hand now appears, by its real name, in a real engine. Reuse the `SqlSandboxReact` component from Chapter 03.

**Sandbox (`SqlSandboxReact`):** Seeded SQL that creates a table, inserts a few thousand rows, and runs `EXPLAIN QUERY PLAN SELECT ... WHERE indexed_col = ?` — showing `SCAN TABLE` (the §3 full scan, by SQLite's own name). The reader then runs `CREATE INDEX`, re-runs the same `EXPLAIN QUERY PLAN`, and sees `SEARCH TABLE ... USING INDEX` (the §4 index seek). A second query demonstrates a **covering** index (`USING COVERING INDEX`) to land §6. Comments in the seed SQL connect each plan line back to the scene that built the concept.

**Prose unpacks:** how to read an `EXPLAIN QUERY PLAN`, mapping `SCAN` → §3, `SEARCH ... USING INDEX` → §4/§5, `USING COVERING INDEX` → §6. The reader has now seen the same mechanism from both ends: built by hand, and named by a shipping database. Footnote to the SQLite query-planner / `EXPLAIN QUERY PLAN` docs.

**Reveals:** the vocabulary the engine prints is the vocabulary the reader just built. Nothing in the query planner's output is a black box anymore.

---

### Scene 8 — What's Next *(prose)*
Tease the next chapter in one short section.

> We've been saying "read a page" as if reading a page were free. It isn't, and pretending it is has been the one lie holding this chapter together.

These pages live on disk, but you don't operate on disk — you operate on copies in memory, and something has to decide which pages are in memory, when to evict them, and how to not lose a write that only made it as far as RAM. That something is the **buffer pool**, and it's where the WAL from Chapter 02 and the pages from Chapter 04 finally meet. Point at it; don't build it here.

---

### Scene 9 — Sources *(bibliography)*
Curated, annotated. Each entry one to two sentences on why it's worth the reader's time.

- **Bayer & McCreight, 1972 — "Organization and Maintenance of Large Ordered Indices."** The original B-tree paper. Short and readable; the splitting algorithm in §4 is theirs.
- **Douglas Comer, 1979 — "The Ubiquitous B-Tree" (ACM Computing Surveys).** The best single survey of B-trees and B+-trees; explains the variants and why B+ won for databases.
- **Goetz Graefe, 2011 — "Modern B-Tree Techniques."** Everything that happened to the B-tree after 1979 — prefix compression, latching, write optimization. Read after this chapter.
- **Hellerstein, Stonebraker, Hamilton, 2007 — "Architecture of a Database System," §3 (Storage) and §4 (Access Methods).** Where pages, heaps, and indexes sit relative to the buffer pool and the rest of the engine. The map for the next several chapters.
- **PostgreSQL documentation — Database Page Layout** (`postgresql.org/docs/current/storage-page-layout.html`). The real slot-directory page layout from §1, in production, with the names Postgres uses (line pointers, `ctid`).
- **SQLite — The SQLite Database File Format** (`sqlite.org/fileformat2.html`) and **The Query Planner** (`sqlite.org/queryplanner.html`). The page format behind §1 and the `EXPLAIN QUERY PLAN` output behind §7.
- **Kleppmann, *Designing Data-Intensive Applications*, Chapter 3 ("Storage and Retrieval").** The same material one notch up, with B-trees vs LSM-trees set side by side — the natural next read, and where the LSM contrast we deferred lives.

---

## 4. Technical Architecture

All of Chapters 01–03 infrastructure carries over unchanged: content collection, `[slug].astro` route, `ChapterReader`/`Section` scene shell, scene primitive library, design tokens, cream figure palette, marginalia, footnote interception, `PythonSandbox` (Pyodide), `SqlSandboxReact` (sql.js). This chapter adds only new content and five new scene components.

### 4.1 File layout
- MDX: `src/content/chapters/04-where-data-lives.mdx`.
- Scene components: `src/components/chapter-04/*.tsx`.
- Frontmatter: `chapterNumber: 4`, `status: 'draft'` until ship. (Slug derives from filename → `04-where-data-lives`.)

### 4.2 New scene components

| Component | Where used | What it does | Mobile reflow notes |
|---|---|---|---|
| `PageLayoutScene` | §1 | A single 4KB page: header, slot directory (top-down), row data (bottom-up), free space. Insert/delete rows; slots and free-space pointer update live. | Single column at <720px; the page box scales to width; controls stack below. |
| `ScanScene` | §3 | A grid of page boxes; an animated cursor walks page by page on a point lookup, lighting each page, with a running "pages read" counter. Table-size slider scales the count. | Page grid wraps; reduce columns at <520px; counter sits above the grid. |
| `BTreeScene` (HERO) | §4 | Animated B+-tree. Insert keys (presets + free input); descend, place in sorted order, split on overflow, grow a level on root split. Search mode highlights root-to-leaf path and counts nodes. Node-capacity slider. | Tree pans/scrolls horizontally inside the figure at <720px; controls stack; node boxes shrink with a min touch target. |
| `FanoutScene` | §5 | Fan-out and row-count sliders → computed tree height and worst-case IO, with a schematic few-level pyramid. Drag fan-out to 2 to watch height explode. | Sliders stack full-width; pyramid scales to width; numbers remain the focal point at <520px. |
| `IndexKindsScene` | §6 | Side-by-side clustered vs secondary diagrams; toggle a query to animate the access path (clustered = one descent; secondary = descent + heap hop; covering = hop skipped). | Diagrams stack vertically at <720px; access-path animation runs per-diagram. |

§7 reuses `SqlSandboxReact`. No new component. (No use of `StepThrough` is required, but it is available if a scene author prefers a stepped reveal over animation for `ScanScene`.)

### 4.3 Reused primitives
- `<Figure>` for the chrome of every scene (number + caption).
- `<Slider>` for the size/capacity/fan-out controls in §1, §3, §4, §5.
- `<Callout>` for sidebars (e.g. engine-specifics in §6, the "reading a query plan" aside in §7).
- `<Footnote n>` for every citation that points into §9.
- `<Section>` for each scene's quiz-gated wrapper; `<ChapterReader chapterId="04-where-data-lives">` for the shell.

### 4.4 Sandboxes
- **Python (Pyodide)** via `PythonSandbox` for §1, §2, §3, §4. Each sandbox seeds the prior section's code as a starting point so the reader's mental model and code accumulate (the Chapter 02 pattern). Pyodide already `chdir`s to `/`; no file seeding is strictly required here since the engine is built in-memory, but `initialFiles` is available if a sandbox wants to persist a heap file across runs.
- **SQLite (sql.js)** via `SqlSandboxReact client:only="react"` for §7, seeded with `initialSql`. Single-connection, which is all §7 needs.

### 4.5 MDX layout
Identical to Chapters 02–03:
- Frontmatter (title, chapterNumber: 4, summary, status).
- Imports: `ChapterReader`, `Section`, scene primitives, `PythonSandbox`, `SqlSandboxReact`, and the five `chapter-04/*` components.
- `<ChapterReader chapterId="04-where-data-lives">` wraps a sequence of `<Section id title quiz>` blocks, scenes interleaved with prose.
- Each `Section`'s `quiz` asks the reader to *use* the model the section just built, not recall trivia.
- Sources rendered as the last section; footnotes resolve to it via `ChapterReader`'s anchor interception.

### 4.6 Out of scope (deferred to later chapters)
- **LSM-trees / write-optimized storage.** The read/write-tradeoff contrast. Pointed at in §9 (Kleppmann ch3). A later chapter.
- **The buffer pool / page cache management, eviction, dirty-page flushing.** Teased in §8; it's the next chapter.
- **Concurrency on the B-tree (latching, lock coupling, Blink-trees).** Mentioned at most in a Graefe footnote. Later.
- **WAL interaction with pages (full-page writes, checkpoints, the dirty-page table).** Chapter 10 territory; §8 only gestures at the meeting point.
- **Query optimization beyond reading a single `EXPLAIN QUERY PLAN`.** Cost models, join algorithms, multi-column/partial indexes. A later chapter.
- **Compression, prefix truncation, vacuum/bloat.** Out.

---

## 5. Implementation Notes (gotchas carried from Chapters 01–03)

These bit prior chapters and are load-bearing here.

- **Astro slot mechanism.** `ChapterReader`/`Section` are the Astro versions; prose lives in MDX between `<Section>` tags. Scenes are React islands mounted with a `client:` directive inside that Astro-rendered prose flow. Do not wrap MDX prose inside a React component — it collapses to `<astro-slot>` and silently breaks.
- **Hydration directives.** Follow the existing pattern: scene components hydrate with `client:visible`; `SqlSandboxReact` uses `client:only="react"` (as in Chapter 03). `PythonSandbox` follows its Chapter 01/02 usage.
- **Mobile breakpoint is non-negotiable.** Every scene must work at 390px. Audit when the scene is built, not after layout. Highest risk: `BTreeScene` (horizontal tree) and `ScanScene` (page grid). Build the reflow first, then the prose around it.
- **Cream figure palette is the only palette.** All figures use `--color-fig-bg` and the `fig-*` classes/`fig-btn`. No dark surfaces, no new accent colors, no new typography stack.
- **Footnotes auto-jump to Sources.** Use `<Footnote n>` (anchor form inline, list form in §9). Do not roll your own anchor mechanism.
- **Pyodide is shared across sandboxes** (one runtime per page, cached). Keep per-sandbox code self-contained or explicitly seeded; don't rely on global state leaking between sandboxes on the page.
- **No prose attribution in commits.** Standing rule. Use the `/commit` skill.

---

## 6. Acceptance for Chapter 04

The chapter is done when:
- A reader who didn't know how a row is stored can explain pages + slot directory, the heap, why a point lookup on a heap is O(n), how a B-tree makes it O(log n) including the node split, why fan-out makes the tree shallow, and the clustered-vs-secondary trade.
- Every section quiz is pedagogically meaningful — it asks the reader to apply the model the section just built.
- Every scene works at 390px width.
- All Python sandboxes (§1–§4) run end-to-end in Pyodide without throwing; the §7 SQLite sandbox runs and its `EXPLAIN QUERY PLAN` output shows `SCAN`, then `SEARCH ... USING INDEX`, then `USING COVERING INDEX`.
- `npm test` (Vitest) and `tsc --noEmit` (via `astro check`) pass clean; `npm run build` succeeds.
- A walkthrough on a phone and on desktop both feel like a chapter of the same book as Chapters 01–03.

---

## 7. Open Calls (decisions made)

| Decision | Choice | Rationale |
|---|---|---|
| Scope/depth | Core + deep B-tree internals. | Approved. Pages → heap → scan → B-tree, then splits, fan-out/height, clustered vs secondary. Four B-tree-centric scenes. |
| LSM-trees | Out of scope. Pointed at in §9. | Keeps the chapter's spine on the B-tree. The B-tree vs LSM contrast is its own later chapter; Kleppmann ch3 covers it for eager readers. |
| Sandbox languages | Python by hand (§1–§4) + SQLite payoff (§7). | Construction ethos from ch02 (build it yourself) plus a real-engine payoff that ties back to ch03's sql.js. Reuses both existing sandbox primitives. |
| Hero scene | `BTreeScene` (§4). | The B-tree is the one mental model the reader must leave with. |
| B-tree flavor | B+-tree (values/row-ids in leaves, internal nodes route). | What real databases use; makes §6 (leaf = row vs leaf = pointer) and range scans coherent. Stated honestly in one sentence in §4. |
| §8 next-chapter hook | The buffer pool. | Confirmed. It's where ch02's WAL and ch04's pages meet, and it's the natural next mechanism. |
| New components | Five, listed in §4.2. | One per non-reused, non-SQL scene. §7 reuses `SqlSandboxReact`. |
| Slug | `04-where-data-lives`. | Filename-derived; matches the existing kebab-case chapter slugs. |

---

## 8. Implementation Sequence (preview)

Detailed plan written separately (writing-plans). Rough order, parallelizable across a team:

1. Scaffold `src/content/chapters/04-where-data-lives.mdx` with frontmatter, imports, and `<Section>` headings (no prose yet).
2. Build `PageLayoutScene` + §1 Python sandbox. Verify at 390px.
3. Build `ScanScene` + §3 Python sandbox (heap from §2 built in-sandbox). Verify at 390px.
4. Build `BTreeScene` (hero) + §4 Python sandbox. Verify the horizontal reflow on mobile *before* writing prose around it.
5. Build `FanoutScene` (§5) and `IndexKindsScene` (§6). Verify at 390px.
6. Wire the §7 `SqlSandboxReact` seed SQL; confirm `EXPLAIN QUERY PLAN` produces `SCAN` → `SEARCH ... USING INDEX` → `USING COVERING INDEX`.
7. Write prose scene by scene in order; target 6500–7000 words; author each `Section` quiz.
8. Curate §9 Sources with one-line "why bother" notes.
9. QA: phone + desktop walkthrough, `npm test`, `astro check`, `npm run build`.
10. Publish: flip `status` to `published`, link from home/README, update the chapters table.

---

## 9. Out of scope (for this spec)
- Chapter 05+ prose and components (the buffer pool chapter).
- Any change to Chapters 01–03.
- Any change to the global reading shell, layout tokens, or typography.
- LSM-trees, query optimization depth, concurrency on the B-tree, and WAL/page interaction (all named in §4.6 as later chapters).
