import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * WriteSkewScene — chapter 09, Figure 9.3 (§5 write skew).
 *
 * Snapshot isolation's one famous hole. Two doctors, alice and bob, are both on
 * call; the hospital invariant is "at least one doctor on call". Two
 * transactions take snapshots at the same instant — each sees BOTH on call, so
 * each concludes it is safe to step out. They remove DIFFERENT doctors:
 *
 *   T1, T2 begin (both snapshots see alice on, bob on -> 2 on call -> safe)
 *   T1 takes alice off call -> commit
 *   T2 takes bob   off call -> commit      (a DIFFERENT row: no write-write conflict)
 *   settle -> nobody on call: the invariant is broken
 *
 * Because the two writes touch different rows, first-committer-wins never fires
 * — both commit cleanly, and together they violate an invariant neither broke
 * alone. The scene shows each txn's snapshot view (both "safe") beside the real
 * committed roster, which ends both-red. A banner makes the violation
 * unmistakable. Cream palette; the two snapshot panels stack at 390px.
 */

type Tid = 'T1' | 'T2';
const MUTED = 'var(--color-fig-muted)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const RED = 'var(--color-fig-red)';
const ACCENT = 'var(--color-fig-orange)';

type Doc = 'alice' | 'bob';
const DOCS: Doc[] = ['alice', 'bob'];

interface Roster {
  alice: boolean; // true = on call
  bob: boolean;
}

interface TxnView {
  status: 'idle' | 'active' | 'committed';
  snap: Roster | null; // what this txn sees from its snapshot (null = not begun)
  decision: string | null; // its local reasoning
  removes: Doc | null; // the doctor it takes off call
}

interface Frame {
  note: string;
  phase: string;
  actual: Roster; // the real committed roster
  t1: TxnView;
  t2: TxnView;
  violated: boolean;
  acting: Tid | null; // which txn just acted (pulse)
}

const ON = (r: Roster): Doc[] => DOCS.filter((d) => r[d]);

function buildFrames(): Frame[] {
  const bothOn: Roster = { alice: true, bob: true };
  const frames: Frame[] = [];

  // 0 — idle: both on call
  frames.push({
    note: 'Two doctors, alice and bob, are both on call. The hospital invariant: at least one must stay on call. Press Play to let two transactions each try to step out.',
    phase: 'idle',
    actual: { ...bothOn },
    t1: { status: 'idle', snap: null, decision: null, removes: null },
    t2: { status: 'idle', snap: null, decision: null, removes: null },
    violated: false,
    acting: null,
  });

  // 1 — both begin, take the same snapshot
  frames.push({
    note: 'T1 and T2 begin at the same instant. Each takes a snapshot of the roster — and each sees the SAME thing: alice on, bob on. Two on call.',
    phase: 'begin',
    actual: { ...bothOn },
    t1: { status: 'active', snap: { ...bothOn }, decision: null, removes: null },
    t2: { status: 'active', snap: { ...bothOn }, decision: null, removes: null },
    violated: false,
    acting: null,
  });

  // 2 — both check the invariant locally → both decide "safe"
  frames.push({
    note: 'Each checks the invariant against its own snapshot: 2 on call, so removing ONE still leaves one. Both independently conclude it is safe to go off call.',
    phase: 'check',
    actual: { ...bothOn },
    t1: { status: 'active', snap: { ...bothOn }, decision: '2 on call → safe', removes: null },
    t2: { status: 'active', snap: { ...bothOn }, decision: '2 on call → safe', removes: null },
    violated: false,
    acting: null,
  });

  // 3 — T1 removes alice, commits
  frames.push({
    note: 'T1 takes alice off call and commits. Its snapshot said two were on, so locally the invariant still holds. The real roster now has only bob.',
    phase: 't1',
    actual: { alice: false, bob: true },
    t1: { status: 'committed', snap: { ...bothOn }, decision: '2 on call → safe', removes: 'alice' },
    t2: { status: 'active', snap: { ...bothOn }, decision: '2 on call → safe', removes: null },
    violated: false,
    acting: 'T1',
  });

  // 4 — T2 removes bob, commits (different row → no conflict)
  frames.push({
    note: 'T2 still sees its own snapshot (alice on, bob on) and takes bob off call. A DIFFERENT row from alice, so there is no write-write conflict — first-committer-wins never fires. T2 commits.',
    phase: 't2',
    actual: { alice: false, bob: false },
    t1: { status: 'committed', snap: { ...bothOn }, decision: '2 on call → safe', removes: 'alice' },
    t2: { status: 'committed', snap: { ...bothOn }, decision: '2 on call → safe', removes: 'bob' },
    violated: true,
    acting: 'T2',
  });

  // 5 — settle: invariant violated
  frames.push({
    note: 'Both committed cleanly, yet nobody is on call. Each transaction preserved the invariant against its own snapshot — together they broke it. This is write skew: two reads, two writes to different rows, one shattered invariant.',
    phase: 'violated',
    actual: { alice: false, bob: false },
    t1: { status: 'committed', snap: { ...bothOn }, decision: '2 on call → safe', removes: 'alice' },
    t2: { status: 'committed', snap: { ...bothOn }, decision: '2 on call → safe', removes: 'bob' },
    violated: true,
    acting: null,
  });

  return frames;
}

