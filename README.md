<div align="center">

# Understanding Databases

**An interactive deep-dive into how databases actually work.**
O'Reilly-deep. Narrated like a story. Illustrated with 3Blue1Brown-style
animations and live in-browser code sandboxes.

[![License: MIT](https://img.shields.io/badge/License-MIT-2f6b3a.svg?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-chapters%2001%E2%80%9302%20published-1e4fa5.svg?style=flat-square)](#chapters)
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

| # | Title                          | Status | Highlights |
|---|--------------------------------|--------|------------|
| 01 | **Why Databases Are Special**  | ![Published](https://img.shields.io/badge/published-2f6b3a.svg?style=flat-square) | Races, torn writes, broken invariants, lying disks. Five interactive scenes + Python sandboxes. |
| 02 | **The Transaction**            | ![Published](https://img.shields.io/badge/published-2f6b3a.svg?style=flat-square) | The write-ahead log, the commit record, recovery — built by hand in Python in the browser. |
| 03 | **Isolation Levels**           | ![Planned](https://img.shields.io/badge/planned-a16207.svg?style=flat-square) | Dirty reads through serializable, anomaly by anomaly. |
| 04 | **Where Data Actually Lives**  | ![Planned](https://img.shields.io/badge/planned-a16207.svg?style=flat-square) | Pages, heaps, B-trees, indexes from first principles. |

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
│   ├── chapter-01/         interactive scenes for chapter 01
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
