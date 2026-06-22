import React from 'react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Toggle } from '@/components/scene';

/*
 * AmplificationScene — chapter 10 scene (Figure 10.4, §7).
 *
 * The LSM amplification trade-off, made into something you can move. Never
 * updating in place costs three things, in three currencies:
 *   WRITE amp  — bytes written / bytes asked for (WAL + flush + every compaction
 *                that rewrites a record again)
 *   READ  amp  — SSTables a get must scan
 *   SPACE amp  — records stored / distinct live keys (dead versions + tombstones)
 * Compaction trades them against each other. The leveled/tiered toggle slides
 * the operating point: compact OFTEN (leveled) buys low read & space amp with
 * high write amp; compact RARELY (tiered) buys low write amp with high read &
 * space amp. You cannot minimize all three — the triangle has no center you can
 * reach. The numbers mirror AMPLIFICATION_SANDBOX (the same 30-put workload).
 *
 * A B-tree reference overlay shows the other engine: update-in-place, so reads
 * hit one root-to-leaf path (read ≈ 1) and there are no dead versions
 * (space ≈ 1) — read-optimized, where the LSM is write-optimized.
 *
 * Cream palette only. Reflows at 390px: the triangle and bars stack, controls
 * wrap full-width.
 */

const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

interface Amp {
  write: number;
  read: number;
  space: number;
}

// Mirrors AMPLIFICATION_SANDBOX output (same 30-put, 5-key, heavy-update workload).
const TIERED: Amp = { write: 2.0, read: 2.83, space: 6.0 }; // compact rarely
const LEVELED: Amp = { write: 3.6, read: 1.0, space: 1.0 }; // compact often
// A B-tree is a different engine: update-in-place. One root-to-leaf path per
// read, no superseded versions — but a page write (plus WAL) per update.
const BTREE: Amp = { write: 1.1, read: 1.0, space: 1.3 };

const AXES = [
  { key: 'write' as const, label: 'write', color: ACCENT, blurb: 'rewrites' },
  { key: 'read' as const, label: 'read', color: BLUE, blurb: 'tables scanned' },
  { key: 'space' as const, label: 'space', color: RED, blurb: 'dead vs live' },
];

const BAR_MAX = 6.5; // ceiling for the bar scale (space amp tops out at 6.0)

/* ------------------------------------------------------------------ */
/*  Tradeoff triangle geometry                                        */
/* ------------------------------------------------------------------ */

const TRI_W = 300;
const TRI_H = 188;
// Each vertex is one amplification you are trying to MINIMIZE. The operating
// point is a weighted blend pulled toward whichever amps are HIGH.
const VERT = {
  write: { x: 150, y: 26, color: ACCENT },
  read: { x: 38, y: 162, color: BLUE },
  space: { x: 262, y: 162, color: RED },
};

