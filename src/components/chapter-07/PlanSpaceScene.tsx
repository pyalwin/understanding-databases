import React from 'react';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * PlanSpaceScene — Chapter 07 §1 (Figure 7.1).
 *
 * One query, many EQUIVALENT physical plans. The reader sees three operator
 * trees that all return identical rows for
 *
 *   SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id
 *   WHERE u.age > 30
 *
 * but whose estimated costs differ by ~five orders of magnitude. Each plan card
 * shows its tree (ch06's operators) and a loud estimated cost; the reader
 * toggles which plan is "chosen." The point: correctness is shared across the
 * plan space, cost is not — so choosing is everything.
 *
 * Costs match the §2 cost model sandbox (cost ≈ pages + cpu_per_row × rows).
 * Layout: plan cards stack vertically; each tree sits in a horizontally
 * scrollable box so it never breaks the 390px column.
 */

/* ------------------------------------------------------------------ */
/*  Plan model                                                         */
/* ------------------------------------------------------------------ */

type OpKind = 'project' | 'filter' | 'join' | 'badjoin' | 'seqscan' | 'indexscan';

interface PlanNode {
  id: string;
  kind: OpKind;
  title: string;
  detail: string;
  children: PlanNode[];
}

let uid = 0;
function node(
  kind: OpKind,
  title: string,
  detail: string,
  children: PlanNode[] = [],
): PlanNode {
  uid += 1;
  return { id: `n${uid}`, kind, title, detail, children };
}

interface Plan {
  id: string;
  label: string;
  cost: number; // matches the §2 cost model
  verdict: string; // one-line why
  root: PlanNode;
}

const seq = (t: string) => node('seqscan', 'SeqScan', t);
const idx = (t: string, i: string) => node('indexscan', 'IndexScan', `${t}·${i}`);

const PLANS: Plan[] = [
  {
    id: 'A',
    label: 'A · hash join, scan + filter',
    cost: 21_400,
    verdict: 'filter pushed down, one pass over each table — the cheap plan.',
    root: node('project', 'Project', 'u.name, o.total', [
      node('join', 'HashJoin', 'u.id = o.user_id', [
        node('filter', 'Filter', 'u.age > 30', [seq('users')]),
        seq('orders'),
      ]),
    ]),
  },
  {
    id: 'B',
    label: 'B · hash join, index on age',
    cost: 58_803,
    verdict: 'the index reads 40k rows one random fetch at a time — age>30 is not selective, so it loses (see §4).',
    root: node('project', 'Project', 'u.name, o.total', [
      node('join', 'HashJoin', 'u.id = o.user_id', [
        idx('users', 'idx_age'),
        seq('orders'),
      ]),
    ]),
  },
  {
    id: 'C',
    label: 'C · nested-loop join',
    cost: 1_700_013_000,
    verdict: 'rescans all of orders once per matching user — catastrophic.',
    root: node('project', 'Project', 'u.name, o.total', [
      node('badjoin', 'NestedLoop', 'u.id = o.user_id', [
        seq('orders'),
        node('filter', 'Filter', 'u.age > 30', [seq('users')]),
      ]),
    ]),
  },
];

/* ------------------------------------------------------------------ */
/*  Layout — recursive placement, root at top                          */
/* ------------------------------------------------------------------ */

const NODE_W = 118;
const NODE_H = 44;
const GAP_X = 14;
const LEVEL_H = 66;
const PAD_X = 10;
const PAD_Y = 8;

interface Placed {
  node: PlanNode;
  x: number;
  y: number;
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

  function place(n: PlanNode, depth: number): number {
    const y = PAD_Y + depth * LEVEL_H;
    let cx: number;
    if (n.children.length === 0) {
      cx = PAD_X + NODE_W / 2 + leafCursor * slotW;
      leafCursor += 1;
    } else {
      const centers = n.children.map((c) => place(c, depth + 1));
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      const childY = PAD_Y + (depth + 1) * LEVEL_H;
      for (let i = 0; i < n.children.length; i++) {
        edges.push({
          key: `${n.id}->${n.children[i].id}`,
          x1: cx,
          y1: y + NODE_H,
          x2: centers[i],
          y2: childY,
        });
      }
    }
    placed.push({ node: n, x: cx - NODE_W / 2, y });
    return cx;
  }

  function depthOf(n: PlanNode): number {
    return n.children.length === 0
      ? 1
      : 1 + Math.max(...n.children.map(depthOf));
  }

  place(root, 0);
  const width = PAD_X * 2 + Math.max(1, leafCursor) * slotW - GAP_X;
  const height = PAD_Y * 2 + (depthOf(root) - 1) * LEVEL_H + NODE_H;
  return { placed, edges, width, height };
}

const KIND_COLOR: Record<OpKind, string> = {
  project: 'var(--color-fig-blue)',
  filter: 'var(--color-accent)',
  join: 'var(--color-fig-green)',
  badjoin: 'var(--color-fig-red)',
  seqscan: 'var(--color-fig-orange)',
  indexscan: 'var(--color-fig-green)',
};

function PlanTree({ root, dim }: { root: PlanNode; dim: boolean }) {
  const layout = useMemo(() => computeLayout(root), [root]);
  return (
    <div
      className="fig-card rounded-md"
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        opacity: dim ? 0.5 : 1,
        transition: 'opacity 0.25s',
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
          {layout.edges.map((e) => (
            <line
              key={e.key}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
        {layout.placed.map((p) => {
          const color = KIND_COLOR[p.node.kind];
          return (
            <div
              key={p.node.id}
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                padding: '5px 8px',
                borderRadius: 8,
                background: 'var(--color-fig-bg)',
                border: `1.5px solid ${color}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
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
                {p.node.title}
              </span>
              <span
                className="font-mono tabular-nums"
                style={{
                  fontSize: 11,
                  color: 'var(--color-fig-fg)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {p.node.detail}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function fmtCost(c: number): string {
  if (c >= 1_000_000) return `${(c / 1_000_000).toFixed(1)}M`;
  if (c >= 1_000) return `${(c / 1_000).toFixed(1)}k`;
  return `${c}`;
}

export default function PlanSpaceScene() {
  const [chosen, setChosen] = useState<string>('A');

  const cheapest = useMemo(
    () => PLANS.reduce((a, b) => (b.cost < a.cost ? b : a)),
    [],
  );
  const chosenPlan = PLANS.find((p) => p.id === chosen) ?? PLANS[0];
  const ratioToCheapest = chosenPlan.cost / cheapest.cost;

  return (
    <Figure
      number="7.1"
      caption="One query, three equivalent plans. Each operator tree returns identical rows, but the estimated cost (pages read + cpu × rows) spans five orders of magnitude — from 21k to 1.7 billion. Choose a plan to see how badly the wrong one stings. The optimizer's whole job is to pick the cheap one without running any of them."
    >
      <div className="space-y-4">
        {/* the query */}
        <div
          className="fig-card rounded-md p-2.5 font-mono text-[12px] leading-snug whitespace-pre-wrap"
          style={{ color: 'var(--color-fig-fg)' }}
        >
          {'SELECT u.name, o.total FROM users u\n  JOIN orders o ON u.id = o.user_id\n  WHERE u.age > 30'}
        </div>

        {/* chosen-plan readout */}
        <div
          className="rounded-md px-3 py-2 font-sans text-[12.5px]"
          role="status"
          aria-live="polite"
          style={{
            background:
              chosen === cheapest.id
                ? 'rgba(47,107,58,0.10)'
                : 'rgba(162,48,48,0.10)',
            border: `1px solid ${chosen === cheapest.id ? 'var(--color-fig-green)' : 'var(--color-fig-red)'}`,
            color: 'var(--color-fig-fg)',
          }}
        >
          {chosen === cheapest.id ? (
            <span>
              You chose <strong>plan {chosen}</strong> — the cheapest. The
              executor runs the same rows for a cost of{' '}
              <span className="font-mono">{chosenPlan.cost.toLocaleString()}</span>.
            </span>
          ) : (
            <span>
              Plan {chosen} returns the same rows but costs{' '}
              <strong className="font-mono">
                {ratioToCheapest >= 1000
                  ? `${Math.round(ratioToCheapest).toLocaleString()}×`
                  : `${ratioToCheapest.toFixed(1)}×`}
              </strong>{' '}
              more than plan {cheapest.id}. Picking it is the optimizer failing.
            </span>
          )}
        </div>

        {/* plan cards, stacked */}
        <div className="space-y-3">
          {PLANS.map((p) => {
            const isChosen = p.id === chosen;
            const isCheapest = p.id === cheapest.id;
            return (
              <motion.div
                key={p.id}
                layout
                className="rounded-lg p-3"
                style={{
                  border: `2px solid ${isChosen ? 'var(--color-accent)' : 'rgba(0,0,0,0.10)'}`,
                  background: isChosen ? 'rgba(176,74,20,0.04)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-sans text-[12px] font-semibold text-[color:var(--color-fig-fg)] truncate">
                      {p.label}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="font-mono tabular-nums text-[20px] leading-tight"
                        style={{
                          color: isCheapest
                            ? 'var(--color-fig-green)'
                            : p.cost > 1_000_000
                              ? 'var(--color-fig-red)'
                              : 'var(--color-fig-fg)',
                        }}
                      >
                        {fmtCost(p.cost)}
                      </span>
                      <span className="font-sans text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)]">
                        est. cost
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChosen(p.id)}
                    aria-pressed={isChosen}
                    className={`fig-btn shrink-0 ${isChosen ? 'fig-btn-primary' : ''}`}
                  >
                    {isChosen ? '✓ chosen' : 'choose'}
                  </button>
                </div>

                <PlanTree root={p.root} dim={!isChosen} />

                <p className="font-sans text-[11px] leading-snug text-[color:var(--color-fig-muted)] mt-2">
                  {p.verdict}
                </p>
              </motion.div>
            );
          })}
        </div>

        <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed">
          Same answer, every plan. The leaves (orange/green) read tables; the
          join strategy and access path decide the cost. Plan C&apos;s
          nested-loop join rescans <code>orders</code> for every matching user —
          the optimizer exists to never pick it.
        </p>
      </div>
    </Figure>
  );
}
