import React from 'react';
import type { ReactNode } from 'react';

type CalloutType = 'note' | 'tip' | 'warning' | 'danger';

const config: Record<CalloutType, { label: string; bg: string; rail: string; icon: string }> = {
  note:    { label: 'Note',    bg: 'var(--color-callout-note)',    rail: '#4a4a46', icon: 'i' },
  tip:     { label: 'Tip',     bg: 'var(--color-callout-tip)',     rail: '#111111', icon: '★' },
  warning: { label: 'Warning', bg: 'var(--color-callout-warning)', rail: '#6a6a64', icon: '!' },
  danger:  { label: 'Danger',  bg: 'var(--color-callout-danger)',  rail: '#000000', icon: '✕' },
};

interface Props {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}

export function Callout({ type = 'note', title, children }: Props) {
  const c = config[type];
  return (
    <aside
      className="prose-column my-6 flex gap-3 rounded-md border border-[color:var(--color-rule)] overflow-hidden"
      style={{ background: c.bg }}
    >
      <div
        className="w-1.5 flex-shrink-0"
        style={{ background: c.rail }}
        aria-hidden="true"
      />
      <div className="py-3 pr-4">
        <div className="font-sans text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: c.rail }}>
          <span className="mr-1.5 inline-block w-4 text-center" aria-hidden="true">{c.icon}</span>
          {title ?? c.label}
        </div>
        <div className="text-[15px] leading-relaxed">{children}</div>
      </div>
    </aside>
  );
}
