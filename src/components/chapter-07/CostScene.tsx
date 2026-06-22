import React from 'react';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * CostScene — Chapter 07 §2 (Figure 7.2).
 *
 * The cost model made mechanical. One plan (ch06's hash-join plan for the §1
 * query) is shown as an operator tree; every node displays its estimated rows
 * out and its own cost contribution (pages read + cpu_per_row × rows), rolling
 * up to a grand total. A selectivity knob on the `age` filter recomputes the
 * whole tree live — and shows that a filter on a seq scan never saves the page
 * reads, only the downstream row work, while the join's output (and cost) move
 * with selectivity. Cost is mechanical GIVEN the row counts; §3 estimates them.
 *
 * Numbers match the COSTMODEL_SANDBOX (CPU=0.01, IO=1.0); at sel=0.40 the total
 * is 21,400 — the same figure plan A reports in §1.
 */

const CPU = 0.01; // cpu cost per row
const IO = 1.0; // cost per page read

const STATS = {
  users: { rows: 100_000, pages: 1_000 },
  orders: { rows: 500_000, pages: 6_000 },
};
const JOIN_SEL = 1 / STATS.users.rows; // join on the unique users.id

type Kind = 'project' | 'join' | 'filter' | 'seqscan';

interface Row {
  id: string;
  depth: number;
  kind: Kind;
  title: string;
  detail: string;
  rowsOut: number;
  selfCost: number;
  io: number; // page-read portion of selfCost (for the teaching note)
}

const KIND_COLOR: Record<Kind, string> = {
  project: 'var(--color-fig-blue)',
  join: 'var(--color-fig-green)',
  filter: 'var(--color-accent)',
  seqscan: 'var(--color-fig-orange)',
};

