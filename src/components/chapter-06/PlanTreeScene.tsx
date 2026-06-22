import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * PlanTreeScene — Chapter 06 §1 (Figure 6.1).
 *
 * A query is data: a tree of operator nodes. The reader toggles between a few
 * preset queries and watches the plan tree change — a full scan vs an index
 * leaf, and a single table vs a join. Each node is annotated with what it does.
 * An EXPLAIN-style text panel sits beside the tree (the ch04 callback).
 *
 * Layout: a recursively-placed node tree drawn in an absolutely-positioned box
 * that pans horizontally on narrow screens; the EXPLAIN panel stacks below the
 * tree at ≤640px and sits to the side above it.
 */

/* ------------------------------------------------------------------ */
/*  Plan model                                                         */
/* ------------------------------------------------------------------ */

type OpKind = 'project' | 'filter' | 'join' | 'seqscan' | 'indexscan';

interface PlanNode {
  id: string;
  kind: OpKind;
  title: string; // e.g. "Project"
  detail: string; // e.g. "name"
  note: string; // one-line annotation of what it does
  explain: string; // EXPLAIN-style line (without indentation)
  children: PlanNode[];
}

interface Preset {
  id: string;
  label: string;
  sql: string;
  root: PlanNode;
}

function seqScan(table: string): PlanNode {
  return {
    id: `seqscan-${table}`,
    kind: 'seqscan',
    title: 'SeqScan',
    detail: table,
    note: `read every row of ${table}`,
    explain: `SCAN ${table}`,
    children: [],
  };
}

function indexScan(table: string, index: string): PlanNode {
  return {
    id: `indexscan-${table}`,
    kind: 'indexscan',
    title: 'IndexScan',
    detail: `${table} · ${index}`,
    note: `seek the B-tree; touch only matching rows`,
    explain: `SEARCH ${table} USING INDEX ${index}`,
    children: [],
  };
}

function filter(pred: string, child: PlanNode): PlanNode {
  return {
    id: `filter-${pred}`,
    kind: 'filter',
    title: 'Filter',
    detail: pred,
    note: `drop rows where not (${pred})`,
    explain: `FILTER ${pred}`,
    children: [child],
  };
}

function project(cols: string, child: PlanNode): PlanNode {
  return {
    id: `project-${cols}`,
    kind: 'project',
    title: 'Project',
    detail: cols,
    note: `keep only the columns ${cols}`,
    explain: `PROJECT ${cols}`,
    children: [child],
  };
}

function hashJoin(on: string, left: PlanNode, right: PlanNode): PlanNode {
  return {
    id: `join-${on}`,
    kind: 'join',
    title: 'HashJoin',
    detail: on,
    note: `match rows of both inputs where ${on}`,
    explain: `HASH JOIN ON ${on}`,
    children: [left, right],
  };
}

