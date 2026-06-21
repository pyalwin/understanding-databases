import React, { useEffect, useRef, useState } from 'react';

// Pyodide is loaded from a CDN on demand. We cache the load promise across
// every mounted sandbox so the runtime is downloaded once per page.
const PYODIDE_VERSION = '0.27.5';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

interface PyodideInstance {
  // The Pyodide instance has many APIs; we only type what we use.
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (handler: { batched?: (s: string) => void }) => void;
  setStderr: (handler: { batched?: (s: string) => void }) => void;
  FS: {
    writeFile: (path: string, content: string) => void;
    readFile: (path: string, opts: { encoding: 'utf8' }) => string;
    readdir: (path: string) => string[];
    analyzePath: (path: string) => { exists: boolean };
    unlink: (path: string) => void;
  };
}

declare global {
  interface Window {
    loadPyodide?: (config: { indexURL: string }) => Promise<PyodideInstance>;
  }
}

let pyodidePromise: Promise<PyodideInstance> | null = null;

function loadPyodideOnce(): Promise<PyodideInstance> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${PYODIDE_BASE}pyodide.js`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Failed to load Pyodide runtime from CDN.'));
        document.head.appendChild(script);
      });
    }
    if (!window.loadPyodide) throw new Error('Pyodide loader missing after script load.');
    const py = await window.loadPyodide({ indexURL: PYODIDE_BASE });
    // Operate from the virtual filesystem root so the seeded files are
    // reachable via relative paths like open('users.json'). Pyodide's
    // default cwd is /home/pyodide.
    await py.runPythonAsync("import os; os.chdir('/')");
    return py;
  })();
  return pyodidePromise;
}

interface Props {
  initialCode?: string;
  /** Files to seed into the in-browser virtual filesystem on first mount. */
  initialFiles?: Record<string, string>;
  /** Files whose contents the reader can inspect via the "Show" buttons. */
  watchFiles?: string[];
}

type Status = 'loading' | 'ready' | 'error';

const MAX_OUTPUT_CHARS = 8000;

export function PythonSandbox({
  initialCode = '',
  initialFiles = {},
  watchFiles = [],
}: Props) {
  const [code, setCode] = useState(initialCode);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pyRef = useRef<PyodideInstance | null>(null);
  const initialFilesRef = useRef(initialFiles);

  useEffect(() => {
    let cancelled = false;
    loadPyodideOnce()
      .then((py) => {
        if (cancelled) return;
        pyRef.current = py;
        for (const [path, content] of Object.entries(initialFilesRef.current)) {
          try {
            py.FS.writeFile(path, content);
          } catch {
            /* ignore seeding failures */
          }
        }
        setStatus('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const appendOutput = (chunk: string) => {
    setOutput((prev) => {
      const next = prev + chunk;
      if (next.length > MAX_OUTPUT_CHARS) {
        return next.slice(next.length - MAX_OUTPUT_CHARS) + '\n[... output truncated ...]';
      }
      return next;
    });
  };

  const run = async () => {
    const py = pyRef.current;
    if (!py || running) return;
    setRunning(true);
    setOutput('');
    let buf = '';
    py.setStdout({ batched: (s) => (buf += s + '\n') });
    py.setStderr({ batched: (s) => (buf += s + '\n') });
    try {
      await py.runPythonAsync(code);
      appendOutput(buf);
      if (!buf) appendOutput('(no output)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendOutput(buf + (buf ? '\n' : '') + msg);
    } finally {
      setRunning(false);
    }
  };

  const showFile = (path: string) => {
    const py = pyRef.current;
    if (!py) return;
    try {
      const contents = py.FS.readFile(path, { encoding: 'utf8' });
      setOutput(`# ${path}\n${contents}`);
    } catch (e) {
      setOutput(`# ${path}\n(file does not exist or is unreadable: ${(e as Error).message})`);
    }
  };

  const resetFs = () => {
    const py = pyRef.current;
    if (!py) return;
    for (const path of watchFiles) {
      try {
        if (py.FS.analyzePath(path).exists) py.FS.unlink(path);
      } catch {
        /* ignore */
      }
    }
    for (const [path, content] of Object.entries(initialFilesRef.current)) {
      try {
        py.FS.writeFile(path, content);
      } catch {
        /* ignore */
      }
    }
    setOutput('Filesystem reset to its initial state.');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="figure-column my-10 rounded-xl border border-[color:var(--color-rule)] bg-[color:var(--color-code-bg)] p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-sans">
          <span className="font-semibold">Python</span>
          <span className="ml-2 text-[color:var(--color-ink-soft)] text-xs">
            Cmd/Ctrl+Enter to run
          </span>
        </label>
        <span className="font-sans text-[11px] text-[color:var(--color-ink-soft)]">
          {status === 'loading' && 'Loading Python runtime…'}
          {status === 'ready' && 'ready'}
          {status === 'error' && (
            <span style={{ color: 'var(--color-fig-red)' }}>error: {errorMsg}</span>
          )}
        </span>
      </div>

      <textarea
        rows={Math.max(6, Math.min(20, code.split('\n').length + 1))}
        spellCheck={false}
        className="w-full rounded-md border border-[color:var(--color-rule)] bg-white/60 p-3 font-mono text-[13.5px] text-[color:var(--color-ink)] outline-none focus:border-[color:var(--color-accent)]"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onKeyDown}
      />

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={run}
          disabled={status !== 'ready' || running}
          className="px-3 py-1.5 text-xs font-sans font-semibold rounded-md text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-accent)' }}
        >
          {running ? 'Running…' : '▶ Run'}
        </button>
        {watchFiles.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => showFile(path)}
            disabled={status !== 'ready'}
            className="px-3 py-1.5 text-xs font-sans rounded-md border border-[color:var(--color-rule)] hover:bg-white/40 disabled:opacity-40"
          >
            Show <code className="font-mono">{path.replace(/^\//, '')}</code>
          </button>
        ))}
        {(watchFiles.length > 0 || Object.keys(initialFilesRef.current).length > 0) && (
          <button
            type="button"
            onClick={resetFs}
            disabled={status !== 'ready'}
            className="px-3 py-1.5 text-xs font-sans rounded-md border border-[color:var(--color-rule)] hover:bg-white/40 disabled:opacity-40 text-[color:var(--color-ink-soft)]"
          >
            Reset files
          </button>
        )}
      </div>

      {output && (
        <pre
          className="mt-3 rounded-md p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words"
          style={{
            background: 'rgba(0, 0, 0, 0.04)',
            border: '1px solid var(--color-rule)',
            color: 'var(--color-ink)',
          }}
        >
          {output}
        </pre>
      )}
    </div>
  );
}