// Build the plan-A tree bottom-up for a given filter selectivity, flattened to
// a pre-order list (root first) with each node's rows + cost already computed.
function buildRows(sel: number): { rows: Row[]; total: number } {
  const u = STATS.users;
  const o = STATS.orders;

  // leaves & their derived counts
  const usersScanRows = u.rows;
  const usersScanIO = u.pages * IO;
  const usersScanCost = usersScanIO + u.rows * CPU;

  const filterRows = Math.round(u.rows * sel);
  const filterCost = usersScanRows * CPU; // touches every scanned row

  const ordersScanRows = o.rows;
  const ordersScanIO = o.pages * IO;
  const ordersScanCost = ordersScanIO + o.rows * CPU;

  const joinRows = Math.round(filterRows * ordersScanRows * JOIN_SEL);
  const joinCost = (filterRows + ordersScanRows) * CPU;

  const projectRows = joinRows;
  const projectCost = joinRows * CPU;

  const rows: Row[] = [
    {
      id: 'project',
      depth: 0,
      kind: 'project',
      title: 'Project',
      detail: 'u.name, o.total',
      rowsOut: projectRows,
      selfCost: projectCost,
      io: 0,
    },
    {
      id: 'join',
      depth: 1,
      kind: 'join',
      title: 'HashJoin',
      detail: 'u.id = o.user_id',
      rowsOut: joinRows,
      selfCost: joinCost,
      io: 0,
    },
    {
      id: 'filter',
      depth: 2,
      kind: 'filter',
      title: 'Filter',
      detail: 'u.age > ?',
      rowsOut: filterRows,
      selfCost: filterCost,
      io: 0,
    },
    {
      id: 'users',
      depth: 3,
      kind: 'seqscan',
      title: 'SeqScan',
      detail: 'users',
      rowsOut: usersScanRows,
      selfCost: usersScanCost,
      io: usersScanIO,
    },
    {
      id: 'orders',
      depth: 2,
      kind: 'seqscan',
      title: 'SeqScan',
      detail: 'orders',
      rowsOut: ordersScanRows,
      selfCost: ordersScanCost,
      io: ordersScanIO,
    },
  ];

  const total = rows.reduce((s, r) => s + r.selfCost, 0);
  return { rows, total };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function CostScene() {
  // selectivity as a percentage (knob), 1%..100%; default 40% → total 21,400.
  const [pct, setPct] = useState(40);
  const sel = pct / 100;

  const { rows, total } = useMemo(() => buildRows(sel), [sel]);
  const maxSelf = useMemo(
    () => Math.max(...rows.map((r) => r.selfCost)),
    [rows],
  );

  return (
    <Figure
      number="7.2"
      caption="The cost model, summed up the tree. Each operator contributes (pages read + cpu × rows it processes); the contributions roll up to a total. Drag the selectivity of the age filter: the two seq scans still read every page no matter what (a filter doesn't save the read), but fewer surviving rows shrink the join's output and cost. Cost is mechanical once the row counts are known — which is exactly why estimating them (§3) is the whole game."
    >
      <div className="space-y-4">
        {/* total */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)]">
              estimated total cost
            </div>
            <motion.div
              key={Math.round(total)}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              className="font-mono tabular-nums text-3xl leading-none text-[color:var(--color-fig-fg)]"
            >
              {fmt(total)}
            </motion.div>
          </div>
          <div className="font-sans text-[12px] text-[color:var(--color-fig-muted)] text-right">
            age filter keeps
            <div className="font-mono text-[color:var(--color-accent)] text-base">
              {pct}%
            </div>
          </div>
        </div>

        {/* the tree as a cost ledger */}
        <div className="fig-card rounded-md p-2.5">
          {/* header */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline font-sans text-[9.5px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)] pb-1.5 mb-1 border-b border-[color:var(--color-fig-muted)]/20">
            <span>operator</span>
            <span className="text-right w-[64px]">rows out</span>
            <span className="text-right w-[64px]">cost</span>
          </div>

          {rows.map((r) => {
            const color = KIND_COLOR[r.kind];
            const barPct = maxSelf ? (r.selfCost / maxSelf) * 100 : 0;
            return (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center py-1 relative"
              >
                {/* faint cost bar behind the row */}
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0.5 left-0 rounded"
                  style={{
                    width: `${barPct}%`,
                    background: `${color}14`,
                    zIndex: 0,
                  }}
                />
                <div
                  className="flex items-center gap-1.5 min-w-0 relative"
                  style={{ paddingLeft: r.depth * 12, zIndex: 1 }}
                >
                  <span
                    aria-hidden="true"
                    className="font-mono text-[color:var(--color-fig-muted)] text-[11px]"
                  >
                    {r.depth > 0 ? '└' : ''}
                  </span>
                  <span
                    className="font-sans text-[11px] font-semibold"
                    style={{ color }}
                  >
                    {r.title}
                  </span>
                  <span className="font-mono text-[10.5px] text-[color:var(--color-fig-muted)] truncate">
                    {r.detail}
                  </span>
                </div>
                <motion.span
                  key={`${r.id}-rows-${r.rowsOut}`}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 1 }}
                  className="font-mono tabular-nums text-[11.5px] text-right w-[64px] text-[color:var(--color-fig-fg)] relative"
                  style={{ zIndex: 1 }}
                >
                  {fmt(r.rowsOut)}
                </motion.span>
                <motion.span
                  key={`${r.id}-cost-${Math.round(r.selfCost)}`}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 1 }}
                  className="font-mono tabular-nums text-[11.5px] text-right w-[64px] relative"
                  style={{ zIndex: 1, color }}
                  title={
                    r.io > 0
                      ? `${fmt(r.io)} page reads + ${fmt(r.selfCost - r.io)} cpu`
                      : `${fmt(r.selfCost)} cpu`
                  }
                >
                  {fmt(r.selfCost)}
                </motion.span>
              </div>
            );
          })}

          {/* total row */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center pt-1.5 mt-1 border-t border-[color:var(--color-fig-muted)]/30">
            <span className="font-sans text-[11px] font-semibold text-[color:var(--color-fig-fg)]">
              Σ total
            </span>
            <span className="w-[64px]" />
            <span className="font-mono tabular-nums text-[12.5px] text-right w-[64px] font-semibold text-[color:var(--color-fig-fg)]">
              {fmt(total)}
            </span>
          </div>
        </div>

        {/* knob */}
        <div className="space-y-2 pt-1">
          <Slider
            label="age-filter selectivity (% rows kept)"
            min={1}
            max={100}
            step={1}
            value={pct}
            onChange={setPct}
          />
          <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed">
            Notice the two <span style={{ color: 'var(--color-fig-orange)' }}>SeqScan</span>{' '}
            costs never move — a filter still reads every page (the IO is paid up
            front); only the surviving row count, and so the{' '}
            <span style={{ color: 'var(--color-fig-green)' }}>HashJoin</span>{' '}
            output, shrinks. Every number here is downstream of one estimate: how
            many rows <code>age &gt; ?</code> keeps.
          </p>
        </div>
      </div>
    </Figure>
  );
}
