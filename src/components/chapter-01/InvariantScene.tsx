import React from 'react';
import { useState } from 'react';
import { Figure, Slider } from '@/components/scene';

interface State { a: number; b: number; aRead?: number; bRead?: number; }
const INITIAL: State = { a: 100, b: 100 };

const OPS = [
  { label: 'read A.balance',  apply: (s: State) => ({ ...s, aRead: s.a }) },
  { label: 'read B.balance',  apply: (s: State) => ({ ...s, bRead: s.b }) },
  { label: 'write A -= 50',   apply: (s: State) => ({ ...s, a: s.a - 50 }) },
  { label: 'write B += 50',   apply: (s: State) => ({ ...s, b: s.b + 50 }) },
];

export function InvariantScene() {
  const [crashAfter, setCrashAfter] = useState<number>(OPS.length);

  let state: State = { ...INITIAL };
  for (let i = 0; i < crashAfter; i++) state = OPS[i].apply(state);
  const total = state.a + state.b;
  const broken = total !== INITIAL.a + INITIAL.b;

  return (
    <Figure
      number="1.3"
      caption="Transfer $50 from A to B. Drag the slider to crash after each operation. The total should always be 200 — when it isn't, the invariant has broken."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 font-mono text-sm">
          <div className="rounded-md border border-[color:var(--color-fig-muted)]/40 p-3">
            <div className="text-[10px] uppercase tracking-wider font-sans" style={{ color: 'var(--color-fig-blue)' }}>Account A</div>
            <div className="text-2xl mt-1">${state.a}</div>
          </div>
          <div className="rounded-md border border-[color:var(--color-fig-muted)]/40 p-3">
            <div className="text-[10px] uppercase tracking-wider font-sans" style={{ color: 'var(--color-fig-orange)' }}>Account B</div>
            <div className="text-2xl mt-1">${state.b}</div>
          </div>
        </div>
        <div className="font-sans text-xs">
          <ol className="space-y-1">
            {OPS.map((op, i) => (
              <li
                key={op.label}
                className={
                  'flex items-center gap-2 ' +
                  (i < crashAfter ? 'text-[color:var(--color-fig-green)]' : 'text-[color:var(--color-fig-muted)]/60 line-through')
                }
              >
                <span className="font-mono">{i + 1}.</span>
                <span>{op.label}</span>
                {i === crashAfter - 1 && crashAfter < OPS.length && (
                  <span className="ml-2 text-[color:var(--color-fig-red)]">← crash here</span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <Slider
          label="crash after step"
          min={0}
          max={OPS.length}
          step={1}
          value={crashAfter}
          onChange={setCrashAfter}
        />
        <div className="font-sans text-sm border-t border-[color:var(--color-fig-muted)]/30 pt-3">
          Total in system: <span className={broken ? 'text-[color:var(--color-fig-red)] font-semibold' : 'text-[color:var(--color-fig-green)] font-semibold'}>${total}</span>
          {broken && <span className="ml-2 text-[color:var(--color-fig-red)]">Invariant broken — money missing.</span>}
        </div>
      </div>
    </Figure>
  );
}
