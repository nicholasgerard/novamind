"use client";

import { Loader2, RotateCcw, SendHorizontal } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StreamEvent } from "@novamind/shared/events";
import { useAccessGate } from "@/components/access-gate";
import {
  EvidenceModal,
  VerifierModal,
} from "@/components/literature-chat/evidence-modals";
import {
  LiteratureStageSectionCard,
  LiveStatusLine,
  SynthesisCard,
  UserBubble,
} from "@/components/literature-chat/chat-transcript";
import {
  extractVerificationRows,
  getLiveStatus,
  getPipelineResult,
  groupByLiteratureStage,
} from "@/components/literature-chat/stream-helpers";
import type { Phase } from "@/components/literature-chat/types";
import { StageHeader } from "@/components/stage-header";
import { Button } from "@/components/ui/button";
import {
  isLiteratureTerminalEventPayload,
  parseLiteratureStreamEvent,
} from "@/lib/client-stream-events";
import {
  clearCachedResearchRun,
  readCachedResearchRun,
  writeCachedResearchRun,
} from "@/lib/demo-run-cache";
import { fetchDemoApi, responseNeedsAccess } from "@/lib/demo-api-fetch";
import { readJsonSseStream } from "@/lib/sse-client";
import { requireStop } from "@/lib/stops";
import { useAbortableRequest } from "@/lib/use-abortable-request";

const researchAgentStop = requireStop("05-research-agent-demo");

