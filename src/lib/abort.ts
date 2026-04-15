// Cancellation helpers shared across the pipeline, fetch services, and the
// App shell. Kept as pure functions (no React, no Tauri) so they can be
// imported from anywhere without circular dependency risk.
//
// The pipeline calls throwIfAborted() at every loop boundary (before each
// repo/channel/bucket) so cancellation latency is bounded by the current
// in-flight HTTP call rather than the length of whatever loop we happen to
// be in. isAbortError() lets both the pipeline's inner try/catch blocks
// (which otherwise swallow errors with console.warn) and App.tsx's outer
// run* catch detect a user cancel and handle it differently from a real
// failure.

/**
 * Throws a DOMException with name "AbortError" if the signal has been
 * aborted. Call this at loop boundaries and before expensive sub-steps.
 * No-op when signal is undefined (unit-test-friendly).
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }
}

/**
 * Duck-type check for an AbortError. Matches the standard shape emitted by
 * fetch() when its signal aborts, and by throwIfAborted() above. Used by
 * inner catches to re-raise cancellations that would otherwise be silently
 * swallowed by existing error-tolerant fetch loops.
 */
export function isAbortError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  );
}
