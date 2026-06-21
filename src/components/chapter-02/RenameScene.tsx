import React from 'react';
import { useMemo, useState } from 'react';
import { Figure } from '@/components/scene';

type Phase = 'start' | 'after-write' | 'after-rename';
type Crash = null | 'before-rename';

const OLD_CONTENT = '[\n  {"id": 1, "name": "Alice"}\n]';
const NEW_CONTENT =
  '[\n  {"id": 1, "name": "Alice"},\n  {"id": 2, "name": "Bob"}\n]';
// A half-written tmp: bytes were partway through when the process died.
const PARTIAL_TMP = '[\n  {"id": 1, "name": "Alice"},\n  {"id": 2, "na';

const STEP_LABELS: Record<Phase, string> = {
  'start': 'step 0 of 2 · only users.json exists',
  'after-write': 'step 1 of 2 · users.json.tmp written, not yet renamed',
  'after-rename': 'step 2 of 2 · rename complete, atomic publish',
};

const CRASH_LABEL =
  'crashed before rename · users.json untouched, users.json.tmp is garbage';

interface FileCardProps {
  name: string;
  content: string;
  exists: boolean;
  tone?: 'normal' | 'old' | 'new' | 'partial';
  note?: string;
}

function FileCard({ name, content, exists, tone = 'normal', note }: FileCardProps) {
  const toneColor =
    tone === 'new'
      ? 'var(--color-fig-green)'
      : tone === 'partial'
      ? 'var(--color-fig-red)'
      : tone === 'old'
      ? 'var(--color-fig-muted)'
      : 'var(--color-fig-fg)';

  return (
    <div
      className="fig-card p-3 flex-1 min-w-0"
      style={{ opacity: exists ? 1 : 0.35 }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="font-mono text-[12px] text-[color:var(--color-fig-fg)] break-all">
          {name}
        </div>
        <div className="font-sans text-[10px] uppercase tracking-wider text-[color:var(--color-fig-muted)] shrink-0">
          {exists ? 'on disk' : 'does not exist'}
        </div>
      </div>
      {exists ? (
        <pre
          className="font-mono text-[12.5px] whitespace-pre-wrap break-all m-0"
          style={{ color: toneColor }}
        >
          {content}
        </pre>
      ) : (
        <div className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)] py-2">
          (no file yet)
        </div>
      )}
      {note && (
        <div className="font-sans text-[11px] mt-2 text-[color:var(--color-fig-muted)]">
          {note}
        </div>
      )}
    </div>
  );
}

export default function RenameScene() {
  const [phase, setPhase] = useState<Phase>('start');
  const [crash, setCrash] = useState<Crash>(null);

  const next = () => {
    if (crash) return;
    if (phase === 'start') setPhase('after-write');
    else if (phase === 'after-write') setPhase('after-rename');
  };

  const reset = () => {
    setPhase('start');
    setCrash(null);
  };

  const crashHere = () => {
    if (phase === 'after-write') setCrash('before-rename');
  };

  const view = useMemo(() => {
    if (crash === 'before-rename') {
      return {
        usersExists: true,
        usersContent: OLD_CONTENT,
        usersTone: 'old' as const,
        usersNote: 'still the OLD content — rename never happened',
        tmpExists: true,
        tmpContent: PARTIAL_TMP,
        tmpTone: 'partial' as const,
        tmpNote: 'half-written bytes — not valid JSON, will be cleaned up',
        status: CRASH_LABEL,
        statusTone: 'crash' as const,
      };
    }
    if (phase === 'start') {
      return {
        usersExists: true,
        usersContent: OLD_CONTENT,
        usersTone: 'normal' as const,
        usersNote: undefined,
        tmpExists: false,
        tmpContent: '',
        tmpTone: 'normal' as const,
        tmpNote: undefined,
        status: STEP_LABELS['start'],
        statusTone: 'normal' as const,
      };
    }
    if (phase === 'after-write') {
      return {
        usersExists: true,
        usersContent: OLD_CONTENT,
        usersTone: 'old' as const,
        usersNote: 'unchanged — still the only file readers see',
        tmpExists: true,
        tmpContent: NEW_CONTENT,
        tmpTone: 'new' as const,
        tmpNote: 'fully written, fsynced, ready to publish',
        status: STEP_LABELS['after-write'],
        statusTone: 'normal' as const,
      };
    }
    return {
      usersExists: true,
      usersContent: NEW_CONTENT,
      usersTone: 'new' as const,
      usersNote: 'rename swapped it atomically',
      tmpExists: false,
      tmpContent: '',
      tmpTone: 'normal' as const,
      tmpNote: undefined,
      status: STEP_LABELS['after-rename'],
      statusTone: 'done' as const,
    };
  }, [phase, crash]);

  const canStep = !crash && phase !== 'after-rename';
  const canCrash = !crash && phase === 'after-write';

  const statusColor =
    view.statusTone === 'crash'
      ? 'var(--color-fig-red)'
      : view.statusTone === 'done'
      ? 'var(--color-fig-green)'
      : 'var(--color-fig-muted)';

  return (
    <Figure
      number="2.1"
      caption="Atomic publish via tmp + rename. Step through the writer; at step 1, pick whether the process crashes before the rename."
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <FileCard
            name="users.json"
            content={view.usersContent}
            exists={view.usersExists}
            tone={view.usersTone}
            note={view.usersNote}
          />
          <FileCard
            name="users.json.tmp"
            content={view.tmpContent}
            exists={view.tmpExists}
            tone={view.tmpTone}
            note={view.tmpNote}
          />
        </div>

        <div
          className="font-sans text-[12px] font-medium"
          style={{ color: statusColor }}
        >
          {view.status}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={next}
            disabled={!canStep}
            className="fig-btn fig-btn-primary"
          >
            ▶ Step
          </button>
          <button
            type="button"
            onClick={crashHere}
            disabled={!canCrash}
            className="fig-btn fig-btn-danger"
            title={
              canCrash
                ? 'Kill the process between write and rename'
                : 'Only available after the tmp file is written'
            }
          >
            💥 Crash here
          </button>
          <button type="button" onClick={reset} className="fig-btn">
            ⏮ Reset
          </button>
        </div>
      </div>
    </Figure>
  );
}
