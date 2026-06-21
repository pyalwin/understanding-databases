import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * ClockScene — chapter 05 §5.
 *
 * The clock / second-chance algorithm, made visible. Six frames sit in a
 * CIRCLE; each carries a page and a reference bit. A hand sweeps the circle:
 *   - a HIT re-sets the touched frame's reference bit to 1;
 *   - a MISS into a full pool runs the hand from its current position — every
 *     frame it passes with bit 1 gets a SECOND CHANCE (bit cleared, advance);
 *     the first frame it finds with bit 0 is the victim.
 *
 * The reader touches a hot page (its bit keeps getting re-set, so the hand
 * sweeps past it) or brings in one-shot "scan" pages (bit never re-set, so the
 * next sweep evicts them). A shadow LRU model reports what plain LRU would have
 * evicted on the same trace, so the prose can hold the two side by side.
 *
 * Mobile (390px): the circle is a square that scales to the container width
 * (min 100%, capped), measured via ResizeObserver, so the hand and frames stay
 * proportional all the way down to ~300px.
 */

const N = 6;                 // frames in the circle (matches the sandbox pool)
const HOT_PAGE = 1;          // the page the "touch hot page" button re-references
const FIRST_SCAN = 7;        // one-shot scan pages start here (initial fill is 1..6)
const RADIUS_FRAC = 0.37;    // frame ring radius as a fraction of the box size
const STEP_MS = 620;

interface Frame {
  page: number;
  ref: 0 | 1;
}

type FlashKind = 'hit' | 'clear' | 'evict' | null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const COL = {
  blue: 'var(--color-fig-blue)',
  green: 'var(--color-fig-green)',
  orange: 'var(--color-fig-orange)',
  muted: 'var(--color-fig-muted)',
  fg: 'var(--color-fig-fg)',
};

function initialFrames(): Frame[] {
  return Array.from({ length: N }, (_, i) => ({ page: i + 1, ref: 1 as const }));
}

