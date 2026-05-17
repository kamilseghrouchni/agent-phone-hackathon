"use client";
import { useEffect, useMemo, useRef } from "react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";

type Event =
  | { kind: "user"; ts: string; text: string }
  | { kind: "tool"; ts: string; toolName: string; input: any; running: boolean; output: any }
  | { kind: "narration"; ts: string; text: string; streaming: boolean }
  | { kind: "error"; ts: string; text: string };

function formatTs(t: number, base: number) {
  const s = Math.floor((t - base) / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function summarizeInput(input: any): string {
  if (!input) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) parts.push(`${k}=[${v.slice(0, 3).join(",")}${v.length > 3 ? "…" : ""}]`);
    else if (typeof v === "object") parts.push(`${k}=…`);
    else parts.push(`${k}=${v}`);
  }
  return parts.slice(0, 4).join("  ");
}

export function EventLog({
  messages,
  error,
  streaming,
}: {
  messages: UIMessage[];
  error?: Error | undefined;
  streaming: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const events = useMemo<Event[]>(() => buildEvents(messages, streaming), [messages, streaming]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);

  return (
    <div className="event-log" ref={ref}>
      <div className="hd">Event log</div>
      {events.map((e, i) => (
        <div key={i} className={`event ${e.kind === "tool" && e.running ? "live" : ""}`}>
          <span className="ts">{e.ts}</span>
          <div className="body">
            <div className="kind">
              {e.kind === "tool" && e.running && <span className="live-dot" />}
              {kindLabel(e)}
            </div>
            {e.kind === "tool" ? (
              <div className="text">{summarizeInput(e.input)}</div>
            ) : e.kind === "narration" ? (
              <div className="narration">
                <ReactMarkdown
                  components={{
                    a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
                    table: () => null, // We banned tables in narration; ignore if it slips through
                    h1: ({ children }) => <strong>{children}</strong>,
                    h2: ({ children }) => <strong>{children}</strong>,
                    h3: ({ children }) => <strong>{children}</strong>,
                  }}
                >
                  {e.text}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text">{e.text}</div>
            )}
          </div>
        </div>
      ))}
      {error && <div className="error-box">{error.message || String(error)}</div>}
    </div>
  );
}

function kindLabel(e: Event): string {
  if (e.kind === "user") return "you";
  if (e.kind === "tool") return e.toolName.replace(/_/g, " ") + (e.running ? " · running" : "");
  if (e.kind === "narration") return "crovi";
  return "error";
}

function buildEvents(messages: UIMessage[], streaming: boolean): Event[] {
  const out: Event[] = [];
  const baseT = Date.now() - 60_000;
  let now = baseT;
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi];
    if (m.role === "user") {
      const text = (m.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ");
      out.push({ kind: "user", ts: formatTs(now, baseT), text });
      now += 200;
      continue;
    }
    if (m.role !== "assistant") continue;
    const parts = (m.parts ?? []) as any[];
    let lastTextI = -1;
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].type === "text") { lastTextI = i; break; }
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type?.startsWith("tool-")) {
        const tn = p.type.replace("tool-", "");
        const running = !p.output && (p.state === "input-streaming" || p.state === "input-available");
        out.push({ kind: "tool", ts: formatTs(now, baseT), toolName: tn, input: p.input, running, output: p.output });
        now += 1500;
      } else if (p.type === "text" && p.text) {
        const isStreamingTail = streaming && mi === messages.length - 1 && i === lastTextI;
        out.push({ kind: "narration", ts: formatTs(now, baseT), text: p.text, streaming: isStreamingTail });
        now += 500;
      }
    }
  }
  return out;
}
