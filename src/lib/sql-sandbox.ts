import type initSqlJs from 'sql.js';

type SqlJsDatabase = InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

interface SqlResult {
  columns: string[];
  rows: Record<string, string | number | null>[];
  durationMs: number;
}

interface SqlError extends Error {
  durationMs?: number;
}

export class SqlSandbox {
  #db: SqlJsDatabase | null = null;
  #el: Element | null = null;

  mount(el: Element): void {
    this.#el = el;
    this.#el.innerHTML = `
      <div class="space-y-3">
        <label class="block text-sm font-medium">
          <span class="text-gray-300">SQL</span>
          <span class="text-gray-600 ml-2">Cmd/Ctrl+Enter to run</span>
        </label>
        <textarea
          rows="6"
          class="w-full rounded-lg border border-white/10 bg-gray-900 p-3 font-mono text-sm text-gray-100 outline-none focus:border-white/20"
          spellcheck="false"
        ></textarea>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-200"
          >Run</button>
          <span class="status text-gray-400 text-sm"></span>
        </div>
        <div class="results"></div>
      </div>
    `;

    const ta = this.#el.querySelector('textarea')!;
    const status = this.#el.querySelector('.status')!;
    const results = this.#el.querySelector('.results')!;
    const runBtn = this.#el.querySelector('button')!;

    const run = async () => {
      results.innerHTML = '';
      const sql = ta.value.trim();
      if (!sql) {
        status.textContent = '';
        return;
      }

      status.textContent = 'Running…';

      try {
        const res = await this.runSql(sql);
        status.textContent = `OK in ${res.durationMs}ms`;

        if (!res.columns?.length) return;

        const table = document.createElement('div');
        table.className = 'overflow-x-auto rounded-lg border border-white/10';
        const inner = document.createElement('table');
        inner.className = 'min-w-full divide-y divide-white/10 text-sm';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const column of res.columns) {
          const th = document.createElement('th');
          th.className = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400 bg-white/5';
          th.textContent = column;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        inner.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const row of res.rows) {
          const tr = document.createElement('tr');
          for (const column of res.columns) {
            const td = document.createElement('td');
            td.className = 'px-3 py-2 font-mono text-gray-200 align-top';
            td.textContent = row[column] == null ? 'NULL' : String(row[column]);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        inner.appendChild(tbody);
        table.appendChild(inner);
        results.appendChild(table);
      } catch (err) {
        status.textContent = 'Error';
        const msg = err instanceof Error ? err.message : String(err);
        results.innerHTML = `<pre class="text-sm text-red-400 whitespace-pre-wrap">${this.#escapeHtml(msg)}</pre>`;
        console.error(err);
      }
    };

    runBtn.addEventListener('click', run);
    ta.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
    });

    window.addEventListener('sandbox-run-default', () => {
      ta.value = `SELECT 1 AS hello, 'astro' AS stack;`;
      run();
    });
  }

  async runSql(sql: string): Promise<SqlResult> {
    if (typeof window === 'undefined') {
      throw new Error('SQL sandbox is only available in the browser');
    }

    const start = performance.now();

    if (!this.#db) {
      await this.#initDb();
    }

    try {
      this.#db!.exec(sql);
      const result = this.#db!.exec('SELECT * FROM sqlite_master WHERE type IN (\'table\',\'view\')');
      const tableStats: Record<string, number | string | null> = {};
      for (const r of result) {
        const name = r.values[0][2] as string;
        const countResult = this.#db!.exec(`SELECT COUNT(*) AS n FROM "${name}"`);
        const rawCount = countResult[0]?.values[0][0];
        tableStats[name] = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0);
      }

      return {
        columns: ['table', 'rows'],
        rows: Object.entries(tableStats).map(([table, rows]) => ({ table, rows })),
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const message = this.#normalizeSqliteError(err, sql);
      const error: SqlError = new Error(message);
      error.durationMs = durationMs;
      throw error;
    }
  }

  #escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  #normalizeSqliteError(err: unknown, sql: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err) {
      const message = (err as { message: string }).message;
      if (message.toLowerCase().includes('syntax error')) {
        return `Syntax error:\n${sql}`;
      }
      return message;
    }
    return String(err);
  }

  async #initDb(): Promise<void> {
    const SQL = await import('sql.js');
    const sqlJs = typeof SQL.default === 'function' ? SQL.default : (SQL as unknown as typeof initSqlJs);
    const instance = await sqlJs();
    this.#db = new instance.Database();
  }
}
