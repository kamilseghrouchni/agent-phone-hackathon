"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { QuerySpecimensResult, InstituteEntry } from "@/lib/tools/query_specimens";
import type { FindPublicationsResult } from "@/lib/tools/find_publications";
import { EventLog } from "@/components/ChatRail/EventLog";
import { RankedList } from "@/components/Outcome/RankedList";
import { InstituteDetail } from "@/components/Outcome/InstituteDetail";
import { SecondaryStack } from "@/components/Outcome/SecondaryStack";
import { SpecimensTable } from "@/components/Outcome/SpecimensTable";
import { SpecimenDrawer } from "@/components/Outcome/SpecimenDrawer";
import { ProspectiveList } from "@/components/Outcome/ProspectiveList";
import { ProspectiveDetail } from "@/components/Outcome/ProspectiveDetail";
import type { SpecimenRow } from "@/lib/tools/query_specimens";
import type { ProspectiveCard } from "@/lib/prospective";
import type { ParseResult, ClarifierAnswer } from "@/app/api/parse/types";
import { ParsedRequest } from "@/components/Understand/ParsedRequest";
import { Clarifiers } from "@/components/Understand/Clarifiers";
import { RunningView } from "@/components/Running/RunningView";
import { HandoffModal } from "@/components/Handoff/HandoffModal";
import type { IntakeForm } from "@/types/intake";
import { ConfirmStrip } from "@/components/Intake/ConfirmStrip";
import { FullIntakeAccordion } from "@/components/Intake/FullIntakeAccordion";
import { SearchPhase } from "@/components/Search/SearchPhase";
import { SequenceTemplate } from "@/components/Chain/SequenceTemplate";
import { StageControls } from "@/components/Chain/StageControls";
import { Timeline } from "@/components/Chain/Timeline";
import { SupplierCardsGrid } from "@/components/Enrich/SupplierCardsGrid";
import { SessionPanel } from "@/components/Enrich/SessionPanel";
import { SupplierDetail } from "@/components/Enrich/SupplierDetail";
import { ClimaxView, type ClimaxMode } from "@/components/Output/ClimaxView";
import type { EnrichSupplierState } from "@/lib/agents/enrich";
import type { ChainState } from "@/types/chain";
import type { SupplierEvidence } from "@/types/evidence";

type Step = "parse" | "clarify" | "running" | "results";
type IntakePhase = "confirm" | "search" | "enrich" | "chain";

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspacePageContent />
    </Suspense>
  );
}

function WorkspacePageContent() {
  // ─── Intake flow (PDF-driven) takes precedence over the legacy ?q= path ───
  // useSearchParams here is read-only; the legacy flow's own useSearchParams
  // call is preserved below. We branch BEFORE any other hooks fire, so the
  // intake subtree never observes the legacy hooks (and vice versa) — safe
  // under React's rules because the branch is stable per mount.
  return <WorkspaceRouter />;
}

function WorkspaceRouter() {
  const sp = useSearchParams();
  const runId = sp.get("runId");
  const phaseParam = sp.get("phase") as IntakePhase | null;
  if (runId) {
    return <IntakeWorkspace runId={runId} initialPhase={phaseParam ?? "confirm"} />;
  }
  return <LegacyWorkspace />;
}