export default function ClockScene() {
  const [frames, setFrames] = useState<Frame[]>(initialFrames);
  const [hand, setHand] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [evictions, setEvictions] = useState(0);
  const [flash, setFlash] = useState<{ frame: number; kind: FlashKind } | null>(null);
  const [status, setStatus] = useState(
    'The pool is full, every reference bit is set. Touch the hot page, then bring in scan pages and watch the hand.',
  );
  const [busy, setBusy] = useState(false);
  const [lruNote, setLruNote] = useState<string | null>(null);

  // Shadow LRU model (recency: most-recent at the end) for the side-by-side note.
  const lruRef = useRef<number[]>([1, 2, 3, 4, 5, 6]);
  const scanRef = useRef(FIRST_SCAN);
  const busyRef = useRef(false);

  // Measure the square so the hand length tracks the frame ring exactly.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dim, setDim] = useState(320);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setDim(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cx = dim / 2;
  const cy = dim / 2;
  const R = dim * RADIUS_FRAC;
  const angleFor = (i: number) => -90 + i * (360 / N); // frame 0 at top, clockwise
  const posFor = (i: number) => {
    const rad = (angleFor(i) * Math.PI) / 180;
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) };
  };

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const touchLru = (page: number) => {
    const order = lruRef.current.filter((p) => p !== page);
    order.push(page);
    lruRef.current = order;
  };

  const request = useCallback(async (page: number) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setLruNote(null);

    const idx = frames.findIndex((f) => f.page === page);
    if (idx !== -1) {
      // HIT — re-set the reference bit.
      setHits((h) => h + 1);
      setFrames((fs) => fs.map((f, i) => (i === idx ? { ...f, ref: 1 } : f)));
      touchLru(page);
      setFlash({ frame: idx, kind: 'hit' });
      setStatus(`Hit — page ${page} is resident. Its reference bit is set back to 1.`);
      await sleep(STEP_MS);
      setFlash(null);
      setBusyBoth(false);
      return;
    }

    // MISS into a full pool — sweep the hand for a victim.
    setMisses((m) => m + 1);

    // What would plain LRU have done on this same access? (least-recent in pool)
    const resident = new Set(frames.map((f) => f.page));
    const lruVictim = lruRef.current.find((p) => resident.has(p));

    const working = frames.map((f) => ({ ...f }));
    let h = hand;
    setStatus(`Miss — page ${page} isn't resident and the pool is full. The hand starts sweeping…`);
    await sleep(STEP_MS * 0.6);

    // Give a second chance to every frame whose bit is set.
    let guard = 0;
    while (working[h].ref === 1 && guard < 2 * N + 1) {
      const cleared = working[h].page;
      working[h].ref = 0;
      setHand(h);
      setFrames(working.map((f) => ({ ...f })));
      setFlash({ frame: h, kind: 'clear' });
      setStatus(`Page ${cleared}'s bit was 1 — second chance: clear it to 0 and move on.`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(STEP_MS);
      h = (h + 1) % N;
      guard++;
    }

    // First frame with a clear bit is the victim.
    const victimPage = working[h].page;
    setHand(h);
    setFlash({ frame: h, kind: 'evict' });
    setStatus(`Page ${victimPage}'s bit is 0 — no second chance left. Evict it.`);
    setEvictions((e) => e + 1);
    await sleep(STEP_MS);

    working[h] = { page, ref: 1 };
    const newHand = (h + 1) % N;
    setFrames(working.map((f) => ({ ...f })));
    setHand(newHand);
    setFlash({ frame: h, kind: 'hit' });

    // Update shadow LRU: it would have evicted its least-recent resident page.
    if (lruVictim !== undefined) {
      lruRef.current = lruRef.current.filter((p) => p !== lruVictim);
    }
    touchLru(page);

    if (lruVictim !== undefined && lruVictim !== victimPage) {
      setLruNote(
        `On this access plain LRU would have evicted page ${lruVictim}; the clock evicted page ${victimPage}.`,
      );
    } else {
      setLruNote(
        `Here the clock and plain LRU agree — both evict page ${victimPage}. The clock just did it with one bit and no reordering.`,
      );
    }
    setStatus(`Page ${page} is installed where ${victimPage} was, with its reference bit set to 1.`);
    await sleep(STEP_MS);
    setFlash(null);
    setBusyBoth(false);
  }, [frames, hand]);

  const reset = () => {
    if (busyRef.current) return;
    setFrames(initialFrames());
    setHand(0);
    setHits(0);
    setMisses(0);
    setEvictions(0);
    setFlash(null);
    setLruNote(null);
    lruRef.current = [1, 2, 3, 4, 5, 6];
    scanRef.current = FIRST_SCAN;
    setStatus('Reset. The pool is full again, every reference bit set.');
  };

  const total = hits + misses;
  const hitRate = total ? Math.round((hits / total) * 100) : 0;
  const handAngle = hand * (360 / N); // degrees clockwise from the top frame
  const handLen = Math.max(R - dim * 0.085, 10);

  const hotResident = frames.some((f) => f.page === HOT_PAGE);

  return (
    <Figure
      number="5.4"
      caption={
        <>
          The <strong>clock</strong> (second-chance) algorithm. Frames sit in a
          ring with a <strong>reference bit</strong> each. A hit re-sets a bit; a
          miss sweeps the <em>hand</em>, clearing set bits (a second chance) and
          evicting the first frame whose bit is already clear. Keep touching the
          hot page and watch the hand sweep right past it.
        </>
      }
    >
      <div className="clk-wrap">
        {/* stats */}
        <div className="clk-stats">
          <span>hits <b style={{ color: COL.green }}>{hits}</b></span>
          <span>misses <b style={{ color: COL.orange }}>{misses}</b></span>
          <span>evictions <b style={{ color: COL.fg }}>{evictions}</b></span>
          <span>hit rate <b style={{ color: COL.blue }}>{hitRate}%</b></span>
        </div>

        {/* the clock */}
        <div className="clk-stage">
          <div className="clk-square" ref={wrapRef} style={{ height: dim }}>
            {/* ring guide */}
            <div
              className="clk-ring"
              style={{ width: R * 2, height: R * 2, left: cx, top: cy }}
            />
            {/* hub */}
            <div className="clk-hub" style={{ left: cx, top: cy }} />
            {/* hand */}
            <motion.div
              className="clk-hand"
              style={{ left: cx, top: cy, height: handLen, originX: 0.5, originY: 1 }}
              animate={{ rotate: handAngle }}
              transition={{ type: 'spring', stiffness: 180, damping: 18 }}
            >
              <span className="clk-hand-tip" />
            </motion.div>

            {/* frames */}
            {frames.map((f, i) => {
              const { x, y } = posFor(i);
              const isHand = i === hand;
              const fk = flash?.frame === i ? flash.kind : null;
              const isHot = f.page === HOT_PAGE;
              let border = 'rgba(0,0,0,0.14)';
              let bg = 'var(--color-fig-bg)';
              if (fk === 'hit') { border = COL.green; bg = 'rgba(47,107,58,0.12)'; }
              else if (fk === 'clear') { border = COL.blue; bg = 'rgba(30,79,165,0.10)'; }
              else if (fk === 'evict') { border = COL.orange; bg = 'rgba(176,74,20,0.14)'; }
              else if (isHand) { border = COL.fg; }
              return (
                <div
                  key={i}
                  className="clk-frame"
                  style={{ left: x, top: y, borderColor: border, background: bg }}
                >
                  <span className="clk-page" style={{ color: isHot ? COL.orange : COL.fg }}>
                    P{f.page}
                    {isHot && <span className="clk-hot-dot" title="the hot page" />}
                  </span>
                  <span
                    className="clk-bit"
                    style={{
                      color: f.ref ? '#fff' : COL.muted,
                      background: f.ref ? COL.green : 'transparent',
                      borderColor: f.ref ? COL.green : 'rgba(0,0,0,0.22)',
                    }}
                  >
                    {f.ref}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* status */}
        <div className="clk-status" role="status" aria-live="polite">
          {status}
          {lruNote && <span className="clk-lru"> {lruNote}</span>}
        </div>

        {/* controls */}
        <div className="clk-controls">
          <button
            type="button"
            className="fig-btn fig-btn-primary"
            onClick={() => request(HOT_PAGE)}
            disabled={busy || !hotResident}
            title={hotResident ? '' : 'the hot page has been evicted — reset to bring it back'}
          >
            Touch hot page (P{HOT_PAGE})
          </button>
          <button
            type="button"
            className="fig-btn"
            onClick={() => request(scanRef.current++)}
            disabled={busy}
          >
            Bring in a scan page
          </button>
          <button type="button" className="fig-btn fig-btn-danger" onClick={reset} disabled={busy}>
            Reset
          </button>
        </div>

        <div className="clk-legend">
          <span><span className="clk-key" style={{ background: COL.green }} /> bit = 1 (referenced)</span>
          <span><span className="clk-key" style={{ borderColor: 'rgba(0,0,0,0.22)' }} /> bit = 0 (cooling)</span>
          <span><span className="clk-hot-dot clk-hot-static" /> the hot page</span>
        </div>
      </div>

      <style>{`
        .clk-wrap { display: flex; flex-direction: column; gap: 14px; }
        .clk-stats {
          display: flex; flex-wrap: wrap; gap: 6px 16px;
          font-family: var(--font-sans); font-size: 12px; color: var(--color-fig-muted);
        }
        .clk-stats b { font-variant-numeric: tabular-nums; font-weight: 700; }

        .clk-stage { display: flex; justify-content: center; }
        .clk-square {
          position: relative; width: 100%; max-width: 340px; aspect-ratio: 1 / 1;
        }
        .clk-ring {
          position: absolute; transform: translate(-50%, -50%);
          border: 1px dashed rgba(0,0,0,0.16); border-radius: 50%;
          pointer-events: none;
        }
        .clk-hub {
          position: absolute; width: 12px; height: 12px; border-radius: 50%;
          transform: translate(-50%, -50%); background: var(--color-fig-fg);
          z-index: 3;
        }
        .clk-hand {
          position: absolute; width: 4px; transform: translate(-50%, -100%);
          background: var(--color-fig-fg); border-radius: 3px; z-index: 2;
        }
        .clk-hand-tip {
          position: absolute; top: -5px; left: 50%; transform: translateX(-50%);
          width: 0; height: 0;
          border-left: 6px solid transparent; border-right: 6px solid transparent;
          border-bottom: 9px solid var(--color-fig-fg);
        }
        .clk-frame {
          position: absolute; transform: translate(-50%, -50%);
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          min-width: 48px; padding: 6px 8px; border-radius: 9px;
          border: 1.5px solid rgba(0,0,0,0.14); background: var(--color-fig-bg);
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
          transition: background 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
          z-index: 1;
        }
        .clk-page {
          font-family: var(--font-mono, monospace); font-size: 13px; font-weight: 700;
          display: inline-flex; align-items: center; gap: 3px; line-height: 1;
        }
        .clk-hot-dot {
          display: inline-block; width: 6px; height: 6px; border-radius: 50%;
          background: var(--color-fig-orange);
        }
        .clk-hot-static { width: 8px; height: 8px; }
        .clk-bit {
          font-family: var(--font-mono, monospace); font-size: 11px; font-weight: 700;
          width: 18px; height: 18px; line-height: 16px; text-align: center;
          border-radius: 50%; border: 1.5px solid;
          transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
        }

        .clk-status {
          font-family: var(--font-sans); font-size: 12.5px; line-height: 1.45;
          background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px; padding: 9px 11px; min-height: 38px;
          color: var(--color-fig-fg);
        }
        .clk-lru { color: var(--color-fig-blue); font-weight: 600; }

        .clk-controls { display: flex; flex-wrap: wrap; gap: 8px; }

        .clk-legend {
          display: flex; flex-wrap: wrap; gap: 6px 14px;
          font-family: var(--font-sans); font-size: 11px; color: var(--color-fig-muted);
        }
        .clk-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .clk-key {
          width: 12px; height: 12px; border-radius: 50%;
          border: 1.5px solid transparent; display: inline-block;
        }
      `}</style>
    </Figure>
  );
}
