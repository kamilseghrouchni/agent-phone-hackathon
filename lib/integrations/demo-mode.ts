// Demo-mode redirection — spec § 6.
//
// When DEMO_MODE=true every outbound channel rewrites the destination
// address to the user's own phone/email/calendar while preserving the
// supplier identity in the message envelope ("Geneticist BD" stays in
// the From line, but the message actually goes to the user's inbox).
//
// Production mode (DEMO_MODE=false or unset) returns the original
// destination unchanged.

export type Channel = "call" | "email" | "sms" | "form" | "calendar";

export interface DemoTargets {
  enabled: boolean;
  email?: string;
  phone?: string;
  calendar_url?: string;
}

export function getDemoTargets(): DemoTargets {
  return {
    enabled: process.env.DEMO_MODE === "true",
    email: process.env.DEMO_CALL_TARGET_EMAIL,
    phone: process.env.DEMO_CALL_TARGET_PHONE,
    calendar_url: process.env.DEMO_CALL_TARGET_CALENDAR_URL,
  };
}

// Returns the address the integration should actually deliver to.
// Original supplier address is kept in the envelope so demo audiences
// see the right narrative — that's the integration adapter's job.
export function resolveDestination(channel: Channel, original: string | undefined): string | undefined {
  const t = getDemoTargets();
  if (!t.enabled) return original;
  switch (channel) {
    case "email": return t.email ?? original;
    case "call":
    case "sms": return t.phone ?? original;
    case "calendar": return t.calendar_url ?? original;
    case "form": return original; // forms are submitted to supplier endpoints; reply lands by email/webhook
  }
}

// Useful for the UI demo banner.
export function demoModeActive(): boolean {
  return process.env.DEMO_MODE === "true";
}
