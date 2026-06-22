import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * AggSortScene — Chapter 06 §7 (Figure 6.4).
 *
 * Blocking operators, made tangible. One shared input stream feeds two
 * blocking operators side by side:
 *
 *   HashAggregate (GROUP BY region, SUM amount): a group -> accumulator table
 *     fills as each row streams in. You can SEE state accumulate, but the final
 *     value of a group isn't known until the last row lands.
 *
 *   Sort (ORDER BY amount DESC): every row is buffered as it arrives; nothing
 *     comes out until the input is exhausted, then the buffer is released in
 *     order.
 *
 * A "blocked until last row" badge stays lit until the stream is drained —
 * contrasting these with the pipelined Filter/Project of §2, which emit a row
 * as soon as they have one. Stacks to a single column at 390px.
 */

interface Sale {
  id: number;
  region: string;
  rep: string;
  amount: number;
}

const SALES: Sale[] = [
  { id: 1, region: 'west', rep: 'Ada', amount: 90 },
  { id: 2, region: 'east', rep: 'Lin', amount: 40 },
  { id: 3, region: 'west', rep: 'Omar', amount: 60 },
  { id: 4, region: 'east', rep: 'Grace', amount: 75 },
  { id: 5, region: 'west', rep: 'Wei', amount: 30 },
  { id: 6, region: 'east', rep: 'Sam', amount: 55 },
];

const REGION_COLOR: Record<string, string> = {
  west: 'var(--color-fig-blue)',
  east: 'var(--color-fig-orange)',
};

