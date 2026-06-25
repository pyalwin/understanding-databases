<div align="center">

# Understanding Databases

**An interactive deep-dive into how databases actually work.**
O'Reilly-deep. Narrated like a story. Illustrated with 3Blue1Brown-style
animations and live in-browser code sandboxes.

[![License: MIT](https://img.shields.io/badge/License-MIT-2f6b3a.svg?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/chapters-01%E2%80%9313%20drafted%20%C2%B7%2001%E2%80%9303%20published-1e4fa5.svg?style=flat-square)](#chapters)
[![Made with Astro](https://img.shields.io/badge/Astro-6-BC52EE.svg?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![React 19](https://img.shields.io/badge/React-19-149ECA.svg?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-38BDF8.svg?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Pyodide](https://img.shields.io/badge/Pyodide-0.27-FFD43B.svg?style=flat-square&logo=python&logoColor=black)](https://pyodide.org)
[![sql.js](https://img.shields.io/badge/sql.js-SQLite%20in%20browser-003B57.svg?style=flat-square&logo=sqlite&logoColor=white)](https://sql.js.org)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18.svg?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev)

[**Read Chapter 01 →**](#chapters) &nbsp;·&nbsp; [Run locally](#quickstart) &nbsp;·&nbsp; [Write a chapter](#authoring-a-new-chapter)

</div>

---

## Why this exists

Most database resources fall into one of two buckets: either a textbook that
front-loads the formalism, or a tutorial that walks you through `CREATE TABLE`
and stops. This project is for the middle: an engineer who wants to *understand*
why databases are built the way they are, told as a story, with every claim
backed by an experiment you can run in the page.

You don't just read each chapter — you move through it.

- Every chapter is broken into **checkpoints**, each gated by a quick quiz.
- Code examples run **in the browser**: Python via Pyodide, SQL via sql.js.
- Progress is persisted to `localStorage`, so you can pick up where you left off.
- Interactive scenes let you **break things on purpose** — stage a race condition,
  pick a crash point, watch an invariant shatter — and then watch the fix work.

---

## Quickstart

```sh
git clone https://github.com/pyalwin/understanding-databases.git
cd understanding-databases
npm install
npm run dev
```

Open <http://localhost:4321> and start with Chapter 01.

> **Requires Node ≥ 22.12** (see `engines` in `package.json`).

| Command              | What it does                          |
|----------------------|---------------------------------------|
| `npm run dev`        | Dev server at `localhost:4321`        |
| `npm run build`      | Production build to `./dist/`         |
| `npm run preview`    | Preview the production build          |
| `npm test`           | Run the Vitest suite once             |
| `npm run test:watch` | Watch-mode Vitest                     |

---

## Chapters

| # | Title | Status | Highlights |
|---|-------|--------|------------|
| 01 | **Why Databases Are Special** | ![Published](https://img.shields.io/badge/published-2f6b3a.svg?style=flat-square) | Races, torn writes, broken invariants, lying disks — by abusing a JSON file until it breaks. Five scenes + Python sandboxes. |
| 02 | **The Transaction** | ![Published](https://img.shields.io/badge/published-2f6b3a.svg?style=flat-square) | Build a write-ahead log, the commit record, and crash recovery by hand in Python. |
| 03 | **Isolation Levels** | ![Published](https://img.shields.io/badge/published-2f6b3a.svg?style=flat-square) | The ANSI anomalies + write skew, each staged in real SQLite. Ends on SSI. |
| 04 | **Where Data Actually Lives** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Pages, heaps, and B-trees from first principles — then the same machinery inside SQLite. |
| 05 | **The Buffer Pool** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Frames, the page table, pinning, the dirty bit, and eviction — LRU, the scan that wrecks it, clock, LRU-K. |
| 06 | **Query Execution** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Compile SQL into an operator tree; the Volcano model; nested-loop, hash, and sort-merge joins. |
| 07 | **The Query Optimizer** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Cost model, cardinality estimation, index-vs-scan crossover, and the join-order search. |
| 08 | **Locking & Concurrency** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Shared/exclusive locks, two-phase locking, the lock manager, and deadlock via wait-for graphs. |
| 09 | **MVCC & Snapshot Isolation** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Row versions (xmin/xmax), snapshots, first-committer-wins, write skew, and vacuum. |
| 10 | **Group Commit & Log-Structured Storage** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Group commit, then a working LSM-tree — memtable, SSTables, compaction, and amplification. |
| 11 | **Recovery & ARIES** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | WAL with LSN chains, fuzzy checkpoints, the three passes (Analysis/Redo/Undo), and CLRs. |
| 12 | **Distributed Transactions & Two-Phase Commit** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | 2PC as a recovery protocol, the blocking problem, 3PC, and the road to consensus. |
| 13 | **Replication** | ![Draft](https://img.shields.io/badge/draft-a16207.svg?style=flat-square) | Log shipping as replication; synchronous vs asynchronous; lag, failover, the lost tail, and quorum. |

Each chapter ends with a curated *Sources & further reading* section linking
back to the primary literature — Gray, Mohan, Stonebraker, Kleppmann, and
the engineering postmortems that put the textbooks to the test.

---

## Tech stack

<table>
<tr>
  <td><strong>Framework</strong></td>
  <td>
    <a href="https://astro.build">Astro 6</a> with the Cloudflare adapter ·
    MDX content collections ·
    <a href="https://react.dev">React 19</a> islands hydrated with <code>client:visible</code> / <code>client:only</code>
  </td>
</tr>
<tr>
  <td><strong>Design</strong></td>
  <td>
    <a href="https://tailwindcss.com">Tailwind v4</a> ·
    custom cream-and-serif "book" tokens ·
    <a href="https://www.framer.com/motion/">Framer Motion</a> for scene transitions
  </td>
</tr>
<tr>
  <td><strong>Sandboxes</strong></td>
  <td>
    <a href="https://pyodide.org">Pyodide</a> (CPython in WASM) ·
    <a href="https://sql.js.org">sql.js</a> (SQLite in WASM)
  </td>
</tr>
<tr>
  <td><strong>Testing</strong></td>
  <td>
    <a href="https://vitest.dev">Vitest</a> ·
    <a href="https://testing-library.com/docs/react-testing-library/intro/">React Testing Library</a> ·
    <a href="https://github.com/jsdom/jsdom">jsdom</a>
  </td>
</tr>
<tr>
  <td><strong>Deploy</strong></td>
  <td><a href="https://workers.cloudflare.com">Cloudflare Workers</a></td>
</tr>
</table>

---

## Project layout

```
src/
├── components/
│   ├── chapter-NN/         interactive scenes, one dir per chapter (01–13)
│   ├── scene/              shared primitives:
│   │   ├── ChapterReader.astro   progressive-reveal reader
│   │   ├── Section.astro         checkpoint wrapper
│   │   ├── Figure.tsx            cream-surface scene container
│   │   ├── StepThrough.tsx       step-by-step animator
│   │   ├── Slider.tsx · Toggle.tsx · Callout.tsx · Footnote.tsx
│   │   └── …
│   ├── PythonSandbox.tsx   Pyodide REPL with seeded files + reset
│   └── SqlSandboxReact.tsx sql.js REPL
├── content/chapters/       MDX source for each chapter
├── pages/                  Astro routes
├── styles/global.css       design tokens + reader CSS
└── lib/                    sql-sandbox runtime
```

---

## Authoring a new chapter

1. **Create the MDX file** at `src/content/chapters/NN-slug.mdx`. Frontmatter
   schema lives in `src/content.config.ts`:
   ```yaml
   ---
   title: The Transaction
   chapterNumber: 2
   summary: ACID mechanically — write-ahead logs and crash recovery.
   status: draft
   ---
   ```
2. **Wrap the body** in `<ChapterReader chapterId="NN-slug">` and split it into
   `<Section id="…" title="…" quiz={…}>` blocks. The reader handles progressive
   reveal, the sidebar TOC, the quiz modal, and `localStorage` persistence —
   you just write the content.
3. **Drop interactive scenes inline.** React islands need a `client:` directive;
   `client:visible` is the usual choice. Sandboxes that touch the filesystem
   (Pyodide) work best with `client:only="react"`.
4. **End with a *Sources* section** pointing readers at the primary literature.

---

## Contributing

This is a personal project, but issues and PRs are welcome — especially:

- typos, factual mistakes, or muddled explanations in published chapters
- broken sandboxes or interactive scenes
- suggestions for sources we should be citing but aren't

Please open an issue before starting on a new chapter or a large scene rewrite,
so we don't duplicate work.

---

## License

[MIT](./LICENSE) — free to read, run, fork, remix, and republish.

<div align="center">
<sub>Built with care. Read at your own pace.</sub>
</div>
