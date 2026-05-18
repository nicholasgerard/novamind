import type {
  LiteratureRunState,
  LiteratureTimingEvent,
  LiteratureTimingPhase,
} from "./types";

type TimingFields = Omit<
  LiteratureTimingEvent,
  "elapsedMs" | "phase" | "stage"
>;

/**
 * Create a scoped timing logger for a literature stage. The pipeline package
 * does not know about HTTP or Cloudflare; callers provide `onTiming` when they
 * want these phase markers mirrored into production logs.
 */
export function startLiteratureTiming(
  state: LiteratureRunState,
  stage: string,
  fields: TimingFields = {},
): (phase: LiteratureTimingPhase, fields?: TimingFields) => void {
  const startedAt = Date.now();
  emitLiteratureTiming(state, {
    ...fields,
    phase: "start",
    stage,
  });
  return (phase, nextFields = {}) => {
    emitLiteratureTiming(state, {
      ...fields,
      ...nextFields,
      elapsedMs: Date.now() - startedAt,
      phase,
      stage,
    });
  };
}

export function emitLiteratureTiming(
  state: LiteratureRunState,
  event: LiteratureTimingEvent,
): void {
  state.args.onTiming?.(event);
}
