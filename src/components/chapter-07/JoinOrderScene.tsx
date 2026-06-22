import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * JoinOrderScene — Chapter 07 §5 (Figure 7.4).
 *
 * Join ordering is the combinatorial heart of the optimizer. The SAME four
 * tables, joined in a different ORDER, cost wildly different amounts — because
 * the size of each intermediate result feeds the cost of the next join. A good
 * order keeps every intermediate small; a bad one joins two unrelated tables
 * and detonates a cartesian product in the middle.
 *
 * The reader switches between candidate orders and watches:
 *   - the left-deep plan tree rebuild (root at top; each join annotated with
 *     its estimated intermediate cardinality, colored by how big it blew up),
 *   - a cost-comparison panel of all candidates (bars), with the System R
 *     DP-optimal order marked as the winner.
 *
 * Layout: the tree pans horizontally inside its card on narrow screens; the
 * cost panel stacks below the tree at ≤640px and sits beside it above.
 */

/* ------------------------------------------------------------------ */
/*  Join-graph model (mirrors joinorder-sandboxes.ts)                  */
/* ------------------------------------------------------------------ */

const SIZES: Record<string, number> = {
  region: 5,
  customer: 2000,
  orders: 10000,
  lineitem: 60000,
};

const TABLES = Object.keys(SIZES);

// Each predicate links two tables with a selectivity (fraction of the
// cross-product that survives). No edge ⇒ cartesian product (selectivity 1).
const EDGES: { pair: [string, string]; sel: number }[] = [
  { pair: ['region', 'customer'], sel: 1 / 5 },
  { pair: ['customer', 'orders'], sel: 1 / 2000 },
  { pair: ['orders', 'lineitem'], sel: 1 / 10000 },
];

function selectivity(a: string, b: string): number {
  for (const e of EDGES) {
    if (
      (e.pair[0] === a && e.pair[1] === b) ||
      (e.pair[0] === b && e.pair[1] === a)
    ) {
      return e.sel;
    }
  }
  return 1.0; // no predicate between them → cartesian
}

/** Estimated rows when `tables` are joined together (order-independent). */
function card(tables: string[]): number {
  let rows = 1;
  for (const t of tables) rows *= SIZES[t];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      rows *= selectivity(tables[i], tables[j]);
    }
  }
  return rows;
}

/** Sum of every intermediate a left-deep plan in this order materializes. */
function costOfOrder(order: string[]): number {
  let total = 0;
  for (let k = 2; k <= order.length; k++) total += card(order.slice(0, k));
  return total;
}

/** System R left-deep DP — the cheapest order over all tables. */
function optimize(): { order: string[]; cost: number } {
  const key = (s: string[]) => s.slice().sort().join(',');
  const bestCost = new Map<string, number>();
  const bestPlan = new Map<string, string[]>();
  for (const t of TABLES) {
    bestCost.set(key([t]), 0);
    bestPlan.set(key([t]), [t]);
  }
  // subsets by ascending size
  const n = TABLES.length;
  for (let size = 2; size <= n; size++) {
    for (const combo of combinations(TABLES, size)) {
      const thisCard = card(combo);
      let best: { c: number; plan: string[] } | null = null;
      for (const t of combo) {
        const sub = combo.filter((x) => x !== t);
        const c = (bestCost.get(key(sub)) ?? Infinity) + thisCard;
        if (best === null || c < best.c) {
          best = { c, plan: [...(bestPlan.get(key(sub)) ?? []), t] };
        }
      }
      if (best) {
        bestCost.set(key(combo), best.c);
        bestPlan.set(key(combo), best.plan);
      }
    }
  }
  const full = key(TABLES);
  return { order: bestPlan.get(full) ?? TABLES, cost: bestCost.get(full) ?? 0 };
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) rec(i + 1, [...acc, arr[i]]);
  };
  rec(0, []);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Candidate orders                                                   */
/* ------------------------------------------------------------------ */

const DP = optimize();
const FINAL_ROWS = card(TABLES);

interface Candidate {
  id: string;
  label: string;
  order: string[];
}

const CANDIDATES: Candidate[] = [
  { id: 'dp', label: 'Optimizer (DP)', order: DP.order },
  // FROM-clause order: joins region ⋈ lineitem (no predicate!) → cartesian.
  { id: 'naive', label: 'FROM-clause order', order: ['region', 'lineitem', 'customer', 'orders'] },
  { id: 'reverse', label: 'Reverse chain', order: ['lineitem', 'orders', 'customer', 'region'] },
];

const CHEAPEST_ID = CANDIDATES.reduce((best, c) =>
  costOfOrder(c.order) < costOfOrder(best.order) ? c : best,
).id;

/* ------------------------------------------------------------------ */
/*  Plan-tree construction (left-deep) + layout                        */
/* ------------------------------------------------------------------ */

