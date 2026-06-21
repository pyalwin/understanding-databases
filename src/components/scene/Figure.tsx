import React from 'react';
import type { ReactNode } from 'react';

interface Props {
  number?: string;
  caption: ReactNode;
  breakout?: boolean;
  children: ReactNode;
}

export function Figure({ number, caption, breakout = true, children }: Props) {
  return (
    <figure
      className={
        (breakout ? 'figure-column' : 'prose-column') +
        ' my-10 rounded-xl overflow-hidden border border-[color:var(--color-rule)] shadow-sm'
      }
    >
      <div className="figure-surface bg-[color:var(--color-fig-bg)] text-[color:var(--color-fig-fg)] p-6">
        {children}
      </div>
      <figcaption className="bg-[color:var(--color-page)] border-t border-[color:var(--color-rule)] px-5 py-3 text-sm text-[color:var(--color-ink-soft)] font-sans">
        {number && (
          <span className="text-[color:var(--color-accent)] font-semibold mr-2">
            Figure&nbsp;{number}.
          </span>
        )}
        {caption}
      </figcaption>
    </figure>
  );
}
