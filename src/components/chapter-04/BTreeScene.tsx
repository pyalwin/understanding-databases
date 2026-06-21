import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * BTreeScene — chapter 04 HERO scene.
 *
 * An animated B+-tree. Internal nodes hold separator keys that *route*;
 * leaves hold the actual keys (each standing in for a key -> row-id entry).
 *
 * The reader inserts keys one at a time (presets + a free numeric input).
 * Every insert:
 *   1. descends from the root to the correct leaf (highlighted path),
 *   2. places the key in sorted order in that leaf,
 *   3. and when a node overflows its capacity, SPLITS it, pushing the
 *      median up to the parent — growing a whole new level when the root
 *      itself splits.
 *
 * A "search" mode lights the root-to-leaf path for a queried key and counts
 * the nodes visited, so the prose can hold it up against §3's pages-read.
 *
 * The capacity slider (max keys per node, 2–6) lets the reader force splits
 * quickly. On mobile the tree pans horizontally inside the figure.
 */

/* ------------------------------------------------------------------ */
/*  Tree model + algorithm (immutable; node ids preserved for animation) */
/* ------------------------------------------------------------------ */

interface BNode {
  id: number;
  leaf: boolean;
  keys: number[];
  children: BNode[];
}

interface SplitResult {
  sepKey: number;
  right: BNode;
}

type IdGen = () => number;

function makeLeaf(id: number, keys: number[] = []): BNode {
  return { id, leaf: true, keys, children: [] };
}

function insertSorted(keys: number[], key: number): number[] {
  const next = keys.slice();
  let i = 0;
  while (i < next.length && next[i] < key) i++;
  next.splice(i, 0, key);
  return next;
}

/** Index of the child to descend into for `key`. */
function childIndexFor(node: BNode, key: number): number {
  let i = 0;
  while (i < node.keys.length && key >= node.keys[i]) i++;
  return i;
}

function insertRec(
  node: BNode,
  key: number,
  cap: number,
  nextId: IdGen,
): { node: BNode; split: SplitResult | null } {
  if (node.leaf) {
    const keys = insertSorted(node.keys, key);
    if (keys.length <= cap) {
      return { node: { ...node, keys }, split: null };
    }
    // Split the leaf: right gets the upper half; its first key is COPIED up.
    const mid = Math.ceil(keys.length / 2);
    const left: BNode = { ...node, keys: keys.slice(0, mid) };
    const right = makeLeaf(nextId(), keys.slice(mid));
    return { node: left, split: { sepKey: right.keys[0], right } };
  }

  const i = childIndexFor(node, key);
  const res = insertRec(node.children[i], key, cap, nextId);
  const children = node.children.slice();
  children[i] = res.node;
  let keys = node.keys;

  if (res.split) {
    keys = node.keys.slice();
    keys.splice(i, 0, res.split.sepKey);
    children.splice(i + 1, 0, res.split.right);
  }

  if (keys.length <= cap) {
    return { node: { ...node, keys, children }, split: null };
  }

  // Split the internal node: the median key MOVES up (not copied).
  const midIdx = Math.floor(keys.length / 2);
  const upKey = keys[midIdx];
  const left: BNode = {
    ...node,
    keys: keys.slice(0, midIdx),
    children: children.slice(0, midIdx + 1),
  };
  const right: BNode = {
    id: nextId(),
    leaf: false,
    keys: keys.slice(midIdx + 1),
    children: children.slice(midIdx + 1),
  };
  return { node: left, split: { sepKey: upKey, right } };
}

function insertKey(root: BNode, key: number, cap: number, nextId: IdGen): BNode {
  const { node, split } = insertRec(root, key, cap, nextId);
  if (!split) return node;
  // Root split → grow a new level.
  return {
    id: nextId(),
    leaf: false,
    keys: [split.sepKey],
    children: [node, split.right],
  };
}

function buildTree(keys: number[], cap: number, nextId: IdGen): BNode {
  let root = makeLeaf(nextId());
  for (const k of keys) root = insertKey(root, k, cap, nextId);
  return root;
}

function treeHasKey(root: BNode, key: number): boolean {
  let node = root;
  while (!node.leaf) node = node.children[childIndexFor(node, key)];
  return node.keys.includes(key);
}

/** Root-to-leaf path of node ids for `key`. */
function pathFor(root: BNode, key: number): number[] {
  const ids: number[] = [];
  let node = root;
  ids.push(node.id);
  while (!node.leaf) {
    node = node.children[childIndexFor(node, key)];
    ids.push(node.id);
  }
  return ids;
}

