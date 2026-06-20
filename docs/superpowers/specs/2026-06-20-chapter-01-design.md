# Chapter 01 — Design Spec

**Status:** Draft for review
**Date:** 2026-06-20
**Scope:** Redesign the reading experience and author Chapter 01 — "Why Databases Are Special" — as the template for the rest of the book.

---

## 1. Goal

Transform a Tailwind-dark static site into a deep, narrative, O'Reilly-grade reading experience where animated explanations and interactive widgets are embedded inline within long-form prose. Chapter 01 establishes the pattern; subsequent chapters reuse the primitives.

### Success criteria
- A reader landing on Chapter 01 understands ACID viscerally, not as a definition list, by the time they finish.
- Each scene's animation/widget earns its place: removing it would damage the reader's intuition.
- The page reads like a book — cream paper, generous serif typography, comfortable column width — not a webapp.
- Authoring a new chapter is "create an MDX file and import scene components." No hand-rolled HTML.

---

## 2. Reading Experience

### 2.1 Visual style
**O'Reilly print-book reading shell, with 3Blue1Brown-style breakout figures for animated scenes.**

- **Page background:** cream / warm off-white (`#faf7f0`).
- **Body text:** serif (Charter / Iowan Old Style / Source Serif Pro stack), 18–19px, line-height 1.7, warm near-black ink (`#1c1917`).
- **Headings:** sans-serif (Inter Tight / Inter), tight tracking, deliberate hierarchy.
- **Code:** JetBrains Mono on a light-gray inline background; block code on a soft tinted card with copy button.
- **Sidebars:** O'Reilly-style `Note`, `Tip`, `Warning` callouts with iconographic left rail, sitting inline within the prose flow.
- **Figures:** dark-themed cards that visually break the cream page — near-black background (`#0e1116`), bright primary palette (blue `#5b9dff`, orange `#ffae5b`, green `#7ad99a`, red `#ff7a7a`). They announce "watch this happen."
- **Reading width:** ~660px main text column. Figures may break out to ~880px. Page max ~1080px with a thin marginalia gutter for footnotes and definition popovers.
- **Chapter chrome:** a small chapter number ("Chapter 1") above the title, sans-serif, letter-spaced, amber accent (`#b45309`). Title set large in serif.

### 2.2 Writing voice
**Narrative, second-person, tension-first.** Definitions earn their keep by being demanded by a story, not by being declared up front.

Sample register (approved 2026-06-20):

> Open your editor and create a file called `users.json`. Drop in two users. Save. Congratulations — you've made a database.
>
> Not really. But it's worth taking that joke seriously for a moment, because the difference between a JSON file and an actual database is not as obvious as it sounds. Both store data. Both let you read it back. Both, in some sense, *work*. If we're going to spend the rest of this book on pages and B-trees and write-ahead logs, we should be honest about what we're paying for.
>
> So let's not start with definitions. Let's start by trying to use a file as a database, and seeing where it breaks.

All chapters use this voice.

### 2.3 Content depth
O'Reilly standard: ~5000+ words per chapter, with real code, real OS / database mechanisms, real numbers, references to real papers. Every claim either gets unpacked or footnoted.

---

## 3. Chapter 01 Spine

The chapter is structured as a **guided tour of failure**. Each failure mode motivates one letter of ACID; ACID is revealed as the answer to a question the reader has already been forced to ask.

### Scene 0 — The Premise *(prose)*
Set up the `users.json` joke. Refuse to define "database." Promise that we'll work it out by trying.

### Scene 1 — The Race *(prose + animation + interactive)*
Two processes both want to add a user. Read–modify–write on the file. Animate the interleaving: P1 reads → P2 reads → P1 writes → P2 writes. P1's user vanishes. Reader can drag a scrubber to reorder events.
**Reveals: Isolation.** No transaction boundary means no story about who saw what.
**Prose unpacks:** what the OS is and isn't doing, why two-process file locking (`flock`) is awkward, what "lost update" means, how databases use locking and MVCC to prevent it (forward-reference to ch. 7–8).

### Scene 2 — The Tear *(prose + animation)*
One process writing a 4KB blob. Animate the bytes streaming to disk. Pull the plug at byte 1700. Show the half-written record.
**Reveals: Atomicity.** "A write" is many smaller writes; the OS can't undo halfway through.
**Prose unpacks:** the page-level granularity of disks (forward-reference to ch. 3), torn-page protection, why journaling filesystems aren't enough for application-level atomicity, what WAL buys (forward-reference to ch. 9).

