"use client";
import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";

export function ChatRail({
  messages,
  status,
  error,
  onSubmit,
}: {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error | undefined;
  onSubmit: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming") return;
    onSubmit(text);
    setInput("");
  };

  return (
    <div className="ws-rail">
      <div className="ws-rail-hd">
        <span className="thread-id">CROVI · THREAD-{Date.now().toString(36).slice(-5).toUpperCase()}</span>
        {status === "streaming" && <span className="live-dot" />}
      </div>
      <div className="ws-rail-msgs" ref={ref}>
        {messages.map((m) => <MessageView key={m.id} message={m} streaming={status === "streaming"} />)}
        {status === "submitted" && <div style={{ color: "var(--text-3)", fontSize: 12 }}>thinking…</div>}
        {error && (
          <div className="gap" style={{ background: "#FEE7E2", borderColor: "oklch(0.7 0.13 25)" }}>
            <div className="why" style={{ color: "oklch(0.42 0.13 25)" }}>{error.message || String(error)}</div>
          </div>
        )}
      </div>
      <form className="ws-rail-input" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ask a follow-up… 'group by country', 'drop ones without contact emails'"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          rows={1}
        />
        <button className="btn-p" type="submit" disabled={status === "streaming" || !input.trim()}>send</button>
      </form>
    </div>
  );
}

function MessageView({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role === "user") {
    const text = (message.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
    return (
      <div className="msg">
        <span className="msg-role">you</span>
        <div className="msg-user">{text}</div>
      </div>
    );
  }
  return (
    <div className="msg">
      <span className="msg-role">crovi</span>
      {(message.parts ?? []).map((p: any, i: number) => {
        if (p.type === "text") {
          const isLast = i === (message.parts?.length ?? 0) - 1;
          return <div key={i} className={`msg-assistant ${streaming && isLast ? "streaming" : ""}`}>{p.text}</div>;
        }
        if (p.type?.startsWith("tool-")) {
          return <ToolCard key={p.toolCallId ?? i} part={p} />;
        }
        return null;
      })}
    </div>
  );
}

function ToolCard({ part }: { part: any }) {
  const name = part.type.replace("tool-", "");
  const running = part.state === "input-streaming" || part.state === "input-available";
  const lat = part._latencyMs ? `${part._latencyMs}ms` : running ? "…" : "ok";
  return (
    <div className={`tool-card ${running ? "running" : ""}`}>
      <div className="tc-hd">
        <span className="name">{name}</span>
        <span className="lat">{lat}</span>
      </div>
      {part.input && (
        <div className="tc-args">{summarizeInput(part.input)}</div>
      )}
    </div>
  );
}

function summarizeInput(input: any): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) parts.push(`${k}: [${v.slice(0, 3).join(", ")}${v.length > 3 ? ", …" : ""}]`);
    else if (typeof v === "object") parts.push(`${k}: …`);
    else parts.push(`${k}: ${v}`);
  }
  return parts.slice(0, 4).join("  ·  ");
}