function LegacyWorkspace() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  const [step, setStep] = useState<Step>("parse");
  const [rawQuery, setRawQuery] = useState<string>("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<ClarifierAnswer[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number>(0);
  const startedParse = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProspectiveId, setSelectedProspectiveId] = useState<string | null>(null);
  const [autoSelected, setAutoSelected] = useState<string | null>(null);
  const [view, setView] = useState<"institute" | "table">("institute");
  const [drawerRow, setDrawerRow] = useState<SpecimenRow | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffSource, setHandoffSource] = useState<"banked" | "prospective" | null>(null);
  const [restoredQuery, setRestoredQuery] = useState<QuerySpecimensResult | null>(null);
  const [prospective, setProspective] = useState<ProspectiveCard[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q");
  const tParam = searchParams.get("t"); // nonce — changes per run so the effect re-fires
  const lastRunKey = useRef<string | null>(null);

  // Step 1: read the initial query and parse it. The query is passed via the
  // ?q= URL param (with a ?t= nonce so re-clicking the same chip still re-parses).
  // If there's no ?q=, try to restore the prior session from the stashed bundle
  // ctx so back-from-bundle doesn't loop on an empty parse step.
  useEffect(() => {
    // Legacy fallback: an older flow may have stashed the query in sessionStorage.
    const stashedInitial = typeof window !== "undefined" ? sessionStorage.getItem("crovi_initial_query") : null;
    const initial = queryParam ?? stashedInitial;
    if (initial) {
      const runKey = `${initial}::${tParam ?? ""}`;
      if (lastRunKey.current === runKey) return;
      lastRunKey.current = runKey;
      if (stashedInitial) sessionStorage.removeItem("crovi_initial_query");
      startedParse.current = true;
      setRawQuery(initial);
      setParsed(null);
      setParseError(null);
      setAnswers([]);
      setRestoredQuery(null);
      setRunComplete(false);
      setStep("parse");
      parseQuery(initial)
        .then((p) => {
          setParsed(p);
          setStep("clarify");
        })
        .catch((e) => {
          setParseError(e?.message ?? String(e));
          setStep("clarify");
        });
      return;
    }
    // First mount with no q param — try restoring from bundle ctx.
    if (startedParse.current) return;
    const stashed = sessionStorage.getItem("crovi_bundle_ctx");
    if (stashed) {
      try {
        const ctx = JSON.parse(stashed) as { rawQuery?: string; parsed?: ParseResult | null; result?: QuerySpecimensResult | null };
        if (ctx.result) {
          startedParse.current = true;
          if (ctx.rawQuery) setRawQuery(ctx.rawQuery);
          if (ctx.parsed) setParsed(ctx.parsed);
          setRestoredQuery(ctx.result);
          setRunComplete(true);
          setStep("results");
          return;
        }
      } catch {
        // fall through to empty clarify
      }
    }
    setStep("clarify");
  }, [queryParam, tParam]);

  // Step 3 → 4: when first query_specimens output lands, hold the running view
  // briefly so the deliver beat is visible, then transition.
  const { latestQuery: streamedQuery, latestPubs, firstUserText } = useMemo(() => deriveState(messages), [messages]);
  const latestQuery: QuerySpecimensResult | null = streamedQuery ?? restoredQuery;
  const institutes: InstituteEntry[] = latestQuery?.institutes ?? [];
  const isStreaming = status === "streaming" || status === "submitted";
  const [runComplete, setRunComplete] = useState(false);

  useEffect(() => {
    if (step !== "running") return;
    if (!latestQuery || isStreaming) return;
    setRunComplete(true);
  }, [step, latestQuery, isStreaming]);

  // Auto-select top institute on first results
  useEffect(() => {
    if (!institutes.length) return;
    if (selectedId && institutes.find((i) => i.organization_id === selectedId)) return;
    if (autoSelected !== institutes[0].organization_id) {
      setSelectedId(institutes[0].organization_id);
      setAutoSelected(institutes[0].organization_id);
    }
  }, [institutes, selectedId, autoSelected]);

  // Fetch prospective partners once we hit the results step. Ranked against the
  // user's query so the most relevant one floats up.
  useEffect(() => {
    if (step !== "results") return;
    if (prospective.length > 0) return;
    const q = rawQuery || firstUserText || "";
    fetch(`/api/prospective?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data) => setProspective(data.cards ?? []))
      .catch(() => setProspective([]));
  }, [step, prospective.length, rawQuery, firstUserText]);

  const selected = institutes.find((i) => i.organization_id === selectedId) ?? null;
  const selectedProspective = prospective.find((p) => p.id === selectedProspectiveId) ?? null;

  function selectBanked(id: string | null) {
    setSelectedId(id);
    if (id) setSelectedProspectiveId(null);
  }
  function selectProspective(id: string | null) {
    setSelectedProspectiveId(id);
    if (id) setSelectedId(null);
  }

  function launch() {
    if (!parsed) return;
    const finalText = composeFinalText(rawQuery, parsed, answers);
    setRunStartedAt(Date.now());
    setStep("running");
    sendMessage({ text: finalText }, { body: { parsedFilters: parsed.filters } });
  }

  // Reflow when running but no parsed (e.g., direct nav typing in composer post-results)
  if (step === "parse" || (step === "clarify" && !parsed && !parseError)) {
    return (
      <div className="ws">
        <header className="ws-top">
          <div className="lead">
            <div className="status-line">
              <span className="status">
                <span className="live-dot" />
                Reading your request
              </span>
              <span className="thread-id">CROVI · PARSE</span>
            </div>
            {rawQuery && <h1 className="req-title serif">{rawQuery}</h1>}
          </div>
        </header>
        <main className="step-main">
          <div className="parse-loader">
            <div className="parse-loader-bar" />
            <div className="parse-loader-text mono">Parsing — pulling out indication, specimen, format…</div>
          </div>
        </main>
      </div>
    );
  }

  if (step === "clarify") {
    return (
      <div className="ws">
        <header className="ws-top">
          <div className="lead">
            <div className="status-line">
              <span className="status">Clarify before sourcing</span>
              <span className="thread-id">CROVI · STEP 1 OF 2</span>
            </div>
            {rawQuery && <h1 className="req-title serif">{rawQuery}</h1>}
            {parseError && <div className="parse-error mono-sm">PARSE ERROR · {parseError}</div>}
          </div>
        </header>

        <main className="step-main clarify-grid">
          {parsed && (
            <>
              <section className="clarify-left">
                <ParsedRequest
                  parsed={parsed}
                  rawQuery={rawQuery}
                  onAssaysChange={(assays) => setParsed({ ...parsed, assays })}
                  action={
                    <button className="btn-o" onClick={() => history.back()}>← Edit request</button>
                  }
                />
              </section>
              <section className="clarify-right">
                <Clarifiers
                  clarifiers={parsed.clarifiers}
                  onAnswersChange={setAnswers}
                  action={
                    <button className="btn-p brand" onClick={launch}>Run search →</button>
                  }
                />
              </section>
            </>
          )}
          {!parsed && (
            <div className="parse-empty">
              <p>No request to parse. Go back to the home page and start one.</p>
            </div>
          )}
        </main>
      </div>
    );
  }

  if (step === "running" && parsed) {
    return (
      <div className="ws">
        <header className="ws-top">
          <div className="lead">
            <div className="status-line">
              <span className="status">
                {!runComplete && <span className="live-dot" />}
                {runComplete ? "Sourcing complete" : "Sourcing"}
              </span>
              <span className="thread-id">CROVI · STEP 2 OF 2</span>
            </div>
            {rawQuery && <h1 className="req-title serif">{rawQuery}</h1>}
          </div>
          {runComplete && (
            <div className="actions">
              <button className="btn-p brand" onClick={() => setStep("results")}>
                View results →
              </button>
            </div>
          )}
        </header>
        <main className="step-main">
          <RunningView
            parsed={parsed}
            messages={messages}
            startedAt={runStartedAt}
            done={runComplete}
          />
        </main>
      </div>
    );
  }

  // results step (existing layout)
  return (
    <div className="ws">
      <header className="ws-top">
        <div className="lead">
          <div className="status-line">
            <span className="status">
              {isStreaming ? <span className="live-dot" /> : null}
              {isStreaming ? "Run in progress" : "Run complete"}
            </span>
          </div>
          {(firstUserText || rawQuery) && <h1 className="req-title serif">{rawQuery || firstUserText}</h1>}
          {latestQuery && (
            <div className="meta">
              <span>
                <strong>{latestQuery.totals.institutes}</strong> from the bank
              </span>
              {prospective.length > 0 && (
                <span>
                  <strong>{prospective.length}</strong> prospective partners
                </span>
              )}
              <span className="meta-sep">·</span>
              <span>{latestQuery.totals.specimens.toLocaleString()} specimens</span>
              <span>{latestQuery.totals.donors.toLocaleString()} donors</span>
              {latestQuery.totals.longitudinal_donors > 0 && <span>{latestQuery.totals.longitudinal_donors.toLocaleString()} longitudinal</span>}
            </div>
          )}
        </div>
        {latestQuery && (
          <div className="actions">
            <div className="view-toggle">
              <button className={view === "institute" ? "on" : ""} onClick={() => setView("institute")}>By institute</button>
              <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table view</button>
            </div>
            <button
              className="btn-p brand handoff-cta"
              onClick={() => {
                sessionStorage.setItem(
                  "crovi_bundle_ctx",
                  JSON.stringify({
                    rawQuery: rawQuery || firstUserText,
                    parsed,
                    result: latestQuery,
                  }),
                );
                router.push("/workspace/bundle");
              }}
            >
              Build bundle →
            </button>
          </div>
        )}
      </header>

      <div className="ws-body">
        {view === "institute" && (
          <aside className="rail">
            <RailContent
              institutes={institutes}
              selectedId={selectedId}
              onSelect={selectBanked}
              prospective={prospective}
              selectedProspectiveId={selectedProspectiveId}
              onSelectProspective={selectProspective}
              messages={messages}
              error={error}
              isStreaming={isStreaming}
            />
          </aside>
        )}

        <main className="detail" style={view === "table" ? { gridColumn: "1 / span 2" } : undefined}>
          {view === "table" && latestQuery ? (
            <section className="det-section" style={{ paddingTop: 0, borderBottom: 0 }}>
              <div className="sect-lbl">Matching specimens · table</div>
              <SpecimensTable data={latestQuery} onOpen={setDrawerRow} />
            </section>
          ) : selectedProspective ? (
            <ProspectiveDetail
              card={selectedProspective}
              onAddToHandoff={() => {
                setHandoffSource("prospective");
                setHandoffOpen(true);
              }}
            />
          ) : selected ? (
            <InstituteDetail
              inst={selected}
              query={latestQuery!}
              pubs={latestPubs ?? null}
              onHandoff={() => {
                setHandoffSource("banked");
                setHandoffOpen(true);
              }}
              onOpenSpecimen={setDrawerRow}
            />
          ) : (
            <SecondaryStack messages={messages} onUserIntent={(intent) => handleIntent(intent, sendMessage)} />
          )}
        </main>
      </div>

      {drawerRow && (
        <SpecimenDrawer
          row={drawerRow}
          instituteName={institutes.find((i) => i.organization_id === drawerRow.organization_id)?.name}
          onClose={() => setDrawerRow(null)}
        />
      )}

      <HandoffModal
        open={handoffOpen}
        onClose={() => {
          setHandoffOpen(false);
          setHandoffSource(null);
        }}
        rawQuery={rawQuery || firstUserText}
        parsed={parsed}
        result={latestQuery}
        prospective={handoffSource === "prospective" ? selectedProspective : null}
        bankedInstitute={handoffSource === "banked" ? selected : null}
      />
    </div>
  );
}

async function parseQuery(query: string): Promise<ParseResult> {
  const r = await fetch("/api/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`parse failed: ${r.status}`);
  return r.json();
}

function composeFinalText(rawQuery: string, parsed: ParseResult, answers: ClarifierAnswer[]): string {
  const addOns: string[] = [];
  for (const a of answers) {
    const c = parsed.clarifiers.find((x) => x.id === a.id);
    if (!c) continue;
    if (a.value === null && !a.custom_text) continue; // skipped
    if (a.custom_text) {
      addOns.push(`${c.question} → ${a.custom_text}`);
      continue;
    }
    // Translate the answer into instructional text
    const v = a.value;
    if (c.target_field === "min_n" && typeof v === "number") {
      addOns.push(`Need at least ${v} samples.`);
    } else if (c.target_field === "has_contact_email" && typeof v === "boolean") {
      if (v) addOns.push("Only include institutes with a direct contact email.");
    } else if (c.target_field === "treatment_status") {
      if (v === "naive") addOns.push("Treatment-naive donors only.");
    } else if (c.target_field === "countries") {
      if (v === "USA") addOns.push("USA only.");
      else if (v === "non-USA") addOns.push("Outside USA only.");
    }
  }
  // Assays are intentionally NOT appended here — they're a downstream concern
  // (bundle step picks providers per assay). Adding them to the search prompt
  // re-feeds the LLM and shifts the institute filters, so the institute list
  // would change every time the user added or removed an assay.
  if (!addOns.length) return rawQuery;
  return `${rawQuery}\n\n${addOns.join(" ")}`;
}

function RailContent({
  institutes,
  selectedId,
  onSelect,
  prospective,
  selectedProspectiveId,
  onSelectProspective,
  messages,
  error,
  isStreaming,
}: {
  institutes: InstituteEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  prospective: ProspectiveCard[];
  selectedProspectiveId: string | null;
  onSelectProspective: (id: string | null) => void;
  messages: UIMessage[];
  error?: Error | undefined;
  isStreaming: boolean;
}) {
  const [tab, setTab] = useState<"bank" | "prospective">("bank");
  const [eventsOpen, setEventsOpen] = useState(false);
  useEffect(() => {
    if (institutes.length > 0 && !isStreaming) setTab("bank");
  }, [isStreaming, institutes.length]);
  useEffect(() => {
    if (selectedProspectiveId) setTab("prospective");
  }, [selectedProspectiveId]);
  return (
    <>
      <div className="rail-switcher">
        <button
          className={`rs-btn ${tab === "bank" ? "on" : ""}`}
          onClick={() => setTab("bank")}
        >
          <span className="rs-label">From the bank</span>
          <span className="rs-count">{institutes.length}</span>
        </button>
        <button
          className={`rs-btn ${tab === "prospective" ? "on" : ""}`}
          onClick={() => setTab("prospective")}
        >
          <span className="rs-label">Prospective</span>
          <span className="rs-count">{prospective.length}</span>
        </button>
      </div>
      <div className="rail-body">
        {tab === "bank" ? (
          <RankedList institutes={institutes} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <ProspectiveList
            cards={prospective}
            selectedId={selectedProspectiveId}
            onSelect={onSelectProspective}
          />
        )}
      </div>
      <div className="rail-foot">
        <button className="rail-foot-link" onClick={() => setEventsOpen((o) => !o)}>
          {eventsOpen ? "Hide" : "Show"} activity log · {messages.length}
        </button>
        {eventsOpen && (
          <div className="rail-events">
            <EventLog messages={messages} error={error} streaming={isStreaming} />
          </div>
        )}
      </div>
    </>
  );
}

function handleIntent(intent: string, sendMessage: (m: { text: string }) => void) {
  if (intent.startsWith("dismiss:")) return;
  if (intent === "open_request_form:source_wider") return sendMessage({ text: "Open a request form for broader sourcing." });
  if (intent === "open_request_form:audit_deeper") return sendMessage({ text: "Open an audit-deeper request form." });
  if (intent === "filter:has_contact_email=true") return sendMessage({ text: "Drop institutes without contact emails." });
  if (intent === "find_publications") return sendMessage({ text: "Look up curated literature for this." });
}

// ───────────────────────────────────────────────────────────────────────────
// IntakeWorkspace — PDF-driven flow (upload → confirm → enrich → chain)
// ───────────────────────────────────────────────────────────────────────────

function IntakeWorkspace({ runId, initialPhase }: { runId: string; initialPhase: IntakePhase }) {
  const [phase, setPhase] = useState<IntakePhase>(initialPhase);
  const [intake, setIntake] = useState<IntakeForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Enrich state
  const [enrichStates, setEnrichStates] = useState<EnrichSupplierState[]>([]);
  const [activeSupplierId, setActiveSupplierId] = useState<string | null>(null);
  const [openedSupplierId, setOpenedSupplierId] = useState<string | null>(null);
  // Right-pane view mode for the opened supplier — Detail (data we have) or
  // Live session (Chromium frame stream + action log). Live is the default
  // when the user opens a scraping supplier; we auto-fall back to Detail
  // when there is no session yet (directory-only suppliers like crovi.bio,
  // or before the first SSE frame lands).
  const [rightPaneView, setRightPaneView] = useState<"detail" | "session">(
    "session",
  );
  const [enrichStarted, setEnrichStarted] = useState(false);
  const [selectedChainSuppliers, setSelectedChainSuppliers] = useState<string[]>([]);

  // Chain state — driven by SSE, not a fixture.
  const [chainState, setChainState] = useState<ChainState | null>(null);
  const [chainStarted, setChainStarted] = useState(false);
  // When the user launches via direct supplier click (auto-launch path), we
  // skip the intermediate "▶ Launch sequence" confirmation screen and fire
  // chain/start on chain-phase entry. The flag also drives the heading copy.
  const [chainAutoFire, setChainAutoFire] = useState(false);

  // Climax/Lineage right-pane toggle (active once Stage 5 lands).
  const [climaxMode, setClimaxMode] = useState<ClimaxMode>("documents");

  // Load the intake. Priority:
  //   1. sessionStorage (stashed by Dropzone on PDF upload)
  //   2. /api/runs/<runId>/intake (disk fallback — lets direct URL access
  //      to ?phase=chain work without going through the PDF flow)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(`crovi_intake_${runId}`);
    if (raw) {
      try {
        setIntake(JSON.parse(raw) as IntakeForm);
        return;
      } catch (e) {
        setLoadError(`failed to parse stashed intake: ${String(e)}`);
        return;
      }
    }
    // Disk fallback — fetch from the runs store.
    (async () => {
      try {
        const r = await fetch(`/api/runs/${runId}/intake`);
        if (!r.ok) {
          setLoadError(
            "Intake not found — upload a PDF on the home page or POST to /api/chain/fire-stage first.",
          );
          return;
        }
        const j = (await r.json()) as { intake: IntakeForm };
        if (j.intake) {
          setIntake(j.intake);
          // Stash for refresh persistence
          try {
            sessionStorage.setItem(`crovi_intake_${runId}`, JSON.stringify(j.intake));
          } catch {}
        } else {
          setLoadError("Intake fetched but empty.");
        }
      } catch (e) {
        setLoadError(`intake fetch failed: ${String(e)}`);
      }
    })();
  }, [runId]);

  // Persist intake edits (from ConfirmStrip + editable rows in IntakePreview)
  // back to sessionStorage so refresh keeps the user's tweaks. The initial
  // load above will re-hydrate from this key, closing the loop.
  const updateIntake = (next: IntakeForm) => {
    setIntake(next);
    try {
      sessionStorage.setItem(`crovi_intake_${runId}`, JSON.stringify(next));
    } catch {
      // session full or unavailable — silent, edits still live in memory
    }
  };

  // Fire enrichment server-side on entering the Enrich phase.
  useEffect(() => {
    if (phase !== "enrich" || !intake || enrichStarted) return;
    setEnrichStarted(true);
    void (async () => {
      try {
        const r = await fetch("/api/enrich/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId, intake }),
        });
        if (!r.ok) {
          // eslint-disable-next-line no-console
          console.warn("enrich/start failed", r.status);
          return;
        }
        const data = (await r.json()) as { states: EnrichSupplierState[] };
        setEnrichStates(data.states ?? []);
        // Auto-focus the first scraping session for the audience — this is
        // the supplier whose live Chromium frames stream into the right
        // pane on first paint. The Live pane is the demo's load-bearing
        // surface, so we prefer a supplier that actually has a session
        // over the directory-only refmed inventory card.
        const firstScrape = (data.states ?? []).find((s) => s.session);
        const refmed = (data.states ?? []).find(
          (s) => s.supplier.supplier_id === "refmed",
        );
        const firstAny = (data.states ?? [])[0];
        // Pane open priority: first scraping supplier (Live can render) →
        // refmed (inventory hero) → first available. Whichever wins, set
        // the matching rightPaneView so the user lands on a usable pane,
        // not a "No session selected" placeholder.
        const initialOpen = firstScrape ?? refmed ?? firstAny;
        if (initialOpen) {
          const id = initialOpen.supplier.supplier_id;
          setOpenedSupplierId(id);
          if (initialOpen.session) {
            setActiveSupplierId(id);
            setRightPaneView("session");
          } else {
            setRightPaneView("detail");
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("enrich/start error", e);
      }
    })();
  }, [phase, intake, enrichStarted, runId]);

  // Chain fire — auto when the user single-click-launched a supplier from
  // the enrich grid, manual when they hit the chain phase via the legacy
  // "Launch sequence on selected (N)" multi-select button. The autoFire
  // path is the smoother default; the manual button is preserved as a
  // safety net for the multi-select flow.
  const launchChain = async () => {
    if (chainStarted) return;
    setChainStarted(true);
    const supplierId = selectedChainSuppliers[0] ?? "crovi_bio";
    try {
      await fetch("/api/chain/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, supplierId }),
      });
    } catch (e) {
      console.warn("chain/start error", e);
      setChainStarted(false);
    }
  };

  // Auto-launch the chain the moment we land in the chain phase via direct
  // supplier click. Idempotent — guarded by chainStarted + chainAutoFire.
  useEffect(() => {
    if (phase !== "chain") return;
    if (!chainAutoFire) return;
    if (chainStarted) return;
    if (selectedChainSuppliers.length === 0) return;
    void launchChain();
    // launchChain is stable enough for this — it only reads refs / state
    // that don't change between renders of the same phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chainAutoFire, chainStarted, selectedChainSuppliers]);

  // SSE: subscribe to live ChainState updates once we're in chain phase.
  useEffect(() => {
    if (phase !== "chain") return;
    let es: EventSource | null = null;
    // Prime initial snapshot.
    void (async () => {
      try {
        const r = await fetch(`/api/chain/${runId}`);
        if (r.ok) {
          const data = (await r.json()) as { chain?: ChainState };
          if (data.chain) setChainState(data.chain);
        }
      } catch {
        // SSE will fill it shortly
      }
    })();
    try {
      es = new EventSource(`/api/chain/${runId}/stream`);
      es.addEventListener("message", (ev: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(ev.data) as { chain?: ChainState };
          if (payload?.chain) setChainState(payload.chain);
        } catch {
          // ignore malformed
        }
      });
    } catch {
      // some environments forbid EventSource — fallback already primed.
    }
    return () => {
      es?.close();
    };
  }, [phase, runId]);

  // Auto-flip to climax mode the first time meeting completes.
  const meetingComplete = chainState?.stages?.meeting?.status === "complete";
  useEffect(() => {
    if (meetingComplete) setClimaxMode("documents");
  }, [meetingComplete]);

  // Provenance click — toggle to lineage view + scroll to the matching event.
  const handleProvenanceClick = (eventId: string) => {
    setClimaxMode("lineage");
    // Defer the scroll until after the lineage view re-renders.
    requestAnimationFrame(() => {
      const el =
        document.getElementById(eventId) ||
        document.querySelector(`[data-event-id="${eventId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (loadError) {
    return (
      <div className="ws">
        <header className="ws-top">
          <div className="lead">
            <span className="status">Intake error</span>
            <div className="parse-error mono-sm">{loadError}</div>
          </div>
        </header>
      </div>
    );
  }
  if (!intake) {
    return (
      <div className="ws">
        <header className="ws-top">
          <div className="lead">
            <span className="status">
              <span className="live-dot" /> Loading intake…
            </span>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="ws iw">
      <header className="ws-top">
        <div className="lead">
          <div className="status-line">
            <span className="status">
              {phase === "confirm" && "Confirm 6 search keys"}
              {phase === "search" && (
                <>
                  <span className="live-dot" /> Searching suppliers
                </>
              )}
              {phase === "enrich" && (
                <>
                  <span className="live-dot" /> Enriching suppliers
                </>
              )}
              {phase === "chain" && (
                <>
                  <span className="live-dot" /> Chain running
                </>
              )}
            </span>
            <span className="thread-id">CROVI · {phase.toUpperCase()}</span>
          </div>
        </div>
        <div className="iw-phase-bar">
          <PhasePill label="Upload" done />
          <PhasePill
            label="Confirm"
            active={phase === "confirm"}
            done={phase !== "confirm"}
          />
          <PhasePill
            label="Search"
            active={phase === "search"}
            done={phase === "enrich" || phase === "chain"}
          />
          <PhasePill label="Enrich" active={phase === "enrich"} done={phase === "chain"} />
          <PhasePill label="Chain" active={phase === "chain"} />
        </div>
      </header>

      <main className="step-main iw-main">
        {phase === "confirm" && (
          <div className="iw-confirm iw-confirm-v2">
            <div className="iw-confirm-lead">
              <span className="mono-sm iw-eyebrow">Read your intake</span>
              <h2 className="serif iw-confirm-title">
                Confirm the 6 search keys · review the full intake below
              </h2>
              <p className="iw-confirm-sub">
                Anything in the chips drives sourcing. Everything else stays read-only
                until evidence comes back from suppliers.
              </p>
            </div>

            <ConfirmStrip
              intake={intake}
              onChange={updateIntake}
              onLaunch={() => setPhase("search")}
            />
            <FullIntakeAccordion intake={intake} onChange={updateIntake} />

            <div className="iw-confirm-foot">
              <span className="mono-sm iw-confirm-foot-hint">
                Looks good? Launch the enrichment agents.
              </span>
              <button
                className="btn-p brand"
                onClick={() => setPhase("search")}
              >
                Launch enrichment →
              </button>
            </div>
          </div>
        )}

        {phase === "search" && (
          <SearchPhase
            intake={intake}
            onContinue={() => setPhase("enrich")}
          />
        )}

        {phase === "enrich" && (
          <div className="iw-enrich-split">
            <div className="iw-enrich-left">
              <SupplierCardsGrid
                states={enrichStates}
                onPipClick={(id) => {
                  setActiveSupplierId(id);
                  setOpenedSupplierId(id);
                  setRightPaneView("session");
                }}
                onOpen={(id) => {
                  // CONTRACT — onOpen ONLY mutates the right-pane preview.
                  // It MUST NOT call setPhase, setSelectedChainSuppliers, or
                  // setChainAutoFire. The Live session pane is the demo's
                  // load-bearing surface during enrichment; routing onOpen
                  // to the chain phase removes the user's ability to scan
                  // suppliers in Live and is a regression — see the
                  // "Restore Live session pane" task.
                  //
                  // Launch path lives ONLY in `onLaunch` below (the explicit
                  // "Launch sequence on selected" button). Inspect path is
                  // here + the ▣ pip (onPipClick).
                  setOpenedSupplierId(id);
                  const opened = enrichStates.find(
                    (s) => s.supplier.supplier_id === id,
                  );
                  const hasSession = !!opened?.session;
                  setRightPaneView(hasSession ? "session" : "detail");
                  if (hasSession) setActiveSupplierId(id);
                }}
                onLaunch={(ids) => {
                  // The ONLY path that launches the chain from the enrich
                  // grid. Single-select or multi-select, the user always
                  // goes through this button — never through onOpen.
                  setSelectedChainSuppliers(ids);
                  setChainAutoFire(true);
                  setPhase("chain");
                }}
                activeSupplierId={activeSupplierId}
                openedSupplierId={openedSupplierId}
              />
            </div>
            <div className="iw-enrich-right">
              <div className="supplier-pane-tabs">
                <button
                  type="button"
                  className={`supplier-pane-tab ${rightPaneView === "detail" ? "on" : ""}`}
                  onClick={() => setRightPaneView("detail")}
                  disabled={!openedSupplierId}
                >
                  Detail
                </button>
                <button
                  type="button"
                  className={`supplier-pane-tab ${rightPaneView === "session" ? "on" : ""}`}
                  onClick={() => {
                    setRightPaneView("session");
                    if (openedSupplierId) setActiveSupplierId(openedSupplierId);
                  }}
                  disabled={
                    !openedSupplierId ||
                    !enrichStates.find(
                      (s) =>
                        s.supplier.supplier_id === openedSupplierId &&
                        !!s.session,
                    )
                  }
                  title="Live Chromium session"
                >
                  Live session
                </button>
              </div>
              {rightPaneView === "detail" && openedSupplierId ? (
                <SupplierDetail
                  supplierId={openedSupplierId}
                  runId={runId}
                />
              ) : (
                <SessionPanel
                  supplierId={
                    rightPaneView === "session"
                      ? activeSupplierId ?? openedSupplierId
                      : activeSupplierId
                  }
                  states={enrichStates}
                />
              )}
            </div>
          </div>
        )}

        {phase === "chain" && (
          <div className="iw-chain">
            {(!chainState || chainState.stages.form.status === "ready") &&
            !chainAutoFire ? (
              <div className="iw-chain-launch">
                <h2>Launch sequence</h2>
                <p>
                  Drives: <strong>form-fill on crovi.bio</strong> → <strong>call your phone</strong> with
                  the Crovi-AI operator → <strong>email contract to {`<your inbox>`}</strong> → <strong>SMS + $10 down-payment stub</strong> → <strong>book meeting on Notion calendar</strong>.
                </p>
                <p className="iw-chain-launch-hint">
                  Each stage cascades automatically on real wire events (call.completed,
                  email reply, SMS CONFIRMED). You can also fire any stage in isolation
                  from the stage cockpit once launched.
                </p>
                <button
                  type="button"
                  className="iw-chain-launch-btn"
                  onClick={launchChain}
                  disabled={chainStarted}
                >
                  {chainStarted ? "Starting…" : "▶ Launch sequence"}
                </button>
              </div>
            ) : !chainState ? (
              <div className="iw-chain-launch">
                <h2>
                  <span className="live-dot" /> Starting sequence…
                </h2>
                <p className="iw-chain-launch-hint">
                  Stage 1 form-fill is opening. The cockpit will appear as soon as
                  the first wire event lands.
                </p>
              </div>
            ) : (
              <>
                <div className="iw-chain-hd">
                  <SequenceTemplate chain={chainState} />
                  {meetingComplete && (
                    <button
                      type="button"
                      className="btn-o"
                      onClick={() => setClimaxMode((m) => (m === "documents" ? "lineage" : "documents"))}
                    >
                      {climaxMode === "documents" ? "← View lineage" : "→ View documents"}
                    </button>
                  )}
                </div>
                {meetingComplete && climaxMode === "documents" ? (
                  <ClimaxView
                    intake={intake}
                    evidence={[] as SupplierEvidence[]}
                    chain={chainState}
                    selectedSupplierIds={selectedChainSuppliers.length ? selectedChainSuppliers : [chainState.supplier_id]}
                    onProvenanceClick={handleProvenanceClick}
                  />
                ) : (
                  <>
                    <StageControls
                      runId={runId}
                      chain={chainState}
                      supplierId={chainState.supplier_id}
                    />
                    <Timeline chain={chainState} runId={runId} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function PhasePill({ label, active, done }: { label: string; active?: boolean; done?: boolean }) {
  const cls = active ? "iw-pp on" : done ? "iw-pp done" : "iw-pp";
  return <span className={cls}>{label}</span>;
}

function deriveState(messages: UIMessage[]): {
  latestQuery: QuerySpecimensResult | null;
  latestPubs: FindPublicationsResult | null;
  firstUserText: string;
} {
  let latestQuery: QuerySpecimensResult | null = null;
  let latestPubs: FindPublicationsResult | null = null;
  let firstUserText = "";
  for (const m of messages) {
    if (m.role === "user" && !firstUserText) {
      firstUserText = (m.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ").trim();
    }
    if (m.role !== "assistant") continue;
    for (const p of (m.parts ?? []) as any[]) {
      if (!p.type?.startsWith("tool-") || !p.output) continue;
      const toolName = p.type.replace("tool-", "");
      if (toolName === "query_specimens") latestQuery = p.output;
      if (toolName === "find_publications") latestPubs = p.output;
    }
  }
  return { latestQuery, latestPubs, firstUserText };
}