function operatingPoint(a: Amp): { x: number; y: number } {
  const w = a.write;
  const r = a.read;
  const s = a.space;
  const sum = w + r + s;
  return {
    x: (w * VERT.write.x + r * VERT.read.x + s * VERT.space.x) / sum,
    y: (w * VERT.write.y + r * VERT.read.y + s * VERT.space.y) / sum,
  };
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function AmplificationScene() {
  const [leveled, setLeveled] = useState(false); // false = tiered (compact rarely)
  const [showBtree, setShowBtree] = useState(false);

  const amp = leveled ? LEVELED : TIERED;
  const regime = leveled ? 'leveled' : 'tiered';
  const regimeColor = leveled ? GREEN : ACCENT;
  const pt = operatingPoint(amp);
  const bpt = operatingPoint(BTREE);

  return (
    <Figure
      number="10.4"
      caption="The LSM amplification trade-off as a triangle you can move. Write, read, and space amplification each pull at a corner; the operating point is a blend dragged toward whichever amplifications run high. Compacting OFTEN (leveled) drives read and space amp down to ~1 but pushes write amp up — every record gets rewritten again and again. Compacting RARELY (tiered) barely rewrites (low write amp) but lets SSTables and dead versions pile up (high read and space amp). There is no reachable center: you pick two. The B-tree overlay marks the other engine — update-in-place, read-optimized: one root-to-leaf path per read, no dead versions. Numbers mirror the §7 sandbox. On a narrow screen the triangle and bars stack."
    >
      <div className="space-y-4">
        {/* regime toggles */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2.5 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px]" style={{ color: MUTED }}>
              compaction:
            </span>
            <span className="font-mono text-[12.5px] font-bold" style={{ color: regimeColor }}>
              {leveled ? 'leveled · compact often' : 'tiered · compact rarely'}
            </span>
          </div>
          <Toggle label="tiered → leveled" value={leveled} onChange={setLeveled} />
        </div>

        {/* triangle + bars: side by side on wide, stacked at 390px */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* triangle */}
          <div
            className="fig-card"
            style={{ padding: '10px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
          >
            <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              operating point
            </div>
            <svg
              width={TRI_W}
              height={TRI_H}
              viewBox={`0 0 ${TRI_W} ${TRI_H}`}
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
              role="img"
              aria-label="write / read / space amplification triangle"
            >
              {/* triangle edges */}
              <polygon
                points={`${VERT.write.x},${VERT.write.y} ${VERT.read.x},${VERT.read.y} ${VERT.space.x},${VERT.space.y}`}
                fill="rgba(0,0,0,0.02)"
                stroke="rgba(0,0,0,0.18)"
                strokeWidth={1.4}
              />
              {/* spokes from each vertex to the live point */}
              {Object.values(VERT).map((v, i) => (
                <line
                  key={i}
                  x1={v.x}
                  y1={v.y}
                  x2={pt.x}
                  y2={pt.y}
                  stroke={v.color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.5}
                />
              ))}

              {/* vertex labels */}
              {AXES.map((ax) => {
                const v = VERT[ax.key];
                const top = ax.key === 'write';
                return (
                  <g key={ax.key}>
                    <circle cx={v.x} cy={v.y} r={5} fill={v.color} />
                    <text
                      x={v.x}
                      y={top ? v.y - 9 : v.y + 18}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={700}
                      fill={v.color}
                      fontFamily="ui-monospace, monospace"
                    >
                      {ax.label}
                    </text>
                    <text
                      x={v.x}
                      y={top ? v.y - 9 : v.y + 18}
                      dy={top ? -11 : 12}
                      textAnchor="middle"
                      fontSize={9}
                      fill={MUTED}
                      fontFamily="ui-sans-serif, system-ui"
                    >
                      {amp[ax.key].toFixed(amp[ax.key] >= 10 ? 0 : 1)}×
                    </text>
                  </g>
                );
              })}

              {/* B-tree reference point */}
              {showBtree && (
                <g>
                  <circle cx={bpt.x} cy={bpt.y} r={6} fill="none" stroke={GREEN} strokeWidth={1.6} strokeDasharray="3 2" />
                  <text x={bpt.x} y={bpt.y - 9} textAnchor="middle" fontSize={9} fontWeight={700} fill={GREEN} fontFamily="ui-sans-serif, system-ui">
                    B-tree
                  </text>
                </g>
              )}

              {/* live LSM operating point */}
              <motion.circle
                animate={{ cx: pt.x, cy: pt.y }}
                transition={{ type: 'spring', stiffness: 120, damping: 16 }}
                r={8}
                fill={regimeColor}
                stroke="var(--color-fig-bg)"
                strokeWidth={2.5}
              />
            </svg>
          </div>

          {/* bars */}
          <div className="fig-card" style={{ padding: '12px', flex: 1, minWidth: 0 }}>
            <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              amplification ({regime})
            </div>
            <div className="space-y-3">
              {AXES.map((ax) => {
                const val = amp[ax.key];
                const pct = Math.min(100, (val / BAR_MAX) * 100);
                const bpct = Math.min(100, (BTREE[ax.key] / BAR_MAX) * 100);
                return (
                  <div key={ax.key}>
                    <div className="mb-1 flex items-center justify-between font-sans text-[11.5px]">
                      <span style={{ color: ax.color, fontWeight: 700 }}>
                        {ax.label} <span style={{ color: MUTED, fontWeight: 400 }}>· {ax.blurb}</span>
                      </span>
                      <span className="font-mono tabular-nums" style={{ color: 'var(--color-fig-fg)', fontWeight: 700 }}>
                        {val.toFixed(val >= 10 ? 0 : 2)}×
                      </span>
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        height: 14,
                        borderRadius: 7,
                        background: 'rgba(0,0,0,0.06)',
                        overflow: 'hidden',
                      }}
                    >
                      <motion.div
                        animate={{ width: `${pct}%` }}
                        transition={{ type: 'spring', stiffness: 130, damping: 18 }}
                        style={{ height: '100%', borderRadius: 7, background: ax.color }}
                      />
                      {/* B-tree reference tick */}
                      {showBtree && (
                        <div
                          style={{
                            position: 'absolute',
                            top: -2,
                            bottom: -2,
                            left: `calc(${bpct}% - 1px)`,
                            width: 2,
                            background: GREEN,
                          }}
                          title={`B-tree ${BTREE[ax.key]}×`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {showBtree && (
              <div className="mt-2.5 font-sans text-[10.5px]" style={{ color: MUTED }}>
                <span style={{ display: 'inline-block', width: 14, borderTop: `2px solid ${GREEN}`, verticalAlign: 'middle' }} />{' '}
                B-tree reference (update-in-place)
              </div>
            )}
          </div>
        </div>

        {/* B-tree contrast chip */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 font-sans"
          style={{
            background: showBtree ? `${GREEN}10` : 'rgba(0,0,0,0.03)',
            border: `1px solid ${showBtree ? `${GREEN}55` : 'rgba(0,0,0,0.08)'}`,
          }}
        >
          <span className="text-[12px] leading-snug" style={{ color: 'var(--color-fig-fg)', flex: 1, minWidth: 200 }}>
            <span style={{ fontWeight: 700, color: GREEN }}>B-tree</span> — update-in-place &amp;
            read-optimized: one root-to-leaf path per read (read ≈ 1×), no dead versions (space ≈ 1×).
            The LSM gives those up to make every write a sequential append.
          </span>
          <Toggle label="overlay B-tree" value={showBtree} onChange={setShowBtree} />
        </div>

        {/* takeaway line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
            minHeight: 52,
          }}
        >
          {leveled ? (
            <>
              <b>Leveled (compact often):</b> read and space amp fall to ~1× — one tight, deduplicated
              table — but write amp climbs to {LEVELED.write}× because every record is rewritten again
              and again. Read-heavy workloads pay this gladly.
            </>
          ) : (
            <>
              <b>Tiered (compact rarely):</b> write amp stays low at {TIERED.write}× — almost no
              rewriting — but SSTables and dead versions pile up, so read amp is {TIERED.read}× and
              space amp {TIERED.space}×. Write-heavy, space-tolerant workloads choose this.
            </>
          )}
        </div>
      </div>
    </Figure>
  );
}
