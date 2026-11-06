// Where the upload pipeline (ingest.js) is right now, shared with the progress overlay.
// It lives outside React state on purpose: a stage change should re-render only <LoadOverlay>, not the whole app and the
// page behind it, and the pipeline needs to commit each stage synchronously (flushSync) before it blocks the main thread.
let state = null; // null when idle, otherwise { stage, file, i, n }
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export const loadStore = {
  get: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update(patch) {
    state = { ...state, ...patch };
    emit();
  },
  clear() {
    if (!state) return;
    state = null;
    emit();
  },
};

export const STAGE_TEXT = {
  opening: "Getting your File Ready…",
  reading: "Reading File…",
  parsing: "Parsing Requests…",
  analyzing: "Checking for Issues…",
  rendering: "Building the View…",
};