const PRESETS: Preset[] = [
  {
    id: 'scan',
    label: 'WHERE age > 30',
    sql: 'SELECT name FROM users WHERE age > 30',
    root: project('name', filter('age > 30', seqScan('users'))),
  },
  {
    id: 'index',
    label: 'use the index',
    sql: 'SELECT name FROM users WHERE age > 30  -- via idx_age',
    root: project('name', indexScan('users', 'idx_age')),
  },
  {
    id: 'join',
    label: 'add a join',
    sql:
      'SELECT u.name, o.total FROM users u\n  JOIN orders o ON u.id = o.user_id\n  WHERE u.age > 30',
    root: project(
      'u.name, o.total',
      hashJoin(
        'u.id = o.user_id',
        filter('age > 30', seqScan('users')),
        seqScan('orders'),
      ),
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  Layout — recursive placement, root at top                          */
/* ------------------------------------------------------------------ */

const NODE_W = 132;
const NODE_H = 56;
const GAP_X = 18;
const LEVEL_H = 92;
const PAD_X = 12;
const PAD_Y = 10;

interface Placed {
  node: PlanNode;
  x: number; // left
  y: number; // top
  cx: number; // center x
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

  function depthOf(node: PlanNode): number {
    return node.children.length === 0
      ? 1
      : 1 + Math.max(...node.children.map(depthOf));
  }

  place(root, 0);
  const width = PAD_X * 2 + Math.max(1, leafCursor) * slotW - GAP_X;
  const height = PAD_Y * 2 + (depthOf(root) - 1) * LEVEL_H + NODE_H;
  return { placed, edges, width, height };
}

/* ------------------------------------------------------------------ */
/*  Visuals                                                            */
/* ------------------------------------------------------------------ */

const KIND_COLOR: Record<OpKind, string> = {
  project: 'var(--color-fig-blue)',
  filter: 'var(--color-accent)',
  join: 'var(--color-fig-orange)',
  seqscan: 'var(--color-fig-green)',
  indexscan: 'var(--color-fig-green)',
};

function NodeBox({
  placed,
  active,
  onHover,
}: {
  placed: Placed;
  active: boolean;
  onHover: (id: string | null) => void;
}) {
  const { node } = placed;
  const color = KIND_COLOR[node.kind];
  const leaf = node.children.length === 0;
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ x: placed.x, y: placed.y, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: NODE_W,
        height: NODE_H,
        textAlign: 'left',
        padding: '6px 9px',
        borderRadius: 9,
        background: 'var(--color-fig-bg)',
        border: `1.5px solid ${color}`,
        boxShadow: active
          ? `0 0 0 3px ${color}33`
          : '0 1px 2px rgba(0,0,0,0.06)',
        cursor: 'default',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <span
        className="font-sans"
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color,
          fontWeight: 700,
        }}
      >
        {node.title}
        {leaf ? '  · leaf' : ''}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{
          fontSize: 12,
          color: 'var(--color-fig-fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {node.detail}
      </span>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/*  EXPLAIN-style text                                                 */
/* ------------------------------------------------------------------ */

function explainLines(root: PlanNode): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  function walk(node: PlanNode, depth: number) {
    out.push({ id: node.id, text: `${'  '.repeat(depth)}${node.explain}` });
    node.children.forEach((c) => walk(c, depth + 1));
  }
  walk(root, 0);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function PlanTreeScene() {
  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
  const [hover, setHover] = useState<string | null>(null);

  const preset = useMemo(
    () => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0],
    [presetId],
  );
  const layout = useMemo(() => computeLayout(preset.root), [preset]);
  const explain = useMemo(() => explainLines(preset.root), [preset]);

  const hovered = useMemo(() => {
    if (!hover) return null;
    let found: PlanNode | null = null;
    function walk(n: PlanNode) {
      if (n.id === hover) found = n;
      n.children.forEach(walk);
    }
    walk(preset.root);
    return found as PlanNode | null;
  }, [hover, preset]);

  return (
    <Figure
      number="6.1"
      caption="A query is a tree of operators. The SQL names a result; this tree is what actually runs. Toggle the query: a full scan vs. an index leaf, or add a join. Hover a node to see what it does. Data flows up to the root; the next() pull flows down. Beside it, the same plan as EXPLAIN-style text."
    >
      <div className="space-y-4">
        {/* SQL line */}
        <div
          className="fig-card rounded-md p-2.5 font-mono text-[12px] leading-snug whitespace-pre-wrap"
          style={{ color: 'var(--color-fig-fg)' }}
        >
          {preset.sql}
        </div>

        {/* preset toggles */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              className={`fig-btn ${p.id === presetId ? 'fig-btn-primary' : ''}`}
              aria-pressed={p.id === presetId}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* tree + explain: stack on phones, side-by-side ≥640px */}
        <div className="flex flex-col [@media(min-width:640px)]:flex-row gap-4">
          {/* the tree — pans horizontally on narrow screens */}
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              plan tree · root at top
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
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    pointerEvents: 'none',
                  }}
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
                      active={hover === p.node.id}
                      onHover={setHover}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {/* annotation line */}
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
              {hovered ? (
                <span>
                  <span className="font-semibold" style={{ color: KIND_COLOR[hovered.kind] }}>
                    {hovered.title}
                  </span>{' '}
                  — {hovered.note}.
                </span>
              ) : (
                <span style={{ color: 'var(--color-fig-muted)' }}>
                  Hover or tap a node to read what it does. Leaves (green) are
                  data sources; interior nodes transform.
                </span>
              )}
            </div>
          </div>

          {/* EXPLAIN panel */}
          <div className="[@media(min-width:640px)]:w-56 shrink-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              EXPLAIN (ch04)
            </div>
            <div className="fig-card rounded-md p-2.5">
              {explain.map((l) => (
                <div
                  key={l.id}
                  onMouseEnter={() => setHover(l.id)}
                  onMouseLeave={() => setHover(null)}
                  className="font-mono text-[11.5px] leading-relaxed whitespace-pre rounded px-1"
                  style={{
                    color:
                      hover === l.id
                        ? 'var(--color-fig-fg)'
                        : 'var(--color-fig-muted)',
                    background: hover === l.id ? 'rgba(0,0,0,0.05)' : 'transparent',
                  }}
                >
                  {l.text}
                </div>
              ))}
            </div>
            <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed mt-2">
              This is the same tree ch04's <code>EXPLAIN QUERY PLAN</code>{' '}
              printed — <code>SCAN</code> vs <code>SEARCH USING INDEX</code>.
              <em> Which</em> tree to run is the next chapter.
            </p>
          </div>
        </div>
      </div>
    </Figure>
  );
}
