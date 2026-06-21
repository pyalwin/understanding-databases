# Understanding Databases

An interactive deep-dive into how databases actually work — written O'Reilly-deep,
narrated like a story, illustrated with 3Blue1Brown-style animations and live
in-browser code sandboxes.

The reader doesn't just read each chapter — they move through it. Every chapter
is broken into checkpoints, each gated by a quick multiple-choice quiz. Code
examples run in the page: Python via Pyodide, SQL via sql.js. Progress is
persisted in `localStorage`, so you can pick up where you left off.

> **Status:** Chapter 01 — *Why Databases Are Special* — is published. More
> chapters coming.

## What's inside

- **Astro 6** with the Cloudflare adapter and MDX content collections
- **React 19** islands for interactive scenes (hydrated with `client:visible`
  or `client:only`)
- **Tailwind v4** with a cream-and-serif "book" design system
- **Pyodide** for in-browser Python execution
- **sql.js** for in-browser SQLite
- **Framer Motion** for scene transitions
- **Vitest + React Testing Library** for component tests

## Chapters

| # | Title                          | Status    |
|---|--------------------------------|-----------|
| 1 | Why Databases Are Special      | Published |
| 2 | The Transaction                | Planned   |
| 3 | Isolation Levels               | Planned   |
| 4 | Where Data Actually Lives      | Planned   |

Chapter 01 walks through races, torn writes, broken invariants, and the
"my disk lied to me" problem — each as a scene the reader can run, break,
and step through. It ends with a curated *Sources & further reading* section
linking back to the primary literature (Gray, Mohan, Kleppmann, etc.).

## Project layout

```
src/
├── components/
│   ├── chapter-01/         interactive scenes for chapter 01
│   ├── scene/              shared building blocks (Figure, StepThrough,
│   │                       Slider, Toggle, ChapterReader, Section, ...)
│   ├── PythonSandbox.tsx   Pyodide-backed Python REPL with seeded files
│   └── SqlSandboxReact.tsx sql.js-backed SQLite REPL
├── content/chapters/       MDX source for each chapter
├── pages/                  Astro routes
├── styles/global.css       design tokens + reader CSS
└── lib/                    sql-sandbox runtime
```

## Running locally

```sh
npm install
npm run dev          # http://localhost:4321
```

Other commands:

| Command            | What it does                          |
|--------------------|---------------------------------------|
| `npm run build`    | Production build to `./dist/`         |
| `npm run preview`  | Preview the production build          |
| `npm test`         | Run the Vitest suite once             |
| `npm run test:watch` | Watch-mode Vitest                   |

Node ≥ 22.12 is required (see `engines` in `package.json`).

## Writing a new chapter

1. Add an MDX file under `src/content/chapters/NN-slug.mdx` with frontmatter
   matching the schema in `src/content.config.ts` (`title`, `chapterNumber`,
   `summary`, `status`).
2. Wrap the body in `<ChapterReader chapterId="NN-slug">` and split it into
   `<Section id="…" title="…" quiz={…}>` blocks. The reader handles
   progressive reveal, the sidebar TOC, the quiz modal, and progress
   persistence — you just write the content.
3. Drop interactive scenes inline. React islands need a `client:` directive;
   `client:visible` is the usual choice. Sandboxes that touch the filesystem
   (Pyodide) work best with `client:only="react"`.
4. End with a *Sources* section pointing readers at the primary literature.

## License

TBD.
