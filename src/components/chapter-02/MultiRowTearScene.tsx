import React from 'react';
import { useState } from 'react';
import { Figure, Slider } from '@/components/scene';

// Initial published balances on disk.
const A0 = 100;
const B0 = 50;
const AMOUNT = 50;
// After a successful transfer.
const A1 = A0 - AMOUNT; // 50
const B1 = B0 + AMOUNT; // 100

// The four-step "transfer" sequence. Step N (1-indexed) mutates one disk
// artifact. tmp writes create a side file; renames publish it.
//
//   1. write  a.json.tmp  (new Alice balance staged on disk)
//   2. rename a.json.tmp -> a.json
//   3. write  b.json.tmp  (new Bob balance staged on disk)
//   4. rename b.json.tmp -> b.json
const STEPS = [
  { label: 'write a.json.tmp' },
  { label: 'rename a.json.tmp → a.json' },
  { label: 'write b.json.tmp' },
  { label: 'rename b.json.tmp → b.json' },
];

interface DiskState {
  a: number;       // published a.json balance
  b: number;       // published b.json balance
  aTmp: number | null;
  bTmp: number | null;
}

function diskAfter(completed: number): DiskState {
  // completed ∈ [0, 4]: how many of the four ops survived the crash
  let s: DiskState = { a: A0, b: B0, aTmp: null, bTmp: null };
  if (completed >= 1) s = { ...s, aTmp: A1 };
  if (completed >= 2) s = { ...s, a: A1, aTmp: null }; // rename consumes tmp
  if (completed >= 3) s = { ...s, bTmp: B1 };
  if (completed >= 4) s = { ...s, b: B1, bTmp: null };
  return s;
}

export default function MultiRowTearScene() {
  // Slider semantics (per spec):
  //   value 0 = no crash (all four steps complete)
  //   value N ∈ 1..4 = crash AFTER step N completes
  // Note: value 4 is equivalent to value 0 on disk; both leave all four ops
  // applied. We keep both positions because the slider's purpose is to let
  // the reader scrub through the timeline, not to enumerate unique states.
  const [crashAfter, setCrashAfter] = useState<number>(0);

  const completed = crashAfter === 0 ? STEPS.length : crashAfter;
  const disk = diskAfter(completed);

  const beforeTotal = A0 + B0;            // $150 — what we started with
  const afterTotal = disk.a + disk.b;     // what the published files now sum to
  const conserved = afterTotal === beforeTotal;

  const reset = () => setCrashAfter(0);

  return (
    <Figure
      number="2.2"
      caption="Transfer $50 from Alice to Bob with tmp+rename, twice. Drag the crash slider to find the position where money vanishes."
    >
      <div className="space-y-5">
        {/* Account cards. Two columns on >=720px, stacked below. */}
        <div className="grid grid-cols-1 [@media(min-width:720px)]:grid-cols-2 gap-3 font-mono text-sm">
          <AccountCard
            file="a.json"
            who="Alice"
            balance={disk.a}
            tmp={disk.aTmp}
            tmpName="a.json.tmp"
            accent="var(--color-fig-blue)"
          />
          <AccountCard
            file="b.json"
            who="Bob"
            balance={disk.b}
            tmp={disk.bTmp}
            tmpName="b.json.tmp"
            accent="var(--color-fig-orange)"
          />
        </div>

        {/* Four-step timeline. Pills wrap; greyed past the crash. */}
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-2">
            Timeline
          </div>
          <ol className="flex flex-wrap gap-2 list-none p-0 m-0">
            {STEPS.map((step, i) => {
              const stepNum = i + 1;
              const done = stepNum <= completed;
              const isCrashStep = crashAfter !== 0 && stepNum === crashAfter;
              return (
                <li
                  key={step.label}
                  className={
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-sans whitespace-nowrap ' +
                    (done
                      ? 'border-[color:var(--color-fig-green)]/50 text-[color:var(--color-fig-green)] bg-[color:var(--color-fig-green)]/5'
                      : 'border-[color:var(--color-fig-muted)]/30 text-[color:var(--color-fig-muted)]/70')
                  }
                >
                  <span className="font-mono tabular-nums">{stepNum}.</span>
                  <span className="font-mono">{step.label}</span>
                  {isCrashStep && (
                    <span
                      className="ml-1 font-sans"
                      style={{ color: 'var(--color-fig-red)' }}
                      aria-label="crash point"
                    >
                      ← crash
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Totals + conservation check. */}
        <div className="border-t border-[color:var(--color-fig-muted)]/30 pt-3 font-sans text-sm space-y-1">
          <div>
            <span className="text-[color:var(--color-fig-muted)]">Before:</span>{' '}
            <span className="font-mono tabular-nums">${beforeTotal}</span>
            <span className="text-[color:var(--color-fig-muted)]"> &nbsp;·&nbsp; After:</span>{' '}
            <span
              className="font-mono tabular-nums font-semibold"
              style={{ color: conserved ? 'var(--color-fig-green)' : 'var(--color-fig-red)' }}
            >
              ${afterTotal}
            </span>
          </div>
          <div
            className="text-xs"
            style={{ color: conserved ? 'var(--color-fig-green)' : 'var(--color-fig-red)' }}
          >
            {conserved ? '✓ $150 conserved' : `$${beforeTotal - afterTotal} vanished`}
          </div>
        </div>

        {/* Crash slider + reset. */}
        <div className="space-y-2">
          <Slider
            label="crash after step"
            min={0}
            max={STEPS.length}
            step={1}
            value={crashAfter}
            onChange={setCrashAfter}
          />
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="fig-btn">
              Reset
            </button>
          </div>
        </div>
      </div>
    </Figure>
  );
}

interface CardProps {
  file: string;
  who: string;
  balance: number;
  tmp: number | null;
  tmpName: string;
  accent: string;
}

function AccountCard({ file, who, balance, tmp, tmpName, accent }: CardProps) {
  return (
    <div className="fig-card p-4">
      <div
        className="text-[10px] uppercase tracking-[0.12em] font-sans font-semibold flex items-center justify-between"
        style={{ color: accent }}
      >
        <span>{file}</span>
        <span className="text-[color:var(--color-fig-muted)] normal-case tracking-normal font-normal">
          {who}
        </span>
      </div>
      <div className="text-2xl mt-1 tabular-nums">${balance}</div>
      <div className="mt-2 text-[11px] font-sans text-[color:var(--color-fig-muted)] min-h-[1.25rem]">
        {tmp !== null ? (
          <span>
            <span className="font-mono">{tmpName}</span> staged: <span className="font-mono tabular-nums">${tmp}</span>
          </span>
        ) : (
          <span className="opacity-40">no tmp file</span>
        )}
      </div>
    </div>
  );
}