/* doctor chip: green when on call, red/empty when off */
function DocChip({ name, on, dim }: { name: Doc; on: boolean; dim?: boolean }) {
  return (
    <motion.span
      layout
      animate={{
        background: on ? `${GREEN}1a` : `${RED}1a`,
        borderColor: on ? `${GREEN}88` : RED,
      }}
      transition={{ duration: 0.4 }}
      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[12.5px]"
      style={{
        border: `1px solid ${on ? `${GREEN}88` : RED}`,
        color: 'var(--color-fig-fg)',
        opacity: dim ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: on ? GREEN : RED,
          display: 'inline-block',
        }}
      />
      <span style={{ fontWeight: 700 }}>{name}</span>
      <span style={{ color: on ? GREEN : RED, fontWeight: 600 }}>{on ? 'on call' : 'off'}</span>
    </motion.span>
  );
}

function SnapshotPanel({ id, view, pulse }: { id: Tid; view: TxnView; pulse: boolean }) {
  const begun = view.snap !== null;
  const color = view.status === 'committed' ? BLUE : begun ? GREEN : MUTED;
  return (
    <motion.div
      layout
      animate={pulse ? { scale: [1, 1.03, 1] } : { scale: 1 }}
      transition={{ duration: 0.6, repeat: pulse ? Infinity : 0 }}
      className="fig-card"
      style={{ flex: 1, minWidth: 0, borderColor: `${color}66`, padding: '10px 12px' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-bold" style={{ color: 'var(--color-fig-fg)' }}>
          {id}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold font-sans"
          style={{ background: 'var(--color-fig-bg)', border: `1px solid ${color}`, color }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, background: color, display: 'inline-block' }} />
          {view.status === 'idle' ? 'idle' : view.status === 'active' ? 'running' : 'committed'}
        </span>
      </div>

      <div className="mt-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        its snapshot
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {begun ? (
          DOCS.map((d) => <DocChip key={d} name={d} on={view.snap![d]} />)
        ) : (
          <span className="font-mono text-[12px]" style={{ color: MUTED }}>
            — not begun —
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] font-sans" style={{ color: MUTED }}>
        <span>decision</span>
        <span
          className="font-mono"
          style={{
            padding: '1px 7px',
            borderRadius: 5,
            background: view.decision ? `${GREEN}14` : 'transparent',
            border: view.decision ? `1px solid ${GREEN}66` : '1px solid transparent',
            color: view.decision ? 'var(--color-fig-fg)' : MUTED,
            fontWeight: 600,
          }}
        >
          {view.decision ?? '—'}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-sans" style={{ color: MUTED }}>
        <span>takes off call</span>
        {view.removes ? (
          <span
            className="font-mono"
            style={{
              padding: '1px 7px',
              borderRadius: 5,
              background: `${RED}14`,
              border: `1px solid ${RED}66`,
              color: 'var(--color-fig-fg)',
              fontWeight: 700,
            }}
          >
            {view.removes}
          </span>
        ) : (
          <span className="font-mono" style={{ color: MUTED }}>
            —
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default function WriteSkewScene() {
  const frames = useMemo(() => buildFrames(), []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 1100 - speed * 140;
    const t = setTimeout(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [playing, idx, speed, frames.length]);

  const play = () => {
    if (atEnd) setIdx(0);
    setPlaying(true);
  };
  const step = () => {
    setPlaying(false);
    setIdx((i) => Math.min(i + 1, frames.length - 1));
  };
  const reset = () => {
    setPlaying(false);
    setIdx(0);
  };

  const liveOnCall = ON(frame.actual);

  return (
    <Figure
      number="9.3"
      caption="Write skew — the anomaly snapshot isolation cannot catch. The invariant is 'at least one doctor on call'. T1 and T2 begin together; each snapshot shows alice and bob both on call, so each independently judges it safe to step out. T1 removes alice, T2 removes bob — different rows, so there is no write-write conflict and both commit. Together they leave nobody on call: an invariant neither broke alone. Serializable isolation (SSI) would catch it by tracking read-write dependencies across rows, not just write-write. The snapshot panels stack at narrow widths."
    >
      <div className="space-y-4">
        {/* phase pill */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.violated ? RED : 'rgba(0,0,0,0.14)'}`,
              color: frame.violated ? RED : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.violated ? RED : ACCENT,
                display: 'inline-block',
              }}
            />
            {frame.violated ? 'invariant broken' : frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* the real committed roster */}
        <div className="fig-card" style={{ padding: '12px 14px' }}>
          <div
            className="mb-2 flex items-center justify-between font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: MUTED }}
          >
            <span>actual committed roster</span>
            <span
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{
                background: frame.violated ? `${RED}14` : `${GREEN}14`,
                border: `1px solid ${frame.violated ? RED : `${GREEN}66`}`,
                color: frame.violated ? RED : GREEN,
              }}
            >
              {liveOnCall.length} on call
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {DOCS.map((d) => (
              <DocChip key={d} name={d} on={frame.actual[d]} />
            ))}
          </div>

          {frame.violated && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="mt-3 rounded-md px-3 py-2 font-sans text-[12.5px] font-semibold"
              style={{ background: `${RED}14`, border: `1px solid ${RED}`, color: RED }}
            >
              ⚠ INVARIANT VIOLATED — nobody is on call. Both transactions committed
              cleanly under snapshot isolation.
            </motion.div>
          )}
        </div>

        {/* the two snapshots side by side */}
        <div className="flex flex-col sm:flex-row gap-3">
          <SnapshotPanel id="T1" view={frame.t1} pulse={frame.acting === 'T1'} />
          <SnapshotPanel id="T2" view={frame.t2} pulse={frame.acting === 'T2'} />
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
            minHeight: 58,
          }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {atEnd ? 'Replay' : idx === 0 ? 'Play' : 'Resume'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
        </div>

        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
