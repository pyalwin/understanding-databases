# Chapter Renumber Plan — inserting ch07 (Query Optimizer)

**Date:** 2026-06-22
**Why:** Query execution is being split into two chapters — **ch06 Query Execution** and **ch07 Query Optimizer**. Inserting a new ch07 bumps every later chapter in the book's established roadmap by one. The forward-references baked into ch01–ch05 must be updated to match.

## The map (this book's chapters only)
| Topic | Old # | New # |
|---|---|---|
| Query execution | (new) 6 | **6** |
| Query optimizer | (new) — | **7** |
| Locking & latching | 7 | **8** |
| MVCC / snapshot isolation / vacuum | 8 | **9** |
| Group commit / log-structured storage | 9 | **10** |
| Recovery / ARIES / checkpoints / dirty-page table | 10 | **11** |
| Replication | 12 | **13** |

Chapters 1–6 references (pages=ch04, buffer pool=ch05, query execution=ch06) **do not change.**

## CRITICAL: do not renumber cited-book chapters
Several "Chapter N" mentions refer to *other authors' books*, not this book. **Leave these exactly as-is:**
- **ch01:644** — "Kleppmann, *Designing Data-Intensive Applications*, Chapter 7 — *Transactions*." → Kleppmann's ch7. DO NOT TOUCH.
- **ch02:675** — "Hellerstein, Stonebraker, Hamilton, *Architecture of a Database System*, Chapter 7." → that book's ch7. DO NOT TOUCH.
- **ch02:678** — "Kleppmann … Chapter 7." → Kleppmann's ch7. DO NOT TOUCH.
- **ch03:881** — "Gray & Reuter … Chapter 7 on locking, chapter 8 on isolation, chapter 9 on recovery." → Gray & Reuter's chapters. DO NOT TOUCH.
- **ch03:893** — verify in context; if it's a citation to a named book, DO NOT TOUCH; if it's "this book's Chapter 7 (locking)," bump to 8.
- Any other "Chapter N" inside a `<Footnote>`/Sources entry that names an author/book → it's a citation; leave it.

**Rule of thumb:** if the chapter number is attached to *this book's* narrative ("we'll build X in Chapter N", "Chapter N covers…", a forward-ref to our own content), renumber it. If it's attached to an author/title in a citation, leave it.

## Occurrences to renumber (this book's refs — verify each in context before editing)
From an audit on 2026-06-22 (line numbers may drift as edits land — re-grep):
- **ch01**: 245 (Ch7 locking→8), 278 (Ch8 MVCC→9), 280 (Ch7→8), 346 (Ch9 group-commit/log-structured→10), 488 (Ch9→10), 534 (Ch7→8), 536 (Ch8 MVCC→9), 538 (Ch9→10), 540 (Ch9 log-structured→10), 622 (roadmap "Chapters 7 and 8 … Chapter 9" → "Chapters 8 and 9 … Chapter 10"). **NOT 644 (Kleppmann).**
- **ch02**: 66 (ch09→10), 246 (ch09→10; and if a "Chapter 12 … replication" ref is present, →13), 248 (Ch10→11), 250 (ch10→11), 380 (ch10→11), 382 (ch10→11), 633 (Ch09→10), 663 (Mohan ARIES "after Chapter 10" — *this book's* ch10 → 11). **NOT 675/678 (Hellerstein, Kleppmann).**
- **ch03**: 294 (ch08 MVCC→9), 296 (ch08→9), 618 (ch07 locking→8), 851 (ch08→9). **NOT 881 (Gray & Reuter); verify 893.**
- **ch05**: 267 (Ch10 recovery→11).
- Re-grep for any "Chapter 12"/"chapter 12" (replication →13) and any "Chapter 11"/"chapter 13" stragglers across ch01–05.

## Also: update ch01's roadmap to name the split
ch01's roadmap paragraph (~line 620, already patched once) currently says "Chapter 6 covers query execution." Now that execution splits, update it to reflect **ch06 = query execution (how a plan runs)** and **ch07 = the query optimizer (how the plan is chosen)**, then "Chapters 8 and 9 … the I in ACID … Chapter 10 is the D and the A." Keep the edit surgical and in ch01's voice.

## Verification
- After edits: `npx astro check` → 0 errors; `npm run build` green (all existing routes).
- Grep again: no *this-book* forward-ref should still point at the old number; no cited-book number should have changed.
- Spot-check the four protected citations (ch01:644, ch02:675, ch02:678, ch03:881) are untouched.

## Out of scope
- No prose rewriting beyond the number changes and the one ch01 roadmap sentence about the 6/7 split.
- No changes to ch04 (it has no 7–13 forward-refs) beyond a re-grep confirptation that it's clean.
