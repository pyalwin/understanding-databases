# Chapter 02 — Design Spec

**Status:** Draft for review
**Date:** 2026-06-21
**Scope:** Author Chapter 02 — "The Transaction" — picking up where Chapter 01 left us, and building the write-ahead log from scratch.

---

## 1. Goal

Continue the story from Chapter 01. We left `users.json` in pieces; this chapter is the reader trying to fix it themselves, in code, and watching each fix break in a new way until they have built — by hand, in Python, in the browser — the kernel of a write-ahead log.

### Success criteria
- A reader who finishes Chapter 02 can explain (a) why `os.rename` alone isn't enough once you have more than one file, (b) what a commit record is and why its position in the log matters, (c) how recovery works mechanically when the machine comes back up.
- The chapter stays tight. WAL + recovery only. No group commit, no MVCC, no ARIES depth. SQL appears only as a one-line tease at the end.
- Every scene works at 390px viewport. No exceptions.
- The chapter reads as the next chapter of the same book — same cream page, same cream figure surfaces, same voice, same primitives.

---

## 2. Reading Experience

Inherits the entire reading shell from Chapter 01 — cream background, serif body at 18–19px, warm cream figure cards (`--color-fig-bg`), amber chapter chrome, marginalia gutter. No new design tokens, no new typography. The reader should feel they've turned a page, not opened a new app.

### 2.1 Voice
Identical to Chapter 01. Narrative, second-person, tension-first. Definitions are earned by the story, not declared. We never say "a transaction is..." before the reader has been forced to want one.