interface PlanNode {
  id: string;
  kind: 'scan' | 'join';
  label: string; // table name, or "⋈ table"
  rows: number; // base size (scan) or intermediate cardinality (join)
  children: PlanNode[];
}

function buildPlanTree(order: string[]): PlanNode {
  let node: PlanNode = {
    id: `scan-${order[0]}`,
    kind: 'scan',
    label: order[0],
    rows: SIZES[order[0]],
    children: [],
  };
  for (let k = 2; k <= order.length; k++) {
    const joined = order[k - 1];
    const rows = card(order.slice(0, k));
    node = {
      id: `join-${order.slice(0, k).join('.')}`,
      kind: 'join',
      label: `⋈ ${joined}`,
      rows,
      children: [
        node,
        {
          id: `scan-${joined}-${k}`,
          kind: 'scan',
          label: joined,
          rows: SIZES[joined],
          children: [],
        },
      ],
    };
  }
  return node;
}

const NODE_W = 92;
const NODE_H = 50;
const GAP_X = 12;
const LEVEL_H = 80;
const PAD_X = 10;
const PAD_Y = 8;

interface Placed {
  node: PlanNode;
  x: number;
  y: number;
  cx: number;
}
interface Edge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Layout {
  placed: Placed[];
  edges: Edge[];
  width: number;
  height: number;
}

function computeLayout(root: PlanNode): Layout {
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let leafCursor = 0;
  const slotW = NODE_W + GAP_X;

  function depthOf(n: PlanNode): number {
    return n.children.length === 0 ? 1 : 1 + Math.max(...n.children.map(depthOf));
  }

  function place(node: PlanNode, depth: number): number {
    const y = PAD_Y + depth * LEVEL_H;
    let cx: number;
    if (node.children.length === 0) {
      cx = PAD_X + NODE_W / 2 + leafCursor * slotW;
      leafCursor += 1;
    } else {
      const centers = node.children.map((c) => place(c, depth + 1));
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      const childY = PAD_Y + (depth + 1) * LEVEL_H;
      for (let i = 0; i < node.children.length; i++) {
        edges.push({
          key: `${node.id}->${node.children[i].id}`,
          x1: cx,
          y1: y + NODE_H,
          x2: centers[i],
          y2: childY,
        });
      }
    }
    placed.push({ node, x: cx - NODE_W / 2, y, cx });
    return cx;
  }

  place(root, 0);
  const width = PAD_X * 2 + Math.max(1, leafCursor) * slotW - GAP_X;
  const height = PAD_Y * 2 + (depthOf(root) - 1) * LEVEL_H + NODE_H;
  return { placed, edges, width, height };
}

/* ------------------------------------------------------------------ */
/*  Visuals                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Color a join's intermediate by how badly it blew up past the final answer. */
function blowupColor(rows: number): string {
  const ratio = rows / FINAL_ROWS;
  if (ratio <= 1.5) return 'var(--color-fig-green)';
  if (ratio <= 20) return 'var(--color-fig-orange)';
  return 'var(--color-fig-red)';
}