export function LiteratureChatDemo() {
  const { requireAccess, showLogin } = useAccessGate();
  const { abortCurrent, clearCurrent, startRequest } = useAbortableRequest();
  const [question, setQuestion] = useState(
    "Compare HbA1c reduction across recent GLP-1 receptor agonist trials.",
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState<"evidence" | "verifier" | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollPaused = useRef(false);
  const scrollPending = useRef(false);
  const submittedQuestion = useRef<string>("");

  const result = useMemo(() => getPipelineResult(events), [events]);
  const verificationRows = useMemo(
    () => extractVerificationRows(events),
    [events],
  );
  const sections = useMemo(() => groupByLiteratureStage(events), [events]);
  const isRunning = phase === "running";
  const hasResult = Boolean(result);
  const liveStatus = useMemo(() => getLiveStatus(events), [events]);

  useEffect(() => {
    const cached = readCachedResearchRun();
    if (!cached) return;
    submittedQuestion.current = cached.question;
    setQuestion(cached.question);
    setEvents(cached.events);
    setPhase("complete");
  }, []);

  useEffect(() => {
    function onScroll() {
      const documentHeight = document.documentElement.scrollHeight;
      const viewportBottom = window.scrollY + window.innerHeight;
      autoScrollPaused.current =
        documentHeight - viewportBottom > window.innerHeight * 0.35;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Anchor the page so that the latest streamed content sits near the vertical
  // middle of the viewport. The spacer below the sentinel gives the browser
  // room to scroll the sentinel up to center.
  useEffect(() => {
    if (events.length === 0) return;
    const node = bottomRef.current;
    if (!node) return;
    if (autoScrollPaused.current && !hasResult) return;
    if (scrollPending.current) return;
    scrollPending.current = true;
    requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      scrollPending.current = false;
    });
  }, [events.length, hasResult, sections.length]);

  // Move to "complete" phase once the final streamed result lands.
  useEffect(() => {
    if (phase === "running" && result) {
      const timer = window.setTimeout(() => setPhase("complete"), 200);
      return () => window.clearTimeout(timer);
    }
  }, [result, phase]);

  function focusInputOnFormClick(event: ReactMouseEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    if (target?.tagName === "INPUT") return;
    inputRef.current?.focus();
  }

  async function run() {
    if (phase === "running" || question.trim().length === 0) return;
    if (!requireAccess()) return;

    submittedQuestion.current = question.trim();
    autoScrollPaused.current = false;
    setEvents([]);
    setErrorMsg(null);
    setPhase("running");
    inputRef.current?.blur();
    const controller = startRequest();
    const runEvents: StreamEvent[] = [];
    let pendingEventFrame: number | null = null;

    const flushEvents = () => {
      pendingEventFrame = null;
      setEvents([...runEvents]);
    };

    const flushPendingEvents = () => {
      if (pendingEventFrame === null) return;
      window.cancelAnimationFrame(pendingEventFrame);
      flushEvents();
    };

    const scheduleEventFlush = () => {
      if (pendingEventFrame !== null) return;
      pendingEventFrame = window.requestAnimationFrame(flushEvents);
    };

    try {
      const res = await fetchDemoApi("/api/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: submittedQuestion.current }),
        signal: controller.signal,
      });

      if (responseNeedsAccess(res)) {
        setPhase("idle");
        showLogin({ resetAccessHint: true });
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      if (!res.body) throw new Error("No response body");

      let sawResult = false;
      let streamError: string | null = null;

      await readJsonSseStream({
        body: res.body,
        isTerminalEventPayload: isLiteratureTerminalEventPayload,
        parseEvent: parseLiteratureStreamEvent,
        streamName: "literature-stream",
        onEvent: (event) => {
          if (event.type === "pipeline_result") sawResult = true;
          if (event.type === "error") streamError = event.message;
          runEvents.push(event);
          scheduleEventFlush();
        },
      });
      flushPendingEvents();
      if (streamError) throw new Error(streamError);
      if (!sawResult) {
        throw new Error("Agent stream ended before returning a final result.");
      }
      const finalResult = runEvents.find(
        (event): event is Extract<StreamEvent, { type: "pipeline_result" }> =>
          event.type === "pipeline_result",
      );
      if (finalResult) {
        writeCachedResearchRun({
          completedAt: finalResult.ts,
          events: runEvents,
          question: submittedQuestion.current,
          result: finalResult.result,
          totalUsage: finalResult.totalUsage,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (pendingEventFrame !== null) {
          window.cancelAnimationFrame(pendingEventFrame);
        }
        return;
      }
      flushPendingEvents();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    } finally {
      if (pendingEventFrame !== null) {
        window.cancelAnimationFrame(pendingEventFrame);
      }
      clearCurrent(controller);
    }
  }

  function resetCachedRun() {
    abortCurrent();
    clearCachedResearchRun();
    setEvents([]);
    setErrorMsg(null);
    setOpenModal(null);
    setPhase("idle");
    submittedQuestion.current = "";
  }

  return (
    <>
      <div className="soft-enter mx-auto flex w-full max-w-5xl flex-col gap-14">
        <StageHeader
          title={researchAgentStop.title}
          description={researchAgentStop.description}
        />

        <div className="mx-auto w-full max-w-3xl space-y-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
            onClick={focusInputOnFormClick}
            className="flex cursor-text items-center gap-2 rounded-full border border-foreground/15 bg-card/80 p-2 shadow-2xl shadow-black/15 transition-colors duration-150 focus-within:border-primary/65"
          >
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={isRunning}
              className="min-h-11 min-w-0 flex-1 rounded-full border-0 bg-transparent px-4 py-2 text-sm text-foreground outline-none placeholder:text-[var(--fg-dim)] disabled:opacity-60"
              placeholder="Ask a research question..."
            />
            <Button
              type="submit"
              disabled={isRunning || question.trim().length === 0}
              className="h-10 shrink-0 rounded-full px-4 shadow-lg shadow-primary/15"
            >
              {isRunning ? (
                <>
                  <Loader2 className="animate-spin" />
                  Streaming
                </>
              ) : (
                <>
                  <SendHorizontal />
                  Run agent
                </>
              )}
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            500-paper GLP-1 + peptides corpus. Hybrid retrieval, Claude Agent
            SDK synthesis with claim-level grounding.
          </p>
        </div>

        {errorMsg && (
          <div className="mx-auto w-full max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        {(events.length > 0 || isRunning) && (
          <div className="mx-auto w-full max-w-3xl space-y-6 border-t border-border/60 pt-14">
            <UserBubble text={submittedQuestion.current} />
            {sections.map((section) => (
              <LiteratureStageSectionCard key={section.id} section={section} />
            ))}
            {result && (
              <>
                <SynthesisCard
                  result={result}
                  verificationRows={verificationRows}
                  onOpenEvidence={() => setOpenModal("evidence")}
                  onOpenVerifier={() => setOpenModal("verifier")}
                />
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetCachedRun}
                    className="rounded-full border-border/80 bg-card/45 px-4 text-muted-foreground hover:border-foreground/35 hover:text-foreground"
                  >
                    <RotateCcw />
                    Ask another question
                  </Button>
                </div>
              </>
            )}
            {isRunning && !result && <LiveStatusLine status={liveStatus} />}
            <div ref={bottomRef} aria-hidden />
            {/* Spacer below the sentinel determines the inset from the bottom
                of the viewport. With ~10rem of room below + block:"center",
                the browser caps at max scroll and lands the latest content
                ~160px above the bottom — clearing the stage stepper and
                corner nav with breathing room. */}
            <div aria-hidden className="h-40" />
          </div>
        )}
      </div>

      <EvidenceModal
        open={openModal === "evidence"}
        onClose={() => setOpenModal(null)}
        result={result}
      />
      <VerifierModal
        open={openModal === "verifier"}
        onClose={() => setOpenModal(null)}
        rows={verificationRows}
      />
    </>
  );
}
