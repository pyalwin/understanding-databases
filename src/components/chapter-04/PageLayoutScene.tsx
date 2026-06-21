import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

// A logical 4 KB page. The slot directory grows down from the header; row data
// grows up from the bottom; free space is whatever's left in the middle.
const PAGE_SIZE = 4096;
const HEADER = 8; // bytes reserved for the page header
const SLOT_SIZE = 4; // each slot records one row's (offset, length)

// Rows are variable-length on purpose — that's why a slot directory exists.
const ROW_SIZES = [320, 208, 448, 176, 384, 256, 304, 224];

interface Slot {
  id: number; // stable identity for animation + labels
  length: number; // bytes the row occupies in the data region
  offset: number; // where the row sits, measured from the page start
  deleted: boolean; // tombstoned: slot kept, row bytes not reclaimed
}

// The data region is drawn to byte-scale inside a fixed-height bar so the free
// space visibly shrinks as rows pile in. The directory above is schematic.
const BAR_H = 256;
const PX_PER_BYTE = BAR_H / PAGE_SIZE;

export default function PageLayoutScene() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [everInserted, setEverInserted] = useState(0);
  const [rejected, setRejected] = useState<number | null>(null);

  const usedData = useMemo(
    () => slots.reduce((sum, s) => sum + s.length, 0),
    [slots],
  );
  const dirBytes = HEADER + slots.length * SLOT_SIZE;
  const freeEnd = PAGE_SIZE - usedData; // row data grows down from here
  const freeBytes = freeEnd - dirBytes; // the gap in the middle
  const nextSize = ROW_SIZES[everInserted % ROW_SIZES.length];
  // Inserting a row also consumes one more slot in the directory.
  const canInsert = freeBytes - SLOT_SIZE >= nextSize;
  const liveSlots = slots.filter((s) => !s.deleted);

  const insert = () => {
    if (!canInsert) {
      setRejected(nextSize);
      return;
    }
    setRejected(null);
    const length = nextSize;
    const offset = freeEnd - length;
    setSlots((prev) => [
      ...prev,
      { id: everInserted, length, offset, deleted: false },
    ]);
    setEverInserted((n) => n + 1);
  };

  const remove = (id: number) => {
    setRejected(null);
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, deleted: true } : s)),
    );
  };

  const reset = () => {
    setSlots([]);
    setEverInserted(0);
    setRejected(null);
  };

  return (
    <Figure
      number="4.1"
      caption="One 4 KB page. The slot directory grows down from the header; row data grows up from the bottom; free space is the gap between. Insert rows until the page rejects one; delete a row to leave a tombstoned slot."
    >
      <div className="flex flex-col [@media(min-width:720px)]:flex-row gap-5">
        {/* The page itself. */}
        <div className="flex-1 min-w-0">
          <div className="fig-card p-3">
            {/* Header band. */}
            <div className="rounded-md px-3 py-1.5 mb-2 font-sans text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] border border-[color:var(--color-fig-muted)]/25 bg-[color:var(--color-fig-muted)]/5">
              page header · 4096 bytes
            </div>

            {/* Slot directory (schematic): one chip per slot, growing down. */}
            <div className="mb-2">
              <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1">
                slot directory ↓
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {slots.length === 0 && (
                  <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70 py-1">
                    empty — no slots yet
                  </span>
                )}
                {slots.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => !s.deleted && remove(s.id)}
                    disabled={s.deleted}
                    title={
                      s.deleted
                        ? `slot ${i}: tombstoned`
                        : `slot ${i}: offset ${s.offset}, len ${s.length} — click to delete`
                    }
                    className="font-mono text-[10.5px] rounded px-1.5 py-1 border transition-colors"
                    style={
                      s.deleted
                        ? {
                            color: 'var(--color-fig-muted)',
                            borderColor: 'var(--color-fig-muted)',
                            opacity: 0.5,
                            textDecoration: 'line-through',
                            cursor: 'default',
                          }
                        : {
                            color: 'var(--color-fig-blue)',
                            borderColor: 'var(--color-fig-blue)',
                            background: 'rgba(30,79,165,0.06)',
                          }
                    }
                  >
                    {i}→{s.deleted ? '∅' : s.offset}
                  </button>
                ))}
              </div>
            </div>

            {/* Byte map: free space on top, row data to-scale at the bottom. */}
            <div
              className="relative rounded-md overflow-hidden border border-[color:var(--color-fig-muted)]/20"
              style={{ height: BAR_H }}
            >
              {/* Free space fills the whole bar; data blocks sit on top of it. */}
              <div
                className="absolute inset-0 flex items-center justify-center font-sans text-[11px] text-[color:var(--color-fig-muted)]"
                style={{
                  background:
                    'repeating-linear-gradient(45deg, rgba(0,0,0,0.015) 0 8px, rgba(0,0,0,0.04) 8px 16px)',
                }}
              >
                {freeBytes} bytes free
              </div>

              {/* Data region: blocks stacked from the bottom, to byte-scale. */}
              <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse">
                <AnimatePresence initial={false}>
                  {slots.map((s, i) => (
                    <motion.div
                      key={s.id}
                      initial={{ opacity: 0, scaleY: 0 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      exit={{ opacity: 0 }}
                      style={{
                        height: Math.max(16, s.length * PX_PER_BYTE),
                        transformOrigin: 'bottom',
                        background: s.deleted
                          ? 'rgba(120,112,106,0.12)'
                          : 'rgba(30,79,165,0.16)',
                        borderTop: '1px solid var(--color-fig-bg)',
                      }}
                      className="flex items-center justify-between px-2 font-mono text-[10.5px] overflow-hidden"
                    >
                      <span
                        style={{
                          color: s.deleted
                            ? 'var(--color-fig-muted)'
                            : 'var(--color-fig-blue)',
                          textDecoration: s.deleted ? 'line-through' : 'none',
                        }}
                      >
                        #{i} · id={s.id}
                      </span>
                      <span className="text-[color:var(--color-fig-muted)] shrink-0">
                        {s.deleted ? 'tombstone' : `${s.length}B`}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Free-space pointer: the line between free space and row data. */}
              {usedData > 0 && (
                <div
                  className="absolute inset-x-0 flex items-center pointer-events-none"
                  style={{ bottom: usedData * PX_PER_BYTE }}
                >
                  <div className="h-px flex-1 bg-[color:var(--color-fig-orange)]" />
                  <span
                    className="font-mono text-[9.5px] px-1 whitespace-nowrap"
                    style={{ color: 'var(--color-fig-orange)' }}
                  >
                    free_end = {freeEnd}
                  </span>
                </div>
              )}
            </div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mt-1 text-right">
              row data ↑
            </div>
          </div>
        </div>

        {/* Controls + live readout. */}
        <div className="[@media(min-width:720px)]:w-56 shrink-0 space-y-3">
          <div className="font-sans text-[13px] space-y-1">
            <Stat label="rows (live)" value={String(liveSlots.length)} />
            <Stat label="slots in directory" value={String(slots.length)} />
            <Stat label="data used" value={`${usedData} B`} />
            <Stat label="free space" value={`${freeBytes} B`} />
            <Stat label="next row needs" value={`${nextSize} B + slot`} />
          </div>

          {rejected !== null && (
            <div
              className="font-sans text-[12px] rounded-md px-3 py-2"
              style={{
                color: 'var(--color-fig-red)',
                background: 'rgba(169,30,30,0.08)',
                border: '1px solid rgba(169,30,30,0.3)',
              }}
            >
              PAGE FULL — can't fit {rejected} more bytes. A page is finite.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Stays enabled when full on purpose: clicking a full page is how
                the reader earns the "PAGE FULL" rejection (spec: insert until
                the page rejects one). */}
            <button
              type="button"
              onClick={insert}
              className="fig-btn fig-btn-primary"
              aria-disabled={!canInsert}
              title={
                canInsert
                  ? `insert a ${nextSize}-byte row`
                  : 'page is full — click to see why'
              }
            >
              + Insert row
            </button>
            <button type="button" onClick={reset} className="fig-btn">
              ⏮ Reset
            </button>
          </div>
          <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed">
            Tip: click a slot chip to delete its row. The slot stays as a
            tombstone — the bytes aren't shifted, so the page never rewrites
            itself on a delete.
          </p>
        </div>
      </div>
    </Figure>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[color:var(--color-fig-muted)]/15 pb-1">
      <span className="text-[color:var(--color-fig-muted)]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
