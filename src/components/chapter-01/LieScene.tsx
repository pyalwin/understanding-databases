import React from 'react';
import { useState } from 'react';
import { Figure, Toggle } from '@/components/scene';

type Phase = 'idle' | 'wrote' | 'cached' | 'flushed' | 'crashed';

interface World {
  appSaid: string | null;
  pageCache: string | null;
  disk: string | null;
}

export function LieScene() {
  const [fsync, setFsync] = useState(false);
  const [world, setWorld] = useState<World>({ appSaid: null, pageCache: null, disk: null });
  const [phase, setPhase] = useState<Phase>('idle');

  const write = () => {
    const data = 'balance=200';
    if (fsync) {
      setWorld({ appSaid: 'saved!', pageCache: data, disk: data });
      setPhase('flushed');
    } else {
      setWorld({ appSaid: 'saved!', pageCache: data, disk: null });
      setPhase('cached');
    }
  };

  const crash = () => {
    setWorld((w) => ({ appSaid: w.appSaid, pageCache: null, disk: w.disk }));
    setPhase('crashed');
  };

  const reset = () => {
    setWorld({ appSaid: null, pageCache: null, disk: null });
    setPhase('idle');
  };

  return (
    <Figure
      number="1.4"
      caption="The app calls write() and prints 'saved!'. Without fsync, the bytes sit in the OS page cache; a crash erases them and the disk still holds the old value."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { name: 'App',        v: world.appSaid,  color: 'var(--color-fig-blue)' },
            { name: 'Page cache', v: world.pageCache,color: 'var(--color-fig-orange)' },
            { name: 'Disk',       v: world.disk,     color: 'var(--color-fig-green)' },
          ].map((layer) => (
            <div key={layer.name} className="rounded-md border border-[color:var(--color-fig-muted)]/40 p-3 min-h-[88px]">
              <div className="text-[10px] uppercase tracking-wider font-sans mb-1" style={{ color: layer.color }}>{layer.name}</div>
              <div className="font-mono text-sm">
                {layer.v ?? <span className="text-[color:var(--color-fig-muted)] italic">—</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Toggle label="fsync after write" value={fsync} onChange={setFsync} />
          <button
            type="button"
            onClick={write}
            className="px-3 py-1.5 text-xs font-sans rounded bg-[color:var(--color-fig-blue)] text-black"
          >write("balance=200")</button>
          <button
            type="button"
            onClick={crash}
            disabled={phase === 'idle'}
            className="px-3 py-1.5 text-xs font-sans rounded bg-[color:var(--color-fig-red)] text-black disabled:opacity-40"
          >pull the plug</button>
          <button
            type="button"
            onClick={reset}
            className="px-3 py-1.5 text-xs font-sans rounded bg-[color:var(--color-fig-muted)]/30"
          >reset</button>
        </div>
        {phase === 'cached' && (
          <p className="text-sm text-[color:var(--color-fig-fg)]">
            App said "saved!" — but the bytes are only in the page cache. Pull the plug and watch.
          </p>
        )}
        {phase === 'crashed' && (
          <p className="text-sm text-[color:var(--color-fig-red)]">
            {world.disk
              ? 'Recovered. Disk had the bytes because fsync ran before the crash.'
              : 'Data lost. The app lied. fsync was never called.'}
          </p>
        )}
      </div>
    </Figure>
  );
}