function NodeBox({ placed, isMax }: { placed: Placed; isMax: boolean }) {
  const { node } = placed;
  const isJoin = node.kind === 'join';
  const color = isJoin ? blowupColor(node.rows) : 'var(--color-fig-blue)';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ x: placed.x, y: placed.y, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: NODE_W,
        height: NODE_H,
        padding: '5px 7px',
        borderRadius: 9,
        background: 'var(--color-fig-bg)',
        border: `1.5px solid ${color}`,
        boxShadow: isMax
          ? `0 0 0 3px ${color}44`
          : '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
      }}
    >
      <span
        className="font-sans"
        style={{
          fontSize: 8.5,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color,
          fontWeight: 700,
        }}
      >
        {isJoin ? 'Join' : 'Scan'}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 11.5,
          color: 'var(--color-fig-fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 600,
        }}
      >
        {node.label}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{ fontSize: 9.5, color: 'var(--color-fig-muted)' }}
      >
        {fmt(node.rows)} rows
      </span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function JoinOrderScene() {
  const [activeId, setActiveId] = useState<string>('dp');

  const active = useMemo(
    () => CANDIDATES.find((c) => c.id === activeId) ?? CANDIDATES[0],
    [activeId],
  );
  const tree = useMemo(() => buildPlanTree(active.order), [active]);
  const layout = useMemo(() => computeLayout(tree), [tree]);

  const activeCost = costOfOrder(active.order);
  const maxRows = useMemo(
    () => Math.max(...layout.placed.map((p) => p.node.rows)),
    [layout],
  );

  const costs = CANDIDATES.map((c) => ({ id: c.id, cost: costOfOrder(c.order) }));
  const maxCost = Math.max(...costs.map((c) => c.cost));
  const cheapestCost = Math.min(...costs.map((c) => c.cost));

  const blewUp = active.order.length > 1 && maxRows > FINAL_ROWS * 1.5;

  return (
    <Figure
      number="7.4"
      caption="Join ordering: the same four tables, joined in different orders, cost wildly different amounts. Each join's box shows its estimated intermediate size — green stays small, red blew up. The FROM-clause order joins region ⋈ lineitem with no shared predicate, detonating a cartesian product mid-plan; the System R DP search keeps every intermediate small. On a narrow screen, drag the tree sideways."
    >
      <div className="space-y-4">
        {/* candidate toggles */}
        <div className="flex flex-wrap gap-2">
          {CANDIDATES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={`fig-btn ${c.id === activeId ? 'fig-btn-primary' : ''}`}
              aria-pressed={c.id === activeId}
            >
              {c.label}
              {c.id === CHEAPEST_ID ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {/* tree + cost panel: stack on phones, side-by-side ≥640px */}
        <div className="flex flex-col [@media(min-width:640px)]:flex-row gap-4">
          {/* the left-deep plan tree */}
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              left-deep plan · root at top · data flows up
            </div>
            <div
              className="fig-card"
              style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: layout.width,
                  minWidth: '100%',
                  height: layout.height,
                }}
              >
                <svg
                  width={layout.width}
                  height={layout.height}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                >
                  <AnimatePresence>
                    {layout.edges.map((e) => (
                      <motion.line
                        key={e.key}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                        stroke="rgba(0,0,0,0.22)"
                        strokeWidth={1.5}
                      />
                    ))}
                  </AnimatePresence>
                </svg>
                <AnimatePresence>
                  {layout.placed.map((p) => (
                    <NodeBox
                      key={p.node.id}
                      placed={p}
                      isMax={p.node.kind === 'join' && p.node.rows === maxRows}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {/* status line */}
            <div
              className="font-sans text-[12px] leading-snug rounded-md px-3 py-2 mt-2"
              role="status"
              aria-live="polite"
              style={{
                background: 'rgba(0,0,0,0.03)',
                border: '1px solid rgba(0,0,0,0.08)',
                color: 'var(--color-fig-fg)',
                minHeight: 38,
              }}
            >
              {blewUp ? (
                <span>
                  This order's biggest intermediate is{' '}
                  <span className="font-semibold" style={{ color: 'var(--color-fig-red)' }}>
                    {fmt(maxRows)} rows
                  </span>{' '}
                  — far past the {fmt(FINAL_ROWS)}-row answer. Cost ={' '}
                  <span className="font-semibold font-mono tabular-nums">{fmt(activeCost)}</span>.
                </span>
              ) : (
                <span>
                  Every intermediate stays small (≤ {fmt(maxRows)} rows). Cost ={' '}
                  <span
                    className="font-semibold font-mono tabular-nums"
                    style={{ color: 'var(--color-fig-green)' }}
                  >
                    {fmt(activeCost)}
                  </span>
                  {activeCost === cheapestCost ? ' — the cheapest order.' : '.'}
                </span>
              )}
            </div>
          </div>

          {/* cost comparison */}
          <div className="[@media(min-width:640px)]:w-60 shrink-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              total cost · sum of intermediates
            </div>
            <div className="fig-card rounded-md p-3 space-y-3">
              {CANDIDATES.map((c) => {
                const cost = costOfOrder(c.order);
                const isCheapest = cost === cheapestCost;
                const isActive = c.id === activeId;
                const pct = Math.max(2, (cost / maxCost) * 100);
                const bar = isCheapest ? 'var(--color-fig-green)' : 'var(--color-fig-red)';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className="block w-full text-left"
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span
                        className="font-sans text-[11px]"
                        style={{
                          color: isActive ? 'var(--color-fig-fg)' : 'var(--color-fig-muted)',
                          fontWeight: isActive ? 700 : 500,
                        }}
                      >
                        {c.label}
                        {isCheapest ? ' ✓' : ''}
                      </span>
                      <span
                        className="font-mono tabular-nums text-[11px]"
                        style={{ color: 'var(--color-fig-fg)' }}
                      >
                        {fmt(cost)}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: 'rgba(0,0,0,0.06)',
                        overflow: 'hidden',
                      }}
                    >
                      <motion.div
                        initial={false}
                        animate={{ width: `${pct}%` }}
                        transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                        style={{
                          height: '100%',
                          background: bar,
                          outline: isActive ? `1.5px solid ${bar}` : 'none',
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed mt-2">
              Four tables have <span className="font-semibold">4! = 24</span> left-deep orders.
              System R's DP finds the cheapest without trying them all — but only as
              well as the §3 row estimates feeding it.
            </p>
          </div>
        </div>
      </div>
    </Figure>
  );
}
