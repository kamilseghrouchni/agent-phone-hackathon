"use client";

// global-error.tsx is the LAYOUT-level error boundary — fires when
// the root layout itself throws. Must include <html> + <body> since
// it replaces the layout.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ marginBottom: 12 }}>Application error</h2>
          <p style={{ marginBottom: 16, color: "#666" }}>
            {error.message || "Unexpected error in the root layout."}
          </p>
          {error.digest && (
            <p style={{ marginBottom: 16, color: "#999", fontSize: 12 }}>
              digest: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              border: "1px solid #333",
              background: "white",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