Sample register (in this chapter's voice):

> So you wrote to a temp file and renamed it. The file you publish is either the old one or the new one, never the half-written carcass in between. You feel pretty good about this. You should — `os.rename` on POSIX is genuinely atomic, and you just bought yourself the first real guarantee in this book.
>
> Now do it twice.
>
> Open a second file, `b.json`. Move fifty dollars from `a.json` to `b.json`. Two reads, two writes, two renames. Your rename trick still works on each file individually — neither file will ever be half-written. But the *pair* of files can absolutely be in a state that no honest accountant would sign off on, and the operating system has no idea, because the operating system has never heard of accountants.

### 2.2 Word budget
- Total prose: ~5500–6000 words across scenes 0–8.
- Scene 3 (the WAL hero scene) gets the largest slice — roughly 1200–1400 words — because it's where the chapter earns its name.
- Every non-trivial claim either gets unpacked in prose or carries a footnote into §9 Sources.

### 2.3 Content depth
We name real mechanisms by their real names: `fsync`, `O_DSYNC`, page cache, log sequence number, redo. We forward-reference Chapter 03 (BEGIN/COMMIT/ROLLBACK and isolation), Chapter 07 (locking), and Chapter 09 (group commit and tail latency). We do not invent vocabulary.

---

## 3. Chapter 02 Spine

The chapter is structured as a **guided act of construction**. Each section is the reader's next attempt at fixing the problem, each attempt fails in an instructive way, and the failure motivates the next mechanism. We end with a working WAL.

| # | Section ID | Form | What it does |
|---|---|---|---|
| 0 | premise | prose | We left `users.json` in pieces. Let's fix it — and watch the fix break too. |
| 1 | rename | prose + Python sandbox | The tmp + `os.rename` trick. Atomic publish for a single file. |
| 2 | multi-row-tear | prose + `MultiRowTearScene` + Python sandbox | Extend to a transfer between `a.json` and `b.json`. Two atomic renames, no atomicity across them. |
| 3 | log | prose + `WALScene` (hero) + Python sandbox | Introduce the write-ahead log. Animate append → fsync → apply → ack. |
| 4 | commit-record | prose + `CommitRecordToggle` | What does "committed" mean? Three-way toggle on fsync placement. |
| 5 | recovery | prose + `RecoveryStepThrough` (reuses existing `StepThrough`) | Reboot. Replay log. Redo committed, drop torn. |
| 6 | contract | prose + `TransactionSynthesis` figure | Map ACID onto the mechanism we just built. |
| 7 | sandbox | Python sandbox + collapsible local `wal.py` | ~80-line WAL with commit record + redo. Measure real fsync cost locally. |
| 8 | whats-next | prose | Tease Chapter 03: BEGIN/COMMIT/ROLLBACK and two transactions in the same room. |
| 9 | sources | bibliography | Curated reading list with one-line "why bother" notes. |

---

### Scene 0 — The Premise *(prose)*
Open with: *"We left `users.json` in pieces. Let's clean up the mess — and then we'll watch the cleanup break too."* Reset the stakes from Chapter 01 in two paragraphs. Remind the reader what ACID promised, point out that Chapter 01 named the failures but did not fix any of them, and commit to the shape of this chapter: we will write the fix, in Python, in the browser, with you.

**Reveals:** the reader's role. They are building this, not reading about it.

---

### Scene 1 — The Rename *(prose + Python sandbox)*
The reader's first attempt: write to `users.json.tmp`, then `os.rename` it over `users.json`. Atomic publish for a single file.

**Sandbox:** ~20 lines of Python. Writes a new user record into a tmp file, optionally calls `f.flush()` + `os.fsync(f.fileno())`, then renames. A "crash mid-write" button kills the writer process between the write and the rename. The reader runs it, sees the file is always either the old version or the new one. They flip the rename off and watch a crash leave a half-written `users.json`.

**Prose unpacks:** what POSIX `rename(2)` actually promises (atomic replacement within a filesystem), what it does *not* promise (durability of the rename without an `fsync` on the parent directory — footnote to LWN's "Ensuring data reaches disk"), why this trick is the entire reason `~/.config/*/Settings` files survive your laptop dying. Forward-reference to Chapter 09 on group commit, where the same `fsync` cost will hurt much more.

**Reveals:** atomicity is achievable for a single file with a single OS call. The reader has bought one real guarantee.

---

### Scene 2 — The Multi-Row Tear *(prose + `MultiRowTearScene` + Python sandbox)*
The reader's second attempt: a money transfer. `a.json` holds Alice's balance. `b.json` holds Bob's. Transfer $50.

**Scene:** Two account boxes side by side on desktop, stacked on mobile. A timeline shows the four operations: write `a.json.tmp`, rename `a.json.tmp → a.json`, write `b.json.tmp`, rename `b.json.tmp → b.json`. A crash slider lets the reader pick where the machine dies. Crash between the two renames: Alice is poorer, Bob is no richer, the universe is missing $50. The scene prints the before-and-after totals in red when they disagree.

**Sandbox:** Extends the §1 code. Same `atomic_write_json` helper, called twice. The reader can run the transfer with crash injection at any of the four points. Three of the four crash positions are fine. One is catastrophic.

**Prose unpacks:** why per-file atomicity does not compose. Each `rename` is atomic; the *sequence* is not. Name the problem: we need atomicity across multiple writes. Reject naive fixes the reader is probably already drafting in their head — "what if I put both balances in one file?" works until you have a million rows. Forward-reference to Chapter 04 on pages: real databases pack many rows per file because IO is page-granular, and you cannot rewrite the whole file on every transfer.

**Reveals:** atomicity at the level of one filesystem operation is not the same as atomicity at the level of one logical operation. We need a new mechanism.

---

### Scene 3 — The Log *(prose + `WALScene` (HERO) + Python sandbox)*
The chapter's hero scene. The reader builds a write-ahead log.

**Scene:** A timeline of the four-step commit, animated. On desktop, four horizontal stages with arrows: **append** the intent to a log file, **fsync** the log, **apply** the change to the data files, **ack** the user. On mobile, the same four stages stack vertically with a connector rail down the left, in the chapter's cream figure palette. A crash slider drags along the timeline. Wherever the reader drops the crash, the scene shows the post-crash state of the log and the data files and labels each outcome: *log empty: nothing happened, nothing to recover. log appended but not fsynced: the OS may have lost it, treat as not-committed. log fsynced, apply incomplete: this is what recovery is for. apply done, ack lost: the user thinks it failed, but the database knows it succeeded.*

**Sandbox:** ~50 lines. A `Log` class with `append(record)` and `fsync()`. A `Database` class with `transfer(from, to, amount)` that writes a record like `{"op": "transfer", "from": "a", "to": "b", "amt": 50}` to the log, fsyncs, then applies the change to `a.json` and `b.json` via the §1 atomic-write helper. The reader can run a transfer, then crash before fsync, between fsync and apply, between apply and apply, after apply. Each run prints the log contents and the account totals.

**Prose unpacks:** why this is called *write-ahead* — the log entry exists on disk *before* the data file changes, so the data file is always reconstructible. Define **durability** in operational terms: a record is durable once `fsync` returns successfully on the log file, not before. Name the layered write path again (app → page cache → device cache → media) and remind the reader of the Postgres fsync-handling incident referenced in Chapter 01. Forward-reference Chapter 09 (group commit) and Chapter 12 (replication, where the log itself becomes the wire format).

**Reveals:** durability is purchased by one specific `fsync` on one specific file. Everything else is bookkeeping.

---

### Scene 4 — The Commit Record *(prose + `CommitRecordToggle`)*
The reader has a log. But what marks a transaction as actually committed? You can't trust the presence of an "apply" — that happens after the fact. You need a marker *in the log itself* that says: everything before this is real.

**Scene:** A three-way radio: **fsync before commit record**, **fsync after commit record**, **never fsync**. A small results table updates live: `safe?`, `corrupt on crash?`, `fast?`. The "before" choice is safe but slower; "after" is faster but loses committed transactions on crash; "never" is the fastest and the most broken. The figure caption notes: this is the choice every real database makes, and most of them let you tune it (Postgres `synchronous_commit`, MySQL `innodb_flush_log_at_trx_commit`, SQLite `PRAGMA synchronous`).

**Prose unpacks:** what a commit record is — a single short log entry, written last, that promotes everything before it from "intended" to "committed." Why it goes *in* the log and not in a separate file (atomicity: one `fsync`, one decision point). The reader has now met the answer to *atomicity*: it's not a property of the disk, it's a property of where the commit record falls in the log.

**Reveals:** "committed" is not a state of the data files. It is the presence of a specific record, fsynced, in the log.

---

### Scene 5 — Recovery *(prose + `RecoveryStepThrough` using existing `StepThrough`)*
Reboot the machine. What does the database do first?

**Scene:** Reuses the `StepThrough` primitive from Chapter 01. Five discrete steps: open the log, scan forward, find the last commit record, redo every operation up to that point, ignore everything after. At each step the right pane shows the log contents with the cursor position, and the left pane shows the data files as recovery progresses. The reader steps through, prev/next, and watches the half-written transfer from Scene 2 finish itself on replay.

**Prose unpacks:** the redo loop in plain words. We do not introduce undo, LSNs, dirty page tables, or checkpoint records — those are Chapter 10. We do mention by name that this is a stripped-down ancestor of ARIES (footnote: Mohan et al. 1992). Note the property that makes redo safe: operations in the log are idempotent in their effect, because the log records the intended new state, not a delta. Forward-reference to Chapter 10 where checkpoints turn the unbounded log scan into a bounded one.

**Reveals:** recovery is not magic. It is one pass over a file.

---

### Scene 6 — The Contract *(prose + `TransactionSynthesis` figure)*
A static synthesis figure, in the chapter's cream figure palette: four small panels, one per ACID letter, each pointing at the specific mechanism in the WAL we just built.

- **Atomicity** → the commit record. Either it's in the log and fsynced, or the transaction never happened.
- **Durability** → the `fsync` on the log file before we acknowledge the user.
- **Consistency** → the invariant held end-to-end because either both `a.json` and `b.json` updates are replayed or neither is.
- **Isolation** → labeled "Chapter 03." The synthesis figure draws an arrow off-page.

**Prose unpacks:** ACID is not four properties of a database. It's four properties of *a transaction*, and a transaction is the unit the WAL was designed to protect. Re-read the opening of Chapter 01's contract scene with new eyes. The reader has now built the machinery the contract was describing.

**Reveals:** the chapter title. The transaction is the smallest unit of work the WAL knows how to commit, abort, or replay.

---

### Scene 7 — Do It Yourself *(Python sandbox + collapsible local `wal.py`)*
A larger sandbox, ~80 lines: the §3 WAL plus an explicit commit-record write and a `recover()` function that the reader can call after a simulated crash. The reader runs three transfers, crashes after the second commit record, calls `recover()`, and watches the data files come back consistent.

Below the sandbox, a collapsible disclosure labeled *Run this locally for real fsync numbers* — same pattern as Chapter 01's `race.py` disclosure. Inside: a self-contained `wal.py` the reader can save and run with `python3 wal.py --bench`. The script does 10,000 transfers with fsync and 10,000 without, and prints the per-commit cost in microseconds. The prose around the disclosure explains that the numbers depend on whether the device honors fsync, whether the filesystem has barriers, and whether the kernel batches — forward-reference to Chapter 09.

**Reveals:** how cheap or expensive durability actually is on the reader's own hardware. The number is usually surprising in both directions.

---

### Scene 8 — What's Next *(prose)*
Tease Chapter 03 in one short section.

> Now we have a log and a commit record. Time to put two of them in the same room.

Two transactions, same database, overlapping. We have not said one word about who sees what, when. The reader has built the durability and atomicity machinery; the isolation question is exactly the question Chapter 01's race scene asked and Chapter 02 deliberately did not answer. The one-liner punchline: the words `BEGIN`, `COMMIT`, and `ROLLBACK` have been the thing we were building toward all along, and Chapter 03 is where the reader finally gets to type them.

---

### Scene 9 — Sources *(bibliography)*
Curated, annotated. Each entry one to two sentences on why it's worth the reader's time.

- **Mohan et al., 1992 — "ARIES: A Transaction Recovery Method Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead Logging."** The canonical recovery paper. Dense. Read §1–§3 first, then come back to the rest after Chapter 10.
- **Jim Gray, 1978 — "Notes on Data Base Operating Systems."** Predates ARIES; first place transactions and recovery are described as one coherent problem. Still the clearest exposition of *why* a log.
- **PostgreSQL WAL documentation** (`postgresql.org/docs/current/wal-intro.html`). Production-grade description of every concept in this chapter, with the names Postgres actually uses. Read after the chapter to map our vocabulary onto a real system.
- **SQLite WAL mode** (`sqlite.org/wal.html`). The shortest readable description of a real WAL in shipping software. Worth reading end to end.
- **Hellerstein, Stonebraker, Hamilton, 2007 — "Architecture of a Database System," Chapter 7.** The textbook view: where the WAL sits relative to the buffer pool, the lock manager, and the access methods. Useful for the next several chapters.
- **Kleppmann, *Designing Data-Intensive Applications*, Chapter 7.** The same material at a level one notch above this book, with the operational consequences (replication lag, failover) brought forward. Strongly recommended companion reading.
- **Helland & Campbell, 2009 — "Building on Quicksand."** Bonus reading on the *limits* of recovery: what happens when the failure model assumed by the WAL is wrong. Short, opinionated, important.

---

## 4. Technical Architecture

All of Chapter 01's infrastructure carries over unchanged: content collection, `[slug].astro` route, scene primitive library, design tokens, dark-figure palette, marginalia, footnote interception. This chapter adds only new content and five new scene components.

### 4.1 File layout
- MDX: `src/content/chapters/02-the-transaction.mdx`.
- Scene components: `src/components/chapter-02/*.tsx`.
- Frontmatter: `chapterNumber: 2`, `status: 'draft'` until ship.

### 4.2 New scene components

| Component | Where used | What it does | Mobile reflow notes |
|---|---|---|---|
| `RenameScene` | §1 | Animates write-to-tmp + `os.rename` as two-step publish, with a crash-injection button between the steps. | Single column at <720px. Crash button moves below the file boxes. |
| `MultiRowTearScene` | §2 | Two account boxes (`a.json`, `b.json`), sequential renames as a four-step timeline, crash slider. | Account boxes stack vertically at <720px. Timeline becomes a left-side vertical rail. |
| `WALScene` (hero) | §3 | Animated 4-step commit (append → fsync → apply → ack) with a crash slider that snaps to each step. | At <720px the four stages stack vertically with a single connector rail on the left, dots highlighted as the slider advances. |
| `CommitRecordToggle` | §4 | Three-way radio (fsync before / fsync after / never) and a live outcome table with `safe?`, `corrupt?`, `fast?` columns. | Radio becomes full-width stacked at <520px; outcome table scrolls horizontally rather than reflowing — three rows is small enough. |
| `TransactionSynthesis` | §6 | Static figure: four small panels, each mapping an ACID letter onto the WAL mechanism it's implemented by. Isolation panel is grayed and labeled "Chapter 03." | 2×2 grid on desktop, single column on mobile. No animation. |

Recovery (§5) uses the existing `<StepThrough>` primitive from `src/components/scene/`. No new component.

### 4.3 Reused primitives
- `<Figure>` for the chrome of every scene.
- `<StepThrough>` for §5 recovery.
- `<Slider>` for the crash sliders in §2 and §3.
- `<Toggle>` is not used in this chapter; the §4 three-way control is a small bespoke radio that lives inside `CommitRecordToggle`.
- `<Callout>` used for the Postgres fsync incident sidebar in §3 and the device-honesty sidebar in §7.
- `<Footnote>` for every citation that points into §9.

### 4.4 Sandboxes (Pyodide)
Reuse the existing `PythonSandbox` component at `/Users/arun/databases-course/src/components/PythonSandbox.tsx`. One sandbox per §1, §2, §3, §7. Each sandbox seeds the prior section's code as a starting point, so the reader's mental model accumulates rather than restarts.

`PythonSandbox` already `chdir`s Pyodide to `/` so that seeded files at the filesystem root resolve correctly — this was the gotcha from Chapter 01 and the fix is already in place.

§7 includes a collapsible local-Python disclosure with a self-contained `wal.py`. Same disclosure pattern as Chapter 01's `race.py`.

### 4.5 MDX layout
Identical to Chapter 01:
- Eyebrow ("Chapter 2") + serif title + summary at the top.
- MDX body with scenes interleaved.
- Sources rendered as the last section.
- Within-chapter navigation is handled by `ChapterReader` (sticky progress bar, sidebar TOC on desktop, drawer on mobile). No separate prev/next-chapter footer is added in this chapter.

### 4.6 Out of scope (deferred to later chapters)
- Group commit, fsync amortization, log buffer flushing strategy. **Chapter 09.**
- MVCC, snapshot isolation, read consistency under concurrent writers. **Chapter 08.**
- ARIES depth: LSNs, dirty page tables, undo records, checkpoint records, fuzzy checkpointing. **Chapter 10.**
- SQL syntax: `BEGIN`, `COMMIT`, `ROLLBACK`, savepoints. **Chapter 03** (we only tease them in §8).
- Replication and using the log as a wire format. **Chapter 12.**

---

## 5. Implementation Notes (gotchas from Chapter 01)

These bit us during Chapter 01 implementation. They are now load-bearing for Chapter 02.

- **Astro slot mechanism.** `ChapterReader` must be the Astro version, not React. A React component mounted with a `client:` directive collapses its MDX children into an `<astro-slot>` placeholder and silently breaks all the prose. Every new Chapter 02 scene follows the existing `chapter-01/*.tsx` pattern: React island, hydrated with `client:visible`, mounted inside an Astro-rendered prose flow.
- **Pyodide working directory.** `PythonSandbox.tsx` already `chdir`s Pyodide to `/` so that seeded files written at the root are found by user code. Do not regress this; the §2 and §3 sandboxes depend on it because they seed `a.json` and `b.json` at root.
- **Mobile breakpoint is non-negotiable.** Every scene component must work at a 390px viewport. Audit at the time the scene is built, not after the chapter is laid out. The `WALScene` is the highest risk here — its four horizontal stages must reflow into a vertical rail.
- **Cream figure palette is the only palette.** All figures use the existing `--color-fig-bg` and `fig-*` classes. Do not introduce a dark surface, a new accent color, or a new typography stack — Chapter 01 rejected the dark palette mid-build and flipped everything to cream, and Chapter 02 inherits that choice.
- **Footnotes auto-jump to Sources.** `ChapterReader` intercepts footnote anchor clicks in MDX and scrolls to the matching entry in the Sources section. Use the existing `<Footnote n>` primitive; do not roll your own anchor mechanism.
- **No prose attribution in commits.** The user's standing rule.

---

## 6. Acceptance for Chapter 02

The chapter is done when:
- A reader who didn't know what a transaction was can explain (a) why `os.rename` alone isn't enough across multiple files, (b) what the commit record is and why fsync placement decides whether the transaction was real, (c) what recovery does mechanically when the machine reboots.
- Every section quiz is pedagogically meaningful — it asks the reader to *use* the model the section just built, not to recall trivia.
- Every scene works at 390px width.
- All four Python sandboxes run end-to-end in Pyodide without throwing.
- `vitest` and `tsc --noEmit` pass clean.
- A walkthrough on a phone and a walkthrough on desktop both feel like a chapter of the same book as Chapter 01.

---

## 7. Open Calls (decisions made)

| Decision | Choice | Rationale |
|---|---|---|
| WAL depth | Stop at commit record + redo recovery. No undo, no LSNs, no checkpoints. | Chapter 10 is the place for ARIES depth. Going deeper here drowns the core idea. |
| Group commit | Out of scope. | Chapter 09. Mentioning it twice as a forward-reference is enough. |
| MVCC / isolation | Out of scope. Tease at end of §6 and §8. | Chapter 03 is the payoff. Spoiling it here would dilute the cliffhanger. |
| SQL syntax | One sentence in §8 only. | Chapter 03 starts at `BEGIN`. Naming it earlier confuses the construction story. |
| Sandbox language | Python via Pyodide. | Reuses the Chapter 01 primitive. Real `os.rename`, real `fsync` (via the Emscripten FS shim), no JavaScript hand-waving. |
| Hero scene | `WALScene` (§3). | The chapter's title scene. The WAL is the one mental model the reader has to leave with. |
| New components | Five, listed in §4.2. | One per non-reused scene. Recovery reuses `StepThrough`. |

---

## 8. Implementation Sequence (preview)

The implementation plan will be written separately. Rough order:

1. Scaffold `src/content/chapters/02-the-transaction.mdx` with frontmatter and section headings.
2. Build `RenameScene` and wire up the §1 sandbox. Verify at 390px.
3. Build `MultiRowTearScene` and the §2 sandbox. Verify at 390px.
4. Build `WALScene` (the hero) and the §3 sandbox. Verify the vertical reflow on mobile before writing prose around it.
5. Build `CommitRecordToggle` and the §4 outcome table.
6. Wire `StepThrough` into §5 recovery.
7. Build the `TransactionSynthesis` synthesis figure for §6.
8. Build the §7 sandbox and the collapsible local `wal.py` disclosure.
9. Write the prose, scene by scene, in order, target 5500–6000 words.
10. Curate the §9 Sources entries with one-line "why bother" notes.
11. QA: phone + desktop walkthrough, `vitest`, `tsc --noEmit`, Lighthouse accessibility pass.

---

## 9. Out of scope (for this spec)

- Chapter 03 prose and components.
- Any change to Chapter 01.
- Any change to the global reading shell, layout tokens, or typography.
- Substack / Medium export. Deferred.
