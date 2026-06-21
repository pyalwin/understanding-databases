import React from 'react';
import { Figure } from '@/components/scene';

type Status = 'ALLOWED' | 'PREVENTED' | 'SOMETIMES';

type Anomaly = {
  name: string;
  description: string;
  cells: Status[]; // length 5, ordered by level
};

const LEVELS = [
  'Read Uncommitted',
  'Read Committed',
  'Repeatable Read',
  'Snapshot',
  'Serializable',
];

const ANOMALIES: Anomaly[] = [
  {
    name: 'Dirty read',
    description: "T2 reads T1's uncommitted write",
    cells: ['ALLOWED', 'PREVENTED', 'PREVENTED', 'PREVENTED', 'PREVENTED'],
  },
  {
    name: 'Non-repeatable read',
    description: 'T1 reads twice, T2 commits between, T1 sees different values',
    cells: ['ALLOWED', 'ALLOWED', 'PREVENTED', 'PREVENTED', 'PREVENTED'],
  },
  {
    name: 'Phantom',
    description: "T1's range query sees rows T2 inserted mid-transaction",
    cells: ['ALLOWED', 'ALLOWED', 'SOMETIMES', 'PREVENTED', 'PREVENTED'],
  },
  {
    name: 'Lost update',
    description: 'Two read-modify-writes overwrite each other',
    cells: ['ALLOWED', 'ALLOWED', 'SOMETIMES', 'PREVENTED', 'PREVENTED'],
  },
  {
    name: 'Write skew',
    description:
      'Two transactions read overlapping data, write disjoint, break invariant',
    cells: ['ALLOWED', 'ALLOWED', 'ALLOWED', 'ALLOWED', 'PREVENTED'],
  },
];

function StatusCell({ status }: { status: Status }) {
  const config = {
    ALLOWED: {
      glyph: '✗',
      label: 'Allowed',
      color: 'var(--color-fig-red)',
      bg: 'rgba(169, 30, 30, 0.08)',
      border: 'rgba(169, 30, 30, 0.22)',
    },
    PREVENTED: {
      glyph: '✓',
      label: 'Prevented',
      color: 'var(--color-fig-green)',
      bg: 'rgba(47, 107, 58, 0.10)',
      border: 'rgba(47, 107, 58, 0.25)',
    },
    SOMETIMES: {
      glyph: '∼',
      label: 'Sometimes',
      color: 'var(--color-fig-orange)',
      bg: 'rgba(176, 74, 20, 0.10)',
      border: 'rgba(176, 74, 20, 0.25)',
    },
  }[status];

  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: '8px',
        padding: '12px 6px',
        minHeight: '76px',
      }}
    >
      <div
        className="font-serif leading-none"
        style={{
          fontFamily:
            '"Source Serif 4", "Source Serif Pro", Georgia, serif',
          fontSize: '1.75rem',
          fontWeight: 600,
          color: config.color,
        }}
        aria-hidden="true"
      >
        {config.glyph}
      </div>
      <div
        className="font-sans mt-2"
        style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: config.color,
        }}
      >
        {config.label}
      </div>
    </div>
  );
}

export default function IsolationMatrix() {
  return (
    <Figure
      number="3.7"
      caption={
        <>
          Each anomaly mapped to each isolation level.{' '}
          <strong style={{ color: 'var(--color-fig-red)' }}>ALLOWED</strong> = the
          level lets it happen.{' '}
          <strong style={{ color: 'var(--color-fig-green)' }}>PREVENTED</strong>{' '}
          = the level blocks it.{' '}
          <strong style={{ color: 'var(--color-fig-orange)' }}>SOMETIMES</strong>{' '}
          = it depends on the implementation. Note: Postgres calls SNAPSHOT
          &ldquo;REPEATABLE READ,&rdquo; and its SERIALIZABLE uses SSI.
        </>
      }
    >
      <div className="iso-matrix-wrap">
        <div className="iso-matrix">
          {/* Header row */}
          <div className="iso-corner" />
          {LEVELS.map((lvl) => (
            <div key={lvl} className="iso-col-header">
              {lvl}
            </div>
          ))}

          {/* Anomaly rows */}
          {ANOMALIES.map((a) => (
            <React.Fragment key={a.name}>
              <div className="iso-row-header">
                <div className="iso-row-name">{a.name}</div>
                <div className="iso-row-desc">{a.description}</div>
              </div>
              {a.cells.map((status, i) => (
                <StatusCell key={i} status={status} />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      <style>{`
        .iso-matrix-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 0 -4px;
        }
        .iso-matrix {
          display: grid;
          grid-template-columns:
            minmax(132px, 1.3fr)
            repeat(5, minmax(76px, 1fr));
          gap: 6px;
          padding: 4px;
        }
        .iso-corner {
          background: transparent;
        }
        .iso-col-header {
          font-family: var(--font-sans);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          color: var(--color-ink);
          padding: 6px 4px 10px;
          text-align: center;
          border-bottom: 1px solid var(--color-rule);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          line-height: 1.25;
        }
        .iso-row-header {
          padding: 12px 14px 12px 6px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          position: sticky;
          left: 0;
          background: var(--color-fig-bg);
          z-index: 2;
          border-right: 1px solid var(--color-rule);
        }
        .iso-row-name {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 600;
          color: var(--color-ink);
          line-height: 1.25;
        }
        .iso-row-desc {
          font-family: var(--font-sans);
          font-size: 11.5px;
          color: var(--color-ink-soft);
          line-height: 1.4;
          margin-top: 4px;
        }

        @media (max-width: 720px) {
          .iso-matrix {
            min-width: 560px;
            grid-template-columns:
              minmax(132px, 1.3fr)
              repeat(5, minmax(76px, 1fr));
          }
          .iso-row-header {
            /* Add a subtle shadow when scrolled so the sticky column reads as pinned */
            box-shadow: 6px 0 8px -6px rgba(0, 0, 0, 0.12);
          }
        }
      `}</style>
    </Figure>
  );
}