function leafForKey(root: BNode, key: number): BNode {
  let node = root;
  while (!node.leaf) node = node.children[childIndexFor(node, key)];
  return node;
}

function treeDepth(node: BNode): number {
  return node.leaf ? 1 : 1 + Math.max(...node.children.map(treeDepth));
}

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

const KEY_W = 30;
const NODE_PAD_X = 8;
const NODE_H = 42;
const LEVEL_H = 90;
const PAD_X = 16;
const PAD_TOP = 8;

function nodeWidth(node: BNode): number {
  const cells = Math.max(node.keys.length, 1);
  return cells * KEY_W + 2 * NODE_PAD_X;
}

interface Placed {
  node: BNode;
  depth: number;
  cx: number;
  y: number;
  w: number;
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

function computeLayout(root: BNode, cap: number): Layout {
  const slotW = cap * KEY_W + 2 * NODE_PAD_X + 28;
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let leafCursor = 0;

  function place(node: BNode, depth: number): number {
    const y = PAD_TOP + depth * LEVEL_H;
    let cx: number;
    if (node.leaf) {
      cx = PAD_X + slotW / 2 + leafCursor * slotW;
      leafCursor += 1;
    } else {
      const centers = node.children.map((c) => place(c, depth + 1));
      cx = (centers[0] + centers[centers.length - 1]) / 2;
      const childY = PAD_TOP + (depth + 1) * LEVEL_H;
      for (let i = 0; i < node.children.length; i++) {
        edges.push({
          key: `${node.id}-${node.children[i].id}`,
          x1: cx,
          y1: y + NODE_H,
          x2: centers[i],
          y2: childY,
        });
      }
    }
    placed.push({ node, depth, cx, y, w: nodeWidth(node) });
    return cx;
  }

  place(root, 0);
  const width = PAD_X * 2 + leafCursor * slotW;
  const height = PAD_TOP + (treeDepth(root) - 1) * LEVEL_H + NODE_H + PAD_TOP;
  return { placed, edges, width, height };
}

/* ------------------------------------------------------------------ */
/*  Visuals                                                            */
/* ------------------------------------------------------------------ */

type HighlightKind = 'descend' | 'search';

const COLORS = {
  leaf: 'var(--color-fig-green)',
  internal: 'var(--color-fig-blue)',
  descend: 'var(--color-accent)',
  search: 'var(--color-fig-blue)',
};

interface NodeBoxProps {
  placed: Placed;
  highlighted: boolean;
  kind: HighlightKind | null;
  flashKey: number | null;
}

function NodeBox({ placed, highlighted, kind, flashKey }: NodeBoxProps) {
  const { node, cx, y, w } = placed;
  const accent = node.leaf ? COLORS.leaf : COLORS.internal;
  const ring = highlighted
    ? kind === 'search'
      ? COLORS.search
      : COLORS.descend
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ x: cx - w / 2, y, opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        height: NODE_H,
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: 8,
        background: 'var(--color-fig-bg)',
        border: `1.5px solid ${ring ?? accent}`,
        boxShadow: ring ? `0 0 0 3px ${ring}33` : '0 1px 2px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}
    >
      {node.keys.length === 0 ? (
        <div
          className="font-mono"
          style={{
            width: KEY_W,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-fig-muted)',
            fontSize: 13,
          }}
        >
          ∅
        </div>
      ) : (
        node.keys.map((k, i) => {
          const flash = flashKey === k && node.leaf;
          return (
            <div
              key={`${k}-${i}`}
              className="font-mono tabular-nums"
              title={node.leaf ? `key ${k} → row r${k}` : `route: < ${k} left, ≥ ${k} right`}
              style={{
                width: KEY_W,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 600,
                color: node.leaf ? 'var(--color-fig-fg)' : COLORS.internal,
                background: flash ? `${COLORS.descend}22` : 'transparent',
                borderLeft: i > 0 ? '1px solid rgba(0,0,0,0.10)' : 'none',
              }}
            >
              {k}
            </div>
          );
        })
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Mode = 'insert' | 'search';

interface SearchOutcome {
  key: number;
  visited: number;
  found: boolean;
}

const PRESET_SEQUENCE = [10, 20, 5, 15, 25, 30, 8, 12, 1, 18, 22, 28, 35, 3, 7];
const RANDOM_POOL = [42, 17, 63, 9, 55, 31, 4, 88, 26, 71, 13, 49, 2, 60, 38, 95];

export default function BTreeScene() {
  const idRef = useRef(0);
  const nextId = useCallback<IdGen>(() => ++idRef.current, []);

  const [tree, setTree] = useState<BNode>(() => makeLeaf(idRef.current));
  const [keys, setKeys] = useState<number[]>([]);
  const [capacity, setCapacity] = useState(3);
  const [mode, setMode] = useState<Mode>('insert');
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('Insert a key to grow the tree.');
  const [highlight, setHighlight] = useState<{ ids: Set<number>; kind: HighlightKind } | null>(
    null,
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [search, setSearch] = useState<SearchOutcome | null>(null);

  // Refs mirror state so the async insert/search loops never read stale values.
  const treeRef = useRef(tree);
  const capRef = useRef(capacity);
  const busyRef = useRef(false);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  useEffect(() => {
    capRef.current = capacity;
  }, [capacity]);

  const layout = useMemo(() => computeLayout(tree, capacity), [tree, capacity]);

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const commit = (root: BNode) => {
    treeRef.current = root;
    setTree(root);
  };

  /* --- insert a single key, optionally animating the descent --- */
  const insertOne = useCallback(
    async (key: number, animate: boolean) => {
      if (treeHasKey(treeRef.current, key)) {
        setStatus(`Key ${key} is already in the tree — B+-trees keep keys unique.`);
        return;
      }
      const beforeDepth = treeDepth(treeRef.current);

      if (animate) {
        const path = pathFor(treeRef.current, key);
        const acc = new Set<number>();
        for (const id of path) {
          acc.add(id);
          setHighlight({ ids: new Set(acc), kind: 'descend' });
          setStatus(`Descending to the right leaf for ${key}…`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(300);
        }
      }

      const root = insertKey(treeRef.current, key, capRef.current, nextId);
      const afterDepth = treeDepth(root);
      commit(root);
      setKeys((ks) => [...ks, key]);
      setFlashKey(key);

      if (afterDepth > beforeDepth) {
        setStatus(`Root overflowed → split, pushed median up, grew a new level (height ${afterDepth}).`);
      } else {
        setStatus(`Placed ${key} in its leaf, in sorted order.`);
      }
      if (animate) {
        await sleep(420);
        setHighlight(null);
      }
      setTimeout(() => setFlashKey(null), 600);
    },
    [nextId],
  );

  const handleInsertInput = async () => {
    if (busyRef.current) return;
    const key = parseInt(inputValue, 10);
    if (Number.isNaN(key) || key < 1 || key > 999) {
      setStatus('Enter a whole number between 1 and 999.');
      return;
    }
    setBusyBoth(true);
    setSearch(null);
    await insertOne(key, true);
    setInputValue('');
    setBusyBoth(false);
  };

  const insertMany = async (list: number[]) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setSearch(null);
    setHighlight(null);
    for (const k of list) {
      if (treeHasKey(treeRef.current, k)) continue;
      const root = insertKey(treeRef.current, k, capRef.current, nextId);
      commit(root);
      setKeys((ks) => [...ks, k]);
      setFlashKey(k);
      setStatus(`Inserting ${k}… (height ${treeDepth(root)})`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(190);
    }
    setStatus('Sequence inserted. Try search mode, or drop the capacity to force more splits.');
    setFlashKey(null);
    setBusyBoth(false);
  };

  const handleSearch = async () => {
    if (busyRef.current) return;
    const key = parseInt(inputValue, 10);
    if (Number.isNaN(key)) {
      setStatus('Enter a key to search for.');
      return;
    }
    setBusyBoth(true);
    setSearch(null);
    const path = pathFor(treeRef.current, key);
    const acc = new Set<number>();
    let visited = 0;
    for (const id of path) {
      acc.add(id);
      visited += 1;
      setHighlight({ ids: new Set(acc), kind: 'search' });
      setStatus(`Visiting node ${visited}…`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(360);
    }
    const found = leafForKey(treeRef.current, key).keys.includes(key);
    setSearch({ key, visited, found });
    setStatus(
      found
        ? `Found ${key} after visiting ${visited} node${visited === 1 ? '' : 's'}.`
        : `${key} is not in the tree — but we knew that after just ${visited} node${visited === 1 ? '' : 's'}.`,
    );
    setBusyBoth(false);
  };

  const handleCapacity = (v: number) => {
    if (busyRef.current) return;
    const cap = Math.max(2, Math.min(6, v));
    setCapacity(cap);
    capRef.current = cap;
    // Rebuild the tree under the new capacity from the same keys.
    idRef.current = 0;
    const root = buildTree(keys, cap, nextId);
    commit(root);
    setHighlight(null);
    setSearch(null);
    setStatus(`Max ${cap} keys per node — tree rebuilt. Smaller nodes split sooner.`);
  };

  const reset = () => {
    if (busyRef.current) return;
    idRef.current = 0;
    commit(makeLeaf(idRef.current));
    setKeys([]);
    setHighlight(null);
    setSearch(null);
    setFlashKey(null);
    setStatus('Cleared. Insert a key to grow the tree.');
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'insert') handleInsertInput();
      else handleSearch();
    }
  };

  const height = treeDepth(tree);

  return (
    <Figure
      number="4.3"
      caption="A B+-tree. Insert keys and watch nodes split and the tree grow; switch to search to count the nodes a lookup touches. Internal nodes route; leaves hold the keys (each a key → row-id entry). On a narrow screen, drag the tree sideways."
    >
      <div className="space-y-4">
        {/* legend + stats */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11px]">
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-fig-muted)' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${COLORS.internal}`, display: 'inline-block' }} />
            internal (router)
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-fig-muted)' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${COLORS.leaf}`, display: 'inline-block' }} />
            leaf (key → row-id)
          </span>
          <span style={{ color: 'var(--color-fig-muted)' }}>
            height <span className="font-semibold tabular-nums" style={{ color: 'var(--color-fig-fg)' }}>{height}</span>
            {' · '}keys <span className="font-semibold tabular-nums" style={{ color: 'var(--color-fig-fg)' }}>{keys.length}</span>
          </span>
        </div>

        {/* the tree — pans horizontally on narrow screens */}
        <div
          className="fig-card"
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
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
                  highlighted={highlight?.ids.has(p.node.id) ?? false}
                  kind={highlight?.kind ?? null}
                  flashKey={flashKey}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
            minHeight: 38,
          }}
        >
          {status}
          {search && (
            <span
              className="ml-2 font-semibold"
              style={{ color: search.found ? COLORS.leaf : 'var(--color-accent)' }}
            >
              · nodes visited: {search.visited}
            </span>
          )}
        </div>

        {/* mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('insert');
              setSearch(null);
              setHighlight(null);
            }}
            className={`fig-btn ${mode === 'insert' ? 'fig-btn-primary' : ''}`}
            aria-pressed={mode === 'insert'}
          >
            Insert
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('search');
              setHighlight(null);
            }}
            disabled={keys.length === 0}
            className={`fig-btn ${mode === 'search' ? 'fig-btn-primary' : ''}`}
            aria-pressed={mode === 'search'}
          >
            Search
          </button>
        </div>

        {/* free numeric input + action */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={mode === 'insert' ? 'key to insert' : 'key to find'}
            disabled={busy}
            className="font-mono text-[13px] rounded-md px-2.5 py-2"
            style={{
              width: 130,
              minHeight: 38,
              background: 'var(--color-fig-bg)',
              border: '1px solid rgba(0,0,0,0.18)',
              color: 'var(--color-fig-fg)',
            }}
            aria-label={mode === 'insert' ? 'key to insert' : 'key to search'}
          />
          {mode === 'insert' ? (
            <button
              type="button"
              onClick={handleInsertInput}
              disabled={busy}
              className="fig-btn fig-btn-primary"
              style={{ minHeight: 38 }}
            >
              Insert key
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSearch}
              disabled={busy || keys.length === 0}
              className="fig-btn fig-btn-primary"
              style={{ minHeight: 38 }}
            >
              Search key
            </button>
          )}
        </div>

        {/* presets */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => insertMany(PRESET_SEQUENCE)}
            disabled={busy}
            className="fig-btn"
          >
            Insert a sequence
          </button>
          <button
            type="button"
            onClick={() => insertMany(RANDOM_POOL.slice(0, 8))}
            disabled={busy}
            className="fig-btn"
          >
            Insert random
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="fig-btn fig-btn-danger"
          >
            Reset
          </button>
        </div>

        {/* capacity slider */}
        <div className="space-y-1.5 pt-1">
          <Slider
            label="max keys / node"
            min={2}
            max={6}
            step={1}
            value={capacity}
            onChange={handleCapacity}
          />
          <div className="font-sans text-[11px]" style={{ color: 'var(--color-fig-muted)' }}>
            A node holds at most {capacity} keys. The {capacity + 1}
            <sup>th</sup> overflows it and forces a split — smaller nodes split sooner, so the tree
            gets taller faster.
          </div>
        </div>
      </div>
    </Figure>
  );
}
