import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Figure, Slider } from '@/components/scene';

const FULL =
  '{"id":42,"name":"Ada Lovelace","email":"ada@analyt.eng","role":"engineer"}';
const TOTAL = FULL.length;
const SPEED = 1; // bytes per tick
const TICK_MS = 40;

export function TearScene() {
  const [bytes, setBytes] = useState(0);
  const [running, setRunning] = useState(false);
  const [crashAt, setCrashAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    timerRef.current = setInterval(() => {
      setBytes((b) => {
        if (crashAt !== null && b >= crashAt) {
          if (timerRef.current) clearInterval(timerRef.current);
          setRunning(false);
          return b;
        }
        if (b >= TOTAL) {
          if (timerRef.current) clearInterval(timerRef.current);
          setRunning(false);
          return TOTAL;
        }
        return b + SPEED;
      });
    }, TICK_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running, crashAt]);

  const start = () => { setBytes(0); setRunning(true); };
  const reset = () => { setRunning(false); setBytes(0); setCrashAt(null); };

  const onDisk = FULL.slice(0, bytes);
  const inFlight = FULL.slice(bytes);
  const crashed = !running && bytes > 0 && bytes < TOTAL;

  return (
    <Figure
      number="1.2"
      caption="Writing a 75-byte record. Set a crash point with the slider, then press Start. The partial bytes are what survives on disk."
    >
      <div className="space-y-4">
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[color:var(--color-fig-muted)] mb-2">
            users.json (on disk)
          </div>
          <pre className="bg-black/40 rounded p-3 text-sm font-mono whitespace-pre-wrap break-all min-h-[64px]">
            <span style={{ color: 'var(--color-fig-green)' }}>{onDisk}</span>
            <span className="opacity-25 line-through">{inFlight}</span>
          </pre>
          <div className="text-xs text-[color:var(--color-fig-muted)] mt-1 font-sans">
            {bytes} / {TOTAL} bytes written
            {crashed && (
              <span className="ml-2 text-[color:var(--color-fig-red)] font-semibold">
                Crashed at byte {bytes}. The file is corrupt.
              </span>
            )}
          </div>
        </div>
        <Slider
          label="crash at byte"
          min={0}
          max={TOTAL}
          step={1}
          value={crashAt ?? TOTAL}
          onChange={(v) => setCrashAt(v === TOTAL ? null : v)}
        />
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="fig-btn fig-btn-primary"
          >▶ Start</button>
          <button
            type="button"
            onClick={reset}
            className="fig-btn"
          >Reset</button>
        </div>
      </div>
    </Figure>
  );
}
