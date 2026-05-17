"use client";
import { useState } from "react";

export function Composer({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [v, setV] = useState("");
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = v.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setV("");
  };
  return (
    <form className="ws-bottom" onSubmit={submit}>
      <span className="lead-mark">Ask</span>
      <textarea
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder="follow up… 'group by country', 'drop ones without contact emails', 'compare top two'"
        disabled={disabled}
      />
      <button className="btn-p brand" type="submit" disabled={disabled || !v.trim()}>send</button>
    </form>
  );
}
