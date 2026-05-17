"use client";

// Next 15 app router requires an error.tsx alongside every layout.
// Without this, runtime errors bubble up as "missing required error
// components, refreshing…" and the page flicker-reloads forever.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="ws">
      <header className="ws-top">
        <div className="lead">
          <div className="status-line">
            <span className="status">Something went wrong</span>
            <span className="thread-id">CROVI · ERROR</span>
          </div>
          <h1 className="req-title serif">{error.message || "Unexpected error"}</h1>
          {error.digest && (
            <div className="mono-sm" style={{ opacity: 0.6, marginTop: 4 }}>
              digest: {error.digest}
            </div>
          )}
        </div>
        <div className="actions">
          <button className="btn-p brand" onClick={reset}>
            Try again →
          </button>
        </div>
      </header>
    </div>
  );
}
