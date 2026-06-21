import React from 'react';
import { useState } from 'react';
import { Figure } from '@/components/scene';

type Choice = 'before' | 'after' | 'never';

interface ChoiceMeta {
  id: Choice;
  label: string;
  sub: string;
}

const CHOICES: ChoiceMeta[] = [
  {
    id: 'before',
    label: 'fsync before commit record',
    sub: 'the safe choice — Postgres default-ish',
  },
  {
    id: 'after',
    label: 'fsync after commit record',
    sub: 'the fast-but-risky choice',
  },
  {
    id: 'never',
    label: 'never fsync',
    sub: 'the catastrophe choice',
  },
];

type Verdict = 'good' | 'bad' | 'warn';

interface Row {
  id: Choice;
  safe: { v: string; tone: Verdict };
  corrupt: { v: string; tone: Verdict };
  fast: { v: string; tone: Verdict };
}

const ROWS: Row[] = [
  {
    id: 'before',
    safe:    { v: '✓',          tone: 'good' },
    corrupt: { v: 'no',         tone: 'good' },
    fast:    { v: 'slow',       tone: 'warn' },
  },
  {
    id: 'after',
    safe:    { v: '✗',          tone: 'bad' },
    corrupt: { v: 'yes',        tone: 'bad' },
    fast:    { v: 'fast',       tone: 'good' },
  },
  {
    id: 'never',
    safe:    { v: '✗',          tone: 'bad' },
    corrupt: { v: 'yes (always)', tone: 'bad' },
    fast:    { v: 'fastest',    tone: 'good' },
  },
];

const ROW_LABEL: Record<Choice, string> = {
  before: 'before',
  after:  'after',
  never:  'never',
};

function toneColor(t: Verdict): string {
  if (t === 'good') return 'var(--color-fig-green)';
  if (t === 'bad') return 'var(--color-fig-red)';
  return 'var(--color-fig-orange)';
}

export default function CommitRecordToggle() {
  const [choice, setChoice] = useState<Choice>('before');

  return (
    <Figure
      number="2.4"
      caption="Where you fsync decides what 'committed' means. Pick a strategy."
    >
      <div className="space-y-5">
        {/* Three-way radio */}
        <div
          role="radiogroup"
          aria-label="fsync placement"
          className="flex flex-col sm:flex-row gap-2"
        >
          {CHOICES.map((c) => {
            const active = c.id === choice;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChoice(c.id)}
                className={
                  'flex-1 text-left px-3 py-3 rounded-md border transition-colors ' +
                  (active
                    ? 'border-[color:var(--color-fig-fg)] bg-[color:var(--color-fig-fg)]/[0.06]'
                    : 'border-black/15 hover:bg-black/[0.03]')
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block w-3 h-3 rounded-full border"
                    style={{
                      borderColor: 'var(--color-fig-fg)',
                      background: active ? 'var(--color-fig-fg)' : 'transparent',
                    }}
                  />
                  <span className="font-sans text-[13px] font-semibold text-[color:var(--color-fig-fg)]">
                    {c.label}
                  </span>
                </div>
                <div className="font-sans text-[11px] mt-1 ml-5 text-[color:var(--color-fig-muted)]">
                  {c.sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* Outcome table — compact 3-col grid (works at 390px) */}
        <div className="overflow-hidden rounded-md border border-black/10">
          {/* header */}
          <div className="grid grid-cols-[1.1fr_0.6fr_0.9fr_0.8fr] gap-0 bg-black/[0.04] border-b border-black/10">
            <HeadCell>choice</HeadCell>
            <HeadCell center>safe?</HeadCell>
            <HeadCell center>corrupt on crash?</HeadCell>
            <HeadCell center>fast?</HeadCell>
          </div>

          {ROWS.map((row, i) => {
            const active = row.id === choice;
            return (
              <div
                key={row.id}
                className={
                  'grid grid-cols-[1.1fr_0.6fr_0.9fr_0.8fr] gap-0 ' +
                  (i < ROWS.length - 1 ? 'border-b border-black/10 ' : '') +
                  (active ? 'bg-[color:var(--color-fig-fg)]/[0.06]' : '')
                }
                aria-current={active ? 'true' : undefined}
              >
                <BodyCell>
                  <span className="font-mono text-[12px] text-[color:var(--color-fig-fg)]">
                    fsync {ROW_LABEL[row.id]}
                  </span>
                </BodyCell>
                <BodyCell center>
                  <span
                    className="font-mono text-[14px] font-semibold"
                    style={{ color: toneColor(row.safe.tone) }}
                  >
                    {row.safe.v}
                  </span>
                </BodyCell>
                <BodyCell center>
                  <span
                    className="font-mono text-[12px]"
                    style={{ color: toneColor(row.corrupt.tone) }}
                  >
                    {row.corrupt.v}
                  </span>
                </BodyCell>
                <BodyCell center>
                  <span
                    className="font-mono text-[12px]"
                    style={{ color: toneColor(row.fast.tone) }}
                  >
                    {row.fast.v}
                  </span>
                </BodyCell>
              </div>
            );
          })}
        </div>

        {/* db-tunables hint line */}
        <p className="font-sans text-[11.5px] text-[color:var(--color-fig-muted)] leading-snug">
          Every real database lets you tune this:{' '}
          <span className="font-mono text-[11px] text-[color:var(--color-fig-fg)]">
            synchronous_commit
          </span>{' '}
          (Postgres),{' '}
          <span className="font-mono text-[11px] text-[color:var(--color-fig-fg)]">
            innodb_flush_log_at_trx_commit
          </span>{' '}
          (MySQL),{' '}
          <span className="font-mono text-[11px] text-[color:var(--color-fig-fg)]">
            PRAGMA synchronous
          </span>{' '}
          (SQLite).
        </p>
      </div>
    </Figure>
  );
}

interface CellProps {
  children: React.ReactNode;
  center?: boolean;
}

function HeadCell({ children, center }: CellProps) {
  return (
    <div
      className={
        'px-2 py-2 font-sans text-[10px] uppercase tracking-[0.1em] font-semibold text-[color:var(--color-fig-muted)] ' +
        (center ? 'text-center' : '')
      }
    >
      {children}
    </div>
  );
}

function BodyCell({ children, center }: CellProps) {
  return (
    <div
      className={
        'px-2 py-2.5 flex items-center ' +
        (center ? 'justify-center' : 'justify-start')
      }
    >
      {children}
    </div>
  );
}
