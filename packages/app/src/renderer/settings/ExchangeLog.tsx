import { useEffect, useRef, useState } from 'react';
import { LOG_LINES, logText } from './log';
import type { LogState } from './log';

/** The last lines of what the app and the units said to each other. */
export function ExchangeLog() {
  const [log, setLog] = useState<LogState>({ kind: 'loading' });
  const [reads, setReads] = useState(0);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let live = true;
    window.helm.recentLog(LOG_LINES).then(
      (lines) => {
        if (live) setLog({ kind: 'ready', lines });
      },
      () => {
        if (live) setLog({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [reads]);

  // Newest line is at the bottom: show it.
  useEffect(() => {
    const element = box.current;
    if (element && log.kind === 'ready') element.scrollTop = element.scrollHeight;
  }, [log]);

  return (
    <section className="log-section" aria-labelledby="exchange-log-title">
      <h3 id="exchange-log-title" className="section-title">
        Exchange log
      </h3>
      <p className="hint">What the app and your units said to each other. The last 200 lines.</p>
      <pre className="log-box" ref={box} tabIndex={0} aria-label="Exchange log lines">
        {logText(log)}
      </pre>
      <div className="row">
        <button type="button" className="btn" onClick={() => setReads((count) => count + 1)}>
          Refresh
        </button>
        <button type="button" className="btn" onClick={() => void window.helm.openLogFolder()}>
          Open folder
        </button>
      </div>
    </section>
  );
}
