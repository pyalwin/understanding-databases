import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

// A heap has no order, so a point lookup walks page by page from the start,
// reading each one, until it finds the row or falls off the end. O(n) in pages.

type Target = 'early' | 'middle' | 'last' | 'missing';

const TARGETS: { key: Target; label: string }[] = [
  { key: 'early', label: 'early row' },
  { key: 'middle', label: 'middle row' },
  { key: 'last', label: 'last row' },
  { key: 'missing', label: 'missing id' },
];

const STEP_MS = 180;

function targetPageFor(target: Target, pages: number): number | null {
  if (target === 'missing') return null; // no match → scan the whole file
  if (target === 'last') return pages - 1;
  if (target === 'early') return Math.floor((pages - 1) * 0.2);
  return Math.floor((pages - 1) * 0.5); // middle
}

export default function ScanScene() {
  const [pages, setPages] = useState(24);
  const [target, setTarget] = useState<Target>('middle');
  const [cursor, setCursor] = useState(-1); // page currently being read; -1 = idle
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const stopAt = useMemo(() => {
    const tp = targetPageFor(target, pages);
    return tp === null ? pages - 1 : tp; // a miss still reads to the end
  }, [target, pages]);

  const matchPage = useMemo(() => targetPageFor(target, pages), [target, pages]);

  // Reset the animation whenever the table or the target changes.
  useEffect(() => {
    setRunning(false);
    setCursor(-1);
    setDone(false);
  }, [pages, target]);

  // Drive the cursor one page at a time while running.
  useEffect(() => {
    if (!running) return;
    if (cursor >= stopAt) {
      setRunning(false);
      setDone(true);
      return;
    }
    const t = setTimeout(() => setCursor((c) => c + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [running, cursor, stopAt]);

  const run = () => {
    setCursor(-1);
    setDone(false);
    setRunning(true);
  };
  const reset = () => {
    setRunning(false);
    setCursor(-1);
    setDone(false);
  };

  const pagesRead = cursor < 0 ? 0 : cursor + 1;
  const found = done && matchPage !== null && cursor === matchPage;
  const worstCase = pages; // the row is on the last page, or absent
  const average = Math.round((pages + 1) / 2); // present key, uniform position

  return (
    <Figure
      number="4.2"
      caption="A point lookup on a heap. The cursor reads page by page from the start, lighting each as it goes, until it finds the row or runs out of pages. Drag the table size and watch the pages-read count scale with it."
    >
      <div className="space-y-4">
        {/* Counter + cost summary. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)]">
              pages read
            </div>
            <div className="font-mono text-3xl tabular-nums leading-none">
              {pagesRead}
              <span className="text-[color:var(--color-fig-muted)] text-lg">
                {' '}/ {pages}
              </span>
            </div>
          </div>
          <div className="font-sans text-[12px] text-[color:var(--color-fig-muted)] text-right space-y-0.5">
            <div>
              worst case:{' '}
              <span className="font-mono text-[color:var(--color-fig-fg)]">
                {worstCase}
              </span>{' '}
              pages
            </div>
            <div>
              average (hit):{' '}
              <span className="font-mono text-[color:var(--color-fig-fg)]">
                {average}
              </span>{' '}
              pages
            </div>
          </div>
        </div>

        {/* Result banner. */}
        <div
          className="font-sans text-[12.5px] font-medium min-h-[1.25rem]"
          style={{
            color: !done
              ? 'var(--color-fig-muted)'
              : found
                ? 'var(--color-fig-green)'
                : 'var(--color-fig-red)',
          }}
        >
          {!done && running && `scanning… reading page ${cursor < 0 ? 0 : cursor}`}
          {!done && !running && 'pick a target and run the lookup'}
          {done &&
            found &&
            `found on page ${matchPage} after reading ${pagesRead} pages`}
          {done &&
            !found &&
            `not found — read all ${pagesRead} pages. A miss costs the whole file.`}
        </div>

        {/* Page grid: fewer columns under 520px, wraps freely. */}
        <div className="grid grid-cols-4 [@media(min-width:520px)]:grid-cols-8 gap-1.5">
          {Array.from({ length: pages }, (_, i) => {
            const isActive = running && i === cursor;
            const wasRead = cursor >= 0 && i <= cursor;
            const isMatch = done && found && i === matchPage;
            let bg = 'rgba(0,0,0,0.025)';
            let color = 'var(--color-fig-muted)';
            let border = 'rgba(0,0,0,0.08)';
            if (isMatch) {
              bg = 'rgba(47,107,58,0.18)';
              color = 'var(--color-fig-green)';
              border = 'var(--color-fig-green)';
            } else if (isActive) {
              bg = 'rgba(176,74,20,0.20)';
              color = 'var(--color-fig-orange)';
              border = 'var(--color-fig-orange)';
            } else if (wasRead) {
              bg = 'rgba(30,79,165,0.10)';
              color = 'var(--color-fig-blue)';
              border = 'rgba(30,79,165,0.25)';
            }
            return (
              <motion.div
                key={i}
                animate={isActive ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                transition={{ duration: STEP_MS / 1000 }}
                className="aspect-square rounded flex items-center justify-center font-mono text-[10px] border select-none"
                style={{ background: bg, color, borderColor: border }}
                title={`page ${i}`}
              >
                {isMatch ? '✓' : `p${i}`}
              </motion.div>
            );
          })}
        </div>

        {/* Controls. */}
        <div className="space-y-3 pt-1">
          <Slider
            label="table size (pages)"
            min={8}
            max={64}
            step={4}
            value={pages}
            onChange={setPages}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-[11px] text-[color:var(--color-fig-muted)]">
              target:
            </span>
            {TARGETS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTarget(t.key)}
                className="fig-btn"
                style={
                  target === t.key
                    ? {
                        background: 'rgba(30,79,165,0.10)',
                        borderColor: 'var(--color-fig-blue)',
                        color: 'var(--color-fig-blue)',
                      }
                    : undefined
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={run}
              disabled={running}
              className="fig-btn fig-btn-primary"
            >
              ▶ Run lookup
            </button>
            <button type="button" onClick={reset} className="fig-btn">
              ⏮ Reset
            </button>
          </div>
        </div>
      </div>
    </Figure>
  );
}