### Scene 3 — The Invariant *(prose + animation + interactive)*
Two accounts, transfer $50. Animate `A -= 50` (success), crash, `B += 50` never happens. Total money decreased. Reader chooses where to inject the crash.
**Reveals: Consistency.** Atomicity is the tool; consistency is the property it protects.
**Prose unpacks:** the difference between "C in ACID" and "C in CAP" (a known source of confusion worth fixing here), constraints, triggers, the application's role in defining invariants.

### Scene 4 — The Lie *(prose + animation + interactive)*
App calls `write()` and prints "saved!". OS holds the bytes in page cache. Power cut. Reboot. File still says old data. Reader toggles `fsync` on/off and replays.
**Reveals: Durability.** Acknowledged ≠ persisted unless someone pays fsync's price.
**Prose unpacks:** the layered write path (app → page cache → device cache → platter/cells), fsync semantics on Linux vs macOS, the Postgres fsync incident of 2018 (cited), group commit (forward-reference to ch. 9), the cost of durability in tail latency.

### Scene 5 — The Contract *(prose + synthesis animation)*
Replay the four failures as small thumbnails side by side. Overlay ACID letters as each animates. Punchline: *a database is the machine that buys back each of those guarantees, at a cost you can name.*
**Prose unpacks:** ACID is not jargon — it's a checklist for which failures a storage system promises to prevent. Introduces the cost ledger that the rest of the book fills in.

### Scene 6 — Do It Yourself *(SqlSandbox)*
Same transfer scenario, run by the reader in browser-side SQLite. First without `BEGIN`/`COMMIT` (see the broken intermediate state), then with it. Verifies the intuition by hand.

### Closing — What's Next *(prose)*
Trail to ch. 02 (relational model) by noting that ACID describes what a database guarantees, not how it's organized. The next chapter starts at the schema layer; the chapters after that go down to the storage engine.

### Word budget
- Scenes 0–6 prose: ~5500–6500 words total.
- Each non-trivial claim is either fully unpacked in prose or has a footnote with a reference.

---

## 4. Technical Architecture

### 4.1 Authoring & routing
- Add `@astrojs/mdx`.
- Create `src/content.config.ts` defining a `chapters` content collection rooted at `src/content/chapters/`.
- Frontmatter schema (Zod): `title`, `chapterNumber`, `summary`, `readingTime?`, `status: 'draft' | 'published'`.
- Replace per-chapter `.astro` files in `src/pages/chapters/` with a single dynamic route `src/pages/chapters/[slug].astro` that loads the matching MDX entry and renders it inside `Layout.astro`.
- The chapters listing page (`src/pages/chapters/index.astro`) reads the collection instead of the hard-coded array. Status `draft` is hidden in production.
- Migrate chapter 01 from `.astro` to `src/content/chapters/01-why-databases-are-special.mdx`.

### 4.2 React islands
- Add `@astrojs/react` + `react` + `react-dom` + `framer-motion`.
- Scene components are React, hydrated `client:visible`.
- The existing `src/lib/sql-sandbox.ts` is wrapped in a thin React component `<SqlSandbox client:visible />` so it composes inside MDX. The vanilla mount logic stays — the wrapper just calls it in a `useEffect`.

### 4.3 Scene primitive library
Built once, used by every chapter. Location: `src/components/scene/`.

- `<Figure number caption breakout?>` — the dark-themed breakout container. Provides figure number, caption slot, and a control-rail slot at the bottom. Optional `breakout` prop widens it beyond the text column.
- `<StepThrough steps={Step[]} initial?>` — discrete-state controller. Renders the active step's content and exposes prev/next/scrub controls. Used for Race, Tear, Invariant.
- `<Toggle label value onChange>` — labeled boolean control (used for fsync on/off in Scene 4).
- `<Slider label min max step value onChange>` — numeric scrubber.
- `<Callout type='note'|'tip'|'warning'|'danger'>` — O'Reilly-style sidebar box with iconic left rail.
- `<InlineDef term>` — small underlined inline term; hover/tap opens a definition popover.
- `<Footnote n>` — superscript number; the footnote text is collected and rendered at section end.

### 4.4 Chapter 01 scene components
Location: `src/components/chapter-01/`.

- `<RaceScene />` — uses `<StepThrough>` with steps representing the four-step interleaving. Includes a draggable scrubber that re-renders the file state at each step.
- `<TearScene />` — animated byte-stream-to-disk with a "pull the plug" button that freezes the timeline mid-write and reveals the partial bytes.
- `<InvariantScene />` — two-account transfer with a crash-injection control that lets the reader pick the crash point.
- `<LieScene />` — animated app → page cache → disk pipeline with an `fsync` toggle.
- `<ContractSynthesis />` — four thumbnail panels of Scenes 1–4 animating together, ACID letters fading in over each.

All five share `<Figure>` for the chrome.

