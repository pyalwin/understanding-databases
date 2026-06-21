import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * ScanThrashScene — chapter 05 §4 (sequential flooding).
 *
 * A hot working set sits resident with a 100% hit rate. Then a single
 * sequential scan — more distinct pages than the pool can hold — sweeps
 * through. Under plain LRU each one-shot scan page is installed as
 * most-recently-used and evicts a genuinely hot page, so by the end the hot
 * set is gone and its hit rate has collapsed to zero.
 *
 * A toggle switches to a scan-resistant pool (the hot set is protected and the
 * scan is confined to a small ring — the trick Postgres uses for big seq
 * scans). There the hot set survives and its hit rate holds.
 *
 * The before/after hot-set hit rate is the focal point; the scan is a compact
 * progress bar. Single-column throughout, so 390px needs no special reflow.
 */

const POOL_SIZE = 4;
const HOT = ['H1', 'H2', 'H3'];                 // hot working set (fits the pool)
const SCAN = Array.from({ length: 12 }, (_, i) => `S${i + 1}`); // 12 one-shot pages

type Policy = 'lru' | 'resistant';
type Phase = 'ready' | 'scanning' | 'done';

const COLORS = {
  hot: 'var(--color-fig-green)',
  scan: 'var(--color-fig-blue)',
  good: 'var(--color-fig-green)',
  bad: 'var(--color-fig-red)',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isHot(label: string | null) {
  return !!label && label.startsWith('H');
}

/* warm the pool: hot set resident, MRU order = reverse of HOT */
function warmSlots(): (string | null)[] {
  const slots: (string | null)[] = Array(POOL_SIZE).fill(null);
  for (let i = 0; i < HOT.length; i++) slots[i] = HOT[i];
  return slots;
}
function warmRecency(): number[] {
  // recency over slot indices, MRU (front) -> LRU (back)
  return HOT.map((_, i) => i).reverse();
}

/* ------------------------------------------------------------------ */

interface SlotBoxProps {
  label: string | null;
  justChanged: boolean;
}

function SlotBox({ label, justChanged }: SlotBoxProps) {
  const hot = isHot(label);
  const border = label ? (hot ? COLORS.hot : COLORS.scan) : 'rgba(0,0,0,0.16)';
  const bg = hot ? 'rgba(47,107,58,0.10)' : label ? 'rgba(30,79,165,0.08)' : 'transparent';
  return (
    <motion.div
      animate={{ scale: justChanged ? [1, 1.08, 1] : 1 }}
      transition={{ duration: 0.35 }}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        minHeight: 52,
        borderRadius: 9,
        border: `2px ${label ? 'solid' : 'dashed'} ${border}`,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <span
        className="font-mono font-semibold"
        style={{ fontSize: 15, color: label ? (hot ? COLORS.hot : COLORS.scan) : 'var(--color-fig-muted)' }}
      >
        {label ?? '—'}
      </span>
      <span className="font-sans" style={{ fontSize: 9, color: 'var(--color-fig-muted)' }}>
        {hot ? 'hot' : label ? 'scan' : 'empty'}
      </span>
    </motion.div>
  );
}

interface RateBlockProps {
  title: string;
  rate: number | null;
  tone: 'good' | 'bad' | 'neutral';
}

function RateBlock({ title, rate, tone }: RateBlockProps) {
  const color = tone === 'good' ? COLORS.good : tone === 'bad' ? COLORS.bad : 'var(--color-fig-muted)';
  return (
    <div
      className="rounded-md px-3 py-2 flex-1"
      style={{
        background: tone === 'neutral' ? 'rgba(0,0,0,0.03)' : `${color}14`,
        border: `1px solid ${tone === 'neutral' ? 'rgba(0,0,0,0.10)' : `${color}55`}`,
      }}
    >
      <div
        className="font-sans font-semibold"
        style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-fig-muted)' }}
      >
        {title}
      </div>
      <div className="font-mono font-bold tabular-nums" style={{ fontSize: 26, lineHeight: 1.1, color }}>
        {rate === null ? '—' : `${rate}%`}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ScanThrashScene() {
  const [policy, setPolicy] = useState<Policy>('lru');
  const [slots, setSlots] = useState<(string | null)[]>(() => warmSlots());
  const [phase, setPhase] = useState<Phase>('ready');
  const [scanIdx, setScanIdx] = useState(0);
  const [afterRate, setAfterRate] = useState<number | null>(null);
  const [changedIdx, setChangedIdx] = useState<number | null>(null);
  const [status, setStatus] = useState('Hot set H1–H3 is resident. Launch the scan.');
  const [busy, setBusy] = useState(false);

  const recencyRef = useRef<number[]>(warmRecency());
  const slotsRef = useRef<(string | null)[]>(warmSlots());
  const busyRef = useRef(false);
  const policyRef = useRef<Policy>(policy);

  useEffect(() => {
    policyRef.current = policy;
  }, [policy]);

  const commitSlots = (next: (string | null)[]) => {
    slotsRef.current = next;
    setSlots(next);
  };

  const resetPool = useCallback(() => {
    if (busyRef.current) return;
    recencyRef.current = warmRecency();
    commitSlots(warmSlots());
    setPhase('ready');
    setScanIdx(0);
    setAfterRate(null);
    setChangedIdx(null);
    setStatus('Hot set H1–H3 is resident. Launch the scan.');
  }, []);

  /* one page request against the physical slots; returns true on hit */
  const touch = (label: string): boolean => {
    const cur = slotsRef.current.slice();
    const rec = recencyRef.current;
    const idx = cur.indexOf(label);
    if (idx >= 0) {
      // hit — promote slot to MRU
      recencyRef.current = [idx, ...rec.filter((s) => s !== idx)];
      return true;
    }
    // miss — pick a target slot
    let target = cur.indexOf(null);
    if (target < 0) {
      // evict: LRU slot that isn't protected (resistant pins the hot set)
      const protect = policyRef.current === 'resistant';
      for (let k = rec.length - 1; k >= 0; k--) {
        const si = rec[k];
        if (!(protect && isHot(cur[si]))) {
          target = si;
          break;
        }
      }
      if (target < 0) target = rec[rec.length - 1]; // all protected → fall back
    }
    cur[target] = label;
    commitSlots(cur);
    recencyRef.current = [target, ...rec.filter((s) => s !== target)];
    setChangedIdx(target);
    return false;
  };

  /* measure the hot-set hit rate without disturbing recency much */
  const measureHotRate = (): number => {
    let hits = 0;
    for (const h of HOT) {
      if (slotsRef.current.indexOf(h) >= 0) hits += 1;
    }
    return Math.round((100 * hits) / HOT.length);
  };

  const runScan = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    resetPoolSync();
    setPhase('scanning');
    setStatus(
      policyRef.current === 'lru'
        ? 'Scanning… each one-shot page evicts the least-recently-used hot page.'
        : 'Scanning… the hot set is protected; the scan cycles through one ring frame.',
    );
    for (let i = 0; i < SCAN.length; i++) {
      setScanIdx(i + 1);
      touch(SCAN[i]);
      // eslint-disable-next-line no-await-in-loop
      await sleep(360);
      setChangedIdx(null);
    }
    const rate = measureHotRate();
    setAfterRate(rate);
    setPhase('done');
    setStatus(
      policyRef.current === 'lru'
        ? `Scan done. The hot set was bulldozed out — its hit rate collapsed to ${rate}%.`
        : `Scan done. The hot set survived — its hit rate held at ${rate}%.`,
    );
    busyRef.current = false;
    setBusy(false);
  };

  // synchronous warm (used at the start of a scan run, bypassing the busy guard)
  const resetPoolSync = () => {
    recencyRef.current = warmRecency();
    commitSlots(warmSlots());
    setScanIdx(0);
    setAfterRate(null);
    setChangedIdx(null);
  };

  const switchPolicy = (p: Policy) => {
    if (busyRef.current) return;
    setPolicy(p);
    policyRef.current = p;
    resetPool();
  };

  const beforeRate = 100;
  const scanPct = Math.round((100 * scanIdx) / SCAN.length);
  const collapsed = phase === 'done' && policy === 'lru';

  return (
    <Figure
      number="5.3"
      caption="Sequential flooding. The hot set H1–H3 sits resident at a 100% hit rate; then a 12-page sequential scan (more pages than the pool holds) sweeps through. Under LRU every one-shot scan page evicts a hot page, and the hot-set hit rate collapses to 0%. Flip to the scan-resistant pool — the hot set is protected and the scan is confined to a ring — and the hot set survives."
    >
      <div className="space-y-4">
        {/* policy toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => switchPolicy('lru')}
            disabled={busy}
            className={`fig-btn ${policy === 'lru' ? 'fig-btn-primary' : ''}`}
            aria-pressed={policy === 'lru'}
          >
            Plain LRU
          </button>
          <button
            type="button"
            onClick={() => switchPolicy('resistant')}
            disabled={busy}
            className={`fig-btn ${policy === 'resistant' ? 'fig-btn-primary' : ''}`}
            aria-pressed={policy === 'resistant'}
          >
            Scan-resistant
          </button>
        </div>

        {/* before / after readout — the focal point */}
        <div className="flex gap-3">
          <RateBlock title="before scan" rate={beforeRate} tone="good" />
          <RateBlock
            title="after scan"
            rate={afterRate}
            tone={afterRate === null ? 'neutral' : collapsed ? 'bad' : 'good'}
          />
        </div>

        {/* the pool */}
        <div className="fig-card" style={{ padding: 12 }}>
          <div
            className="font-sans font-semibold mb-2"
            style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-fig-muted)' }}
          >
            buffer pool · {POOL_SIZE} frames
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {slots.map((label, i) => (
              <SlotBox key={i} label={label} justChanged={changedIdx === i} />
            ))}
          </div>
        </div>

        {/* scan progress */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span
              className="font-sans font-semibold"
              style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-fig-muted)' }}
            >
              sequential scan
            </span>
            <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--color-fig-muted)' }}>
              {scanIdx} / {SCAN.length} pages
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 5, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <motion.div
              animate={{ width: `${scanPct}%` }}
              transition={{ ease: 'linear', duration: 0.3 }}
              style={{ height: '100%', background: COLORS.scan }}
            />
          </div>
        </div>

        {/* status */}
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
        </div>

        {/* controls */}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={runScan} disabled={busy} className="fig-btn fig-btn-primary">
            ▶ Run sequential scan
          </button>
          <button type="button" onClick={resetPool} disabled={busy} className="fig-btn">
            ⏮ Reset pool
          </button>
        </div>
      </div>
    </Figure>
  );
}
