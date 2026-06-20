import React from 'react';
import { useEffect, useRef } from 'react';
import { SqlSandbox } from '@/lib/sql-sandbox';

interface Props {
  initialSql?: string;
}

export function SqlSandboxReact({ initialSql }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const sb = new SqlSandbox();
    sb.mount(hostRef.current);
    if (initialSql) {
      const ta = hostRef.current.querySelector('textarea');
      if (ta) (ta as HTMLTextAreaElement).value = initialSql;
    }
  }, [initialSql]);

  return (
    <div
      ref={hostRef}
      className="figure-column my-10 rounded-xl border border-[color:var(--color-rule)] bg-[color:var(--color-code-bg)] p-4"
    />
  );
}
