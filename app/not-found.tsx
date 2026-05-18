import Link from "next/link";

// Required by Next 15 app router for any thrown notFound() and 404 paths.

export default function NotFound() {
  return (
    <div className="ws">
      <header className="ws-top">
        <div className="lead">
          <div className="status-line">
            <span className="status">Not found</span>
            <span className="thread-id">CROVI · 404</span>
          </div>
          <h1 className="req-title serif">
            That page doesn&apos;t exist.
          </h1>
        </div>
        <div className="actions">
          <Link className="btn-p brand" href="/">
            ← Back to home
          </Link>
        </div>
      </header>
    </div>
  );
}