### 4.5 Design tokens
Replace the `@theme` block in `src/styles/global.css`. New tokens:

```css
--page-bg: #faf7f0;     /* cream */
--page-fg: #1c1917;     /* warm near-black ink */
--ink-soft: #57534e;    /* secondary text */
--rule: #d6d3c4;        /* horizontal rules / borders */
--accent: #b45309;      /* warm amber for links, chapter chrome */
--accent-soft: #fef3c7;
--code-bg: #f1ede2;     /* inline code background */
--callout-note-bg: #eef4f8;
--callout-tip-bg: #effaf0;
--callout-warning-bg: #fdf6e3;
--callout-danger-bg: #fdecea;

/* Figure (dark) palette */
--fig-bg: #0e1116;
--fig-fg: #e6e6e6;
--fig-muted: #8a8f99;
--fig-blue: #5b9dff;
--fig-orange: #ffae5b;
--fig-green: #7ad99a;
--fig-red: #ff7a7a;

/* Typography */
--font-serif: 'Charter', 'Iowan Old Style', 'Source Serif Pro', Georgia, serif;
--font-sans: 'Inter Tight', 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Layout widths: `--text-w: 660px`, `--figure-w: 880px`, `--page-max: 1080px`.

### 4.6 Layout
- `Layout.astro` becomes cream-bg, serif-default.
- Header: light cream, slim, sans-serif nav, amber-accent active state.
- Footer: hairline rule, small muted text.
- Chapter page chrome (rendered by `[slug].astro`):
  - Top: "Chapter N" eyebrow + serif title + summary.
  - Body: MDX content rendered with chapter-specific components in scope.
  - Bottom: prev/next chapter links styled as turning pages.

### 4.7 Migration of existing chapter 01 file
- Delete `src/pages/chapters/01-why-databases-are-special.astro`.
- The new content lives in `src/content/chapters/01-why-databases-are-special.mdx`.

### 4.8 Out of scope (for this spec)
- Chapters 02–19. Listing index will mark them `draft` until they're written one-at-a-time per the user's pacing.
- Search, full-text indexing.
- Dark-mode toggle of the *reading* shell. Figures stay dark always; page stays cream always.
- Authentication, persistence of reader progress beyond `localStorage`.
- **Substack / Medium syndication.** The web app is the canonical artifact. A future companion job will export a prose-only Markdown version of each chapter (interactives replaced by linked screenshots) and post to Substack/Medium when a chapter ships. That export pipeline is its own spec, deferred until the first chapter is live.

---

## 5. Open Calls (decisions made)

| Decision | Choice | Rationale |
|---|---|---|
| Primitive library generality | Built generic from the start. | Cheap, and we know what's coming for chapters 2–19. Refactoring later costs more than over-building now. |
| Bundle cost | React + framer-motion accepted. | Islands hydrate on demand; non-interactive chapters pay ~0. |
| Reading width | 660px main, 880px breakout. | ~60–65 chars at 18px serif — comfortable for long reading. |
| Authoring format | MDX content collection. | Prose-friendly, interleaves React components, type-safe frontmatter. |
| Animation framework | framer-motion. | Best React-native animation API; declarative timeline support fits scene work. |
| Routing | Dynamic `[slug].astro` reading the collection. | One layout to evolve; chapter files are pure content. |

---

## 6. Implementation Sequence (preview)

The implementation plan will be written separately by the `writing-plans` skill. The rough order I expect:

1. Install `@astrojs/react`, `@astrojs/mdx`, `react`, `react-dom`, `framer-motion`. Wire up in `astro.config.mjs`.
2. Replace the `@theme` block + base typography in `global.css`. Add font loading.
3. Rewrite `Layout.astro` for cream/serif shell.
4. Build the scene primitive library (`Figure`, `StepThrough`, `Toggle`, `Slider`, `Callout`, `InlineDef`, `Footnote`).
5. Create the content collection (`content.config.ts`, `src/content/chapters/`), build `[slug].astro`, port the chapters index page.
6. Wrap `SqlSandbox` for React.
7. Build the five chapter-01 scene components.
8. Write the chapter 01 MDX prose (5500+ words) interleaving the scenes.
9. QA: dev-server walkthrough of chapter 01 end to end.

---

## 7. Acceptance for Chapter 01

The chapter is done when:
- A reader who didn't know what ACID meant before reading can explain each letter as the answer to one specific failure mode.
- Each animation can be interacted with from a keyboard.
- The page hits Lighthouse "good" on accessibility and CLS.
- Reading the chapter on a phone is still good — figures responsive, text column doesn't get too narrow.

---

## Completion

Chapter 01 shipped on 2026-06-20. Acceptance criteria from §7 verified via Task 21 QA pass.