export default function AggSortScene() {
  const [cursor, setCursor] = useState(0); // rows streamed so far

  const total = SALES.length;
  const drained = cursor >= total;
  const streamed = SALES.slice(0, cursor);

  // Hash-aggregate state: region -> {count, sum}, accumulated over streamed rows.
  const groups = useMemo(() => {
    const m = new Map<string, { count: number; sum: number }>();
    for (const r of streamed) {
      const g = m.get(r.region) ?? { count: 0, sum: 0 };
      g.count += 1;
      g.sum += r.amount;
      m.set(r.region, g);
    }
    return Array.from(m.entries()).map(([region, g]) => ({ region, ...g }));
  }, [cursor]);

  // Sort buffer: the streamed rows. Released (sorted) only when drained.
  const sortReleased = useMemo(() => {
    if (!drained) return [];
    return [...SALES].sort((a, b) => b.amount - a.amount);
  }, [drained]);

  const step = () => setCursor((c) => Math.min(total, c + 1));
  const streamAll = () => setCursor(total);
  const reset = () => setCursor(0);

  const lastRow = cursor > 0 ? SALES[cursor - 1] : null;

  return (
    <Figure
      number="6.4"
      caption="Blocking operators. One input stream feeds two of them. HashAggregate (GROUP BY) accumulates per-group state as rows arrive — but a group's total isn't final until the last row. Sort (ORDER BY) buffers every row and releases nothing until the input is drained. The 'blocked' badge stays lit until then: unlike §2's pipelined Filter/Project, these must see the last row before emitting the first."
    >
      <div className="space-y-4">
        {/* blocking indicator */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-sans text-[11px] font-semibold rounded-full px-2.5 py-1"
            style={
              drained
                ? {
                    color: 'var(--color-fig-green)',
                    background: 'rgba(47,107,58,0.12)',
                    border: '1px solid var(--color-fig-green)',
                  }
                : {
                    color: 'var(--color-fig-red)',
                    background: 'rgba(176,30,30,0.10)',
                    border: '1px solid var(--color-fig-red)',
                  }
            }
          >
            {drained ? '✓ input drained — operators emit' : '⏳ blocked until last row'}
          </span>
          <span className="font-sans text-[11px] text-[color:var(--color-fig-muted)]">
            streamed {cursor}/{total} rows
          </span>
        </div>

        {/* the input stream */}
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
            input · sales (streamed one row at a time)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SALES.map((r, i) => {
              const seen = i < cursor;
              const isLast = i === cursor - 1;
              return (
                <motion.div
                  key={r.id}
                  animate={isLast ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="font-mono text-[11px] tabular-nums rounded px-1.5 py-1"
                  style={{
                    color: seen ? 'var(--color-fig-fg)' : 'var(--color-fig-muted)',
                    background: seen ? 'rgba(0,0,0,0.04)' : 'transparent',
                    border: `1px solid ${
                      isLast ? REGION_COLOR[r.region] : 'rgba(0,0,0,0.10)'
                    }`,
                    opacity: seen ? 1 : 0.45,
                  }}
                  title={`${r.region} · ${r.rep} · ${r.amount}`}
                >
                  <span style={{ color: REGION_COLOR[r.region] }}>{r.region}</span> {r.amount}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* the two operators: stack on phones, side-by-side ≥560px */}
        <div className="flex flex-col [@media(min-width:560px)]:flex-row gap-4">
          {/* hash aggregate */}
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              HashAggregate · GROUP BY region, SUM(amount)
            </div>
            <div className="fig-card rounded-md p-2 min-h-[120px]">
              <div className="grid grid-cols-3 gap-x-2 font-mono text-[11px] text-[color:var(--color-fig-muted)] pb-1 mb-1 border-b border-[color:var(--color-fig-muted)]/20">
                <span>region</span>
                <span className="text-right">count</span>
                <span className="text-right">sum</span>
              </div>
              {groups.length === 0 ? (
                <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                  empty — stream a row
                </span>
              ) : (
                <AnimatePresence initial={false}>
                  {groups.map((g) => (
                    <motion.div
                      key={g.region}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="grid grid-cols-3 gap-x-2 font-mono text-[12px] tabular-nums py-0.5"
                    >
                      <span style={{ color: REGION_COLOR[g.region] }}>{g.region}</span>
                      <span className="text-right">{g.count}</span>
                      <motion.span
                        key={g.sum}
                        initial={{ color: 'var(--color-accent)' }}
                        animate={{ color: 'var(--color-fig-fg)' }}
                        transition={{ duration: 0.6 }}
                        className="text-right font-semibold"
                      >
                        {g.sum}
                      </motion.span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              <div className="font-sans text-[10px] text-[color:var(--color-fig-muted)] mt-2 leading-snug">
                state grows in place; totals are{' '}
                <span style={{ color: drained ? 'var(--color-fig-green)' : 'var(--color-fig-red)' }}>
                  {drained ? 'final' : 'not final yet'}
                </span>
                .
              </div>
            </div>
          </div>

          {/* sort */}
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              Sort · ORDER BY amount DESC
            </div>
            <div className="fig-card rounded-md p-2 min-h-[120px]">
              {!drained ? (
                <>
                  <div className="font-sans text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)] mb-1">
                    buffer ({streamed.length} held, unsorted)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {streamed.length === 0 ? (
                      <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                        empty — stream a row
                      </span>
                    ) : (
                      streamed.map((r) => (
                        <span
                          key={r.id}
                          className="font-mono text-[11px] tabular-nums rounded px-1 py-0.5"
                          style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--color-fig-muted)' }}
                        >
                          {r.amount}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="font-sans text-[10px] text-[color:var(--color-fig-red)] mt-2 leading-snug">
                    nothing released — waiting for the last row.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-sans text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)] mb-1">
                    released in order
                  </div>
                  <AnimatePresence initial={false}>
                    {sortReleased.map((r, i) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.06 }}
                        className="grid grid-cols-3 gap-x-2 font-mono text-[12px] tabular-nums py-0.5"
                      >
                        <span className="text-right font-semibold">{r.amount}</span>
                        <span style={{ color: REGION_COLOR[r.region] }}>{r.region}</span>
                        <span className="text-[color:var(--color-fig-muted)]">{r.rep}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div className="font-sans text-[10px] text-[color:var(--color-fig-green)] mt-2 leading-snug">
                    buffer sorted and released, all at once.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={step}
            disabled={drained}
            className="fig-btn fig-btn-primary"
          >
            ▶ stream next row
          </button>
          <button type="button" onClick={streamAll} disabled={drained} className="fig-btn">
            stream all
          </button>
          <button type="button" onClick={reset} disabled={cursor === 0} className="fig-btn">
            ⏮ Reset
          </button>
          {lastRow && !drained && (
            <span className="font-sans text-[11px] text-[color:var(--color-fig-muted)]">
              last in: {lastRow.region} · {lastRow.amount}
            </span>
          )}
        </div>
      </div>
    </Figure>
  );
}
