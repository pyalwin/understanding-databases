import React from 'react';
import { Figure, StepThrough, type Step } from '@/components/scene';

type FileState = string[]; // list of user names

interface Frame {
  fileOnDisk: FileState;
  p1Memory: FileState | null;
  p2Memory: FileState | null;
  narration: string;
  status?: 'lost' | null;
}

const frames: Frame[] = [
  {
    fileOnDisk: ['Eve'],
    p1Memory: null,
    p2Memory: null,
    narration: 'The file starts with one user: Eve.',
  },
  {
    fileOnDisk: ['Eve'],
    p1Memory: ['Eve'],
    p2Memory: ['Eve'],
    narration: 'Both processes read the file. Each sees the same content.',
  },
  {
    fileOnDisk: ['Eve'],
    p1Memory: ['Eve', 'Ada'],
    p2Memory: ['Eve', 'Bob'],
    narration: 'P1 adds Ada in memory. P2 adds Bob in memory. Neither has written yet.',
  },
  {
    fileOnDisk: ['Eve', 'Ada'],
    p1Memory: ['Eve', 'Ada'],
    p2Memory: ['Eve', 'Bob'],
    narration: 'P1 writes its version of the file. Ada is on disk.',
  },
  {
    fileOnDisk: ['Eve', 'Bob'],
    p1Memory: ['Eve', 'Ada'],
    p2Memory: ['Eve', 'Bob'],
    narration: 'P2 writes its version. Ada is gone. The file is well-formed JSON, but Ada was lost.',
    status: 'lost',
  },
];

function Pane({ title, users, color }: { title: string; users: FileState | null; color: string }) {
  return (
    <div className="fig-card p-4 min-h-[120px]">
      <div className="text-[10px] uppercase tracking-[0.12em] font-sans font-semibold mb-3" style={{ color }}>{title}</div>
      {users ? (
        <ul className="font-mono text-sm space-y-1.5">
          {users.map((u) => <li key={u}><span className="opacity-40 mr-1">·</span>{u}</li>)}
        </ul>
      ) : (
        <p className="text-[color:var(--color-fig-muted)] text-xs italic opacity-70">empty · not yet read</p>
      )}
    </div>
  );
}

function FrameView({ frame }: { frame: Frame }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Pane title="P1 memory" users={frame.p1Memory} color="var(--color-fig-blue)" />
        <Pane title="users.json on disk" users={frame.fileOnDisk} color="var(--color-fig-fg)" />
        <Pane title="P2 memory" users={frame.p2Memory} color="var(--color-fig-orange)" />
      </div>
      <p className="text-sm text-[color:var(--color-fig-fg)] leading-relaxed">
        {frame.narration}
        {frame.status === 'lost' && (
          <span className="ml-2 text-[color:var(--color-fig-red)] font-semibold">Ada lost.</span>
        )}
      </p>
    </div>
  );
}

export function RaceScene() {
  const steps: Step[] = frames.map((f, i) => ({
    label: `t=${i}`,
    content: <FrameView frame={f} />,
  }));
  return (
    <Figure
      number="1.1"
      caption="Two processes interleave their read-modify-write on the same file. Drag the scrubber to walk through the timeline; the last frame is what ends up on disk."
    >
      <StepThrough steps={steps} />
    </Figure>
  );
}
