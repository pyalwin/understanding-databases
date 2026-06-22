import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * VolcanoScene — Chapter 06 §2 (Figure 6.2).
 *
 * The iterator model made visceral. A fixed three-node tree, drawn vertically
 * (root at top):
 *
 *     Project[name]
 *        |
 *     Filter[age > 30]
 *        |
 *     SeqScan[users]
 *
 * One press of "pull next row" runs ONE root-level next(). The pull travels
 * DOWN the tree (Project asks Filter asks SeqScan), a leaf row is read, and —
 * if it passes the filter — it bubbles back UP, transformed at each level, and
 * is emitted at the root. Rows that fail the predicate are SKIPPED at the
 * Filter (a red flash) and the leaf is pulled again internally. One row is in
 * flight at a time.
 *
 * Vertical layout keeps it clean at 390px.
 */

interface Urow {
  id: number;
  name: string;
  age: number;
}

// Seeded so the filter visibly skips: pass / fail / fail / pass / pass / fail.
const USERS: Urow[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Lin', age: 28 },
  { id: 3, name: 'Omar', age: 19 },
  { id: 4, name: 'Grace', age: 45 },
  { id: 5, name: 'Wei', age: 52 },
  { id: 6, name: 'Sam', age: 24 },
];

const PASS = (r: Urow) => r.age > 30;

type NodeId = 'project' | 'filter' | 'scan';
type Phase = 'asking' | 'reading' | 'passing' | 'skipping' | 'emit' | null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Emitted {
  seq: number;
  name: string;
}

