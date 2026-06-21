import React from 'react';
import { Figure } from '@/components/scene';

type Panel = {
  letter: 'A' | 'C' | 'D' | 'I';
  word: string;
  body: React.ReactNode;
  deferred?: boolean;
};

const panels: Panel[] = [
  {
    letter: 'A',
    word: 'Atomicity',
    body: (
      <>
        The <strong>commit record</strong>. Either it's fsynced in the log, or
        the transaction never happened.
      </>
    ),
  },
  {
    letter: 'D',
    word: 'Durability',
    body: (
      <>
        The <strong>fsync on the log file</strong> before we acknowledge the
        user.
      </>
    ),
  },
  {
    letter: 'C',
    word: 'Consistency',
    body: (
      <>
        The invariant holds end-to-end because <strong>either both file
        updates are replayed or neither is</strong>.
      </>
    ),
  },
  {
    letter: 'I',
    word: 'Isolation',
    body: <>Two transactions in the same room. Not yet.</>,
    deferred: true,
  },
];

export default function TransactionSynthesis() {
  return (
    <Figure
      number="2.5"
      caption="ACID, mapped to the mechanism. Isolation is the next chapter."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {panels.map((p) => (
          <div
            key={p.letter}
            className="fig-card p-5 flex flex-col"
            style={{
              opacity: p.deferred ? 0.55 : 1,
              minHeight: '170px',
            }}
          >
            <div
              className="font-serif leading-none"
              style={{
                fontFamily:
                  '"Source Serif 4", "Source Serif Pro", Georgia, serif',
                fontSize: '3.25rem',
                fontWeight: 600,
                color: p.deferred
                  ? 'var(--color-ink-soft)'
                  : 'var(--color-accent)',
              }}
            >
              {p.letter}
            </div>
            <div
              className="font-sans text-sm font-semibold mt-1"
              style={{
                color: p.deferred
                  ? 'var(--color-ink-soft)'
                  : 'var(--color-fig-fg)',
              }}
            >
              {p.word}
            </div>
            <div
              className="font-sans text-[13px] mt-3 leading-snug"
              style={{
                color: p.deferred
                  ? 'var(--color-ink-soft)'
                  : 'var(--color-fig-muted)',
              }}
            >
              {p.body}
            </div>
            {p.deferred && (
              <div className="mt-4">
                <span
                  className="inline-block font-sans text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full"
                  style={{
                    backgroundColor: 'var(--color-fig-blue, #cfe0ef)',
                    color: 'var(--color-fig-fg)',
                    opacity: 0.9,
                    letterSpacing: '0.04em',
                  }}
                >
                  Chapter 03 &rarr;
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 720px) {
          figure .fig-card { min-height: 0 !important; }
        }
      `}</style>
    </Figure>
  );
}