export default function VolcanoScene() {
  const [cursor, setCursor] = useState(0); // next leaf row to read
  const [active, setActive] = useState<NodeId | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [inFlight, setInFlight] = useState<Urow | null>(null);
  const [emitted, setEmitted] = useState<Emitted[]>([]);
  const [status, setStatus] = useState<string>(
    'Press "pull next row" — the root asks for one row.',
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const cursorRef = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  const reset = () => {
    if (busyRef.current) return;
    setCursor(0);
    cursorRef.current = 0;
    setActive(null);
    setPhase(null);
    setInFlight(null);
    setEmitted([]);
    setDone(false);
    setStatus('Press "pull next row" — the root asks for one row.');
  };

  const pull = useCallback(async () => {
    if (busyRef.current || done) return;
    busyRef.current = true;
    setBusy(true);

    // Pull travels DOWN: Project -> Filter -> Scan.
    setActive('project');
    setPhase('asking');
    setStatus('root: Project.next() — asks its child for a row…');
    await sleep(520);

    setActive('filter');
    setStatus('Filter.next() — asks the scan for a row…');
    await sleep(520);

    // Filter loops, pulling leaf rows until one passes (or DONE).
    let emittedThis = false;
    while (true) {
      const i = cursorRef.current;
      if (i >= USERS.length) {
        setActive('scan');
        setPhase('reading');
        setInFlight(null);
        setStatus('SeqScan.next() — no rows left → DONE. The pipeline drains.');
        await sleep(640);
        setDone(true);
        break;
      }
      const row = USERS[i];
      cursorRef.current = i + 1;
      setCursor(i + 1);

      setActive('scan');
      setPhase('reading');
      setInFlight(row);
      setStatus(`SeqScan reads row ${i + 1}: ${row.name}, age ${row.age}.`);
      await sleep(560);

      // Up to the Filter — does it pass?
      setActive('filter');
      if (PASS(row)) {
        setPhase('passing');
        setStatus(`Filter: ${row.age} > 30 ✓ — row passes, bubbles up.`);
        await sleep(560);
        emittedThis = true;
        break;
      } else {
        setPhase('skipping');
        setStatus(`Filter: ${row.age} > 30 ✗ — row dropped. Pull the leaf again…`);
        await sleep(640);
        setInFlight(null);
        // loop: internal re-pull, no row emitted yet
      }
    }

    if (emittedThis) {
      // Bubble up through Project to the root.
      setActive('project');
      setPhase('passing');
      const row = inFlightRef.current;
      setStatus(`Project keeps just [name] = ${row?.name}.`);
      await sleep(540);

      setPhase('emit');
      setStatus(`Root emits: ${row?.name}. One row out — that's a full next().`);
      setEmitted((prev) => [...prev, { seq: prev.length + 1, name: row?.name ?? '?' }]);
      await sleep(420);
    }

    setActive(null);
    setPhase(null);
    setInFlight(null);
    busyRef.current = false;
    setBusy(false);
  }, [done]);

  // Keep a ref of the in-flight row for the bubble-up phase.
  const inFlightRef = useRef<Urow | null>(null);
  useEffect(() => {
    inFlightRef.current = inFlight;
  }, [inFlight]);

  const nodeStyle = (id: NodeId) => {
    const on = active === id;
    let color = 'var(--color-fig-blue)';
    if (id === 'filter') color = 'var(--color-accent)';
    if (id === 'scan') color = 'var(--color-fig-green)';
    let ring = on ? color : 'transparent';
    if (on && phase === 'skipping' && id === 'filter') {
      ring = 'var(--color-fig-red)';
      color = 'var(--color-fig-red)';
    }
    if (on && phase === 'emit' && id === 'project') ring = 'var(--color-fig-green)';
    return { color, ring, on };
  };

  const NODES: { id: NodeId; title: string; detail: string; sub: string }[] = [
    { id: 'project', title: 'Project', detail: '[name]', sub: 'keep one column' },
    { id: 'filter', title: 'Filter', detail: '[age > 30]', sub: 'drop failing rows' },
    { id: 'scan', title: 'SeqScan', detail: '[users]', sub: 'read rows · leaf' },
  ];

  return (
    <Figure
      number="6.2"
      caption="The Volcano / iterator model. One press runs one root-level next(): the pull travels down (Project → Filter → SeqScan), a leaf row is read, and if it passes the filter it bubbles back up and the root emits it. Rows failing the predicate are skipped at the Filter (red) and the leaf is pulled again. One row is ever in flight — that's pipelining."
    >
      <div className="space-y-4">
        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color:
              phase === 'skipping'
                ? 'var(--color-fig-red)'
                : phase === 'emit'
                  ? 'var(--color-fig-green)'
                  : 'var(--color-fig-fg)',
            minHeight: 38,
          }}
        >
          {status}
        </div>

        {/* the vertical tree */}
        <div className="flex flex-col items-center gap-0">
          {NODES.map((n, idx) => {
            const st = nodeStyle(n.id);
            const showRowOnScan = n.id === 'scan' && inFlight && st.on;
            return (
              <React.Fragment key={n.id}>
                <motion.div
                  animate={st.on ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className="fig-card rounded-lg px-3 py-2 w-full max-w-[260px]"
                  style={{
                    border: `1.5px solid ${st.on ? st.ring : st.color}`,
                    boxShadow: st.on ? `0 0 0 3px ${st.ring}33` : '0 1px 2px rgba(0,0,0,0.06)',
                    background: 'var(--color-fig-bg)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="font-sans"
                      style={{
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        fontWeight: 700,
                        color: st.color,
                      }}
                    >
                      {n.title}{' '}
                      <span className="font-mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
                        {n.detail}
                      </span>
                    </span>
                    <span className="font-sans text-[10px] text-[color:var(--color-fig-muted)]">
                      {n.sub}
                    </span>
                  </div>
                  {/* the in-flight row, shown at the scan leaf when read */}
                  <AnimatePresence>
                    {showRowOnScan && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="font-mono text-[11px] tabular-nums mt-1.5 rounded px-1.5 py-0.5 inline-block"
                        style={{
                          color: 'var(--color-fig-fg)',
                          background: 'rgba(0,0,0,0.05)',
                        }}
                      >
                        {`{name: ${inFlight?.name}, age: ${inFlight?.age}}`}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* connector + flowing token between nodes */}
                {idx < NODES.length - 1 && (
                  <div className="relative h-9 w-px" style={{ background: 'rgba(0,0,0,0.18)' }}>
                    <AnimatePresence>
                      {active && (
                        <motion.span
                          key={`${active}-${phase}-${idx}`}
                          initial={{
                            opacity: 0,
                            top: phase === 'reading' || phase === 'asking' ? 0 : 28,
                          }}
                          animate={{ opacity: 1, top: 14 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="absolute -left-[5px] text-[11px]"
                          style={{
                            color:
                              phase === 'asking'
                                ? 'var(--color-fig-blue)'
                                : phase === 'skipping'
                                  ? 'var(--color-fig-red)'
                                  : 'var(--color-fig-green)',
                          }}
                        >
                          {phase === 'asking' ? '▼' : phase === 'reading' ? '▼' : '▲'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* emitted rows (root output) */}
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
            rows emitted at the root
          </div>
          <div
            className="fig-card rounded-md p-2 min-h-[44px] flex flex-wrap gap-1.5 items-center"
          >
            {emitted.length === 0 ? (
              <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                none yet — pull a row
              </span>
            ) : (
              <AnimatePresence initial={false}>
                {emitted.map((e) => (
                  <motion.span
                    key={e.seq}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="font-mono text-[12px] rounded px-1.5 py-0.5"
                    style={{
                      color: 'var(--color-fig-green)',
                      background: 'rgba(47,107,58,0.12)',
                      border: '1px solid var(--color-fig-green)',
                    }}
                  >
                    {e.name}
                  </motion.span>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={pull}
            disabled={busy || done}
            className="fig-btn fig-btn-primary"
          >
            {done ? 'pipeline drained' : '▶ pull next row'}
          </button>
          <button type="button" onClick={reset} disabled={busy} className="fig-btn">
            ⏮ Reset
          </button>
          <span className="font-sans text-[11px] text-[color:var(--color-fig-muted)] self-center">
            leaf cursor: {cursor}/{USERS.length}
          </span>
        </div>
      </div>
    </Figure>
  );
}
