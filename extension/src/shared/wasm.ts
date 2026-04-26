import type {
  ComputeDiffInput,
  ContinueBuildInput,
  ContinueCommand,
  DecodeBodyInput,
  NormalizeRequestInput,
  RequestDiff,
  RequestRecord,
  SessionEvent,
  SessionState,
} from "./types";
import initGeneratedWasm, * as generatedWasm from "stoplight-wasm-generated";

export interface StoplightWasmApi {
  normalizeRequest(input: NormalizeRequestInput): RequestRecord;
  decodeBody(input: DecodeBodyInput): RequestRecord["body"];
  buildContinuePayload(input: ContinueBuildInput): ContinueCommand;
  computeDiff(input: ComputeDiffInput): RequestDiff;
  reduceSessionEvent(state: SessionState, event: SessionEvent): SessionState;
}

interface GeneratedModule {
  normalize_request(input: unknown): unknown;
  decode_body(input: unknown): unknown;
  build_continue_payload(input: unknown): unknown;
  compute_diff(input: unknown): unknown;
  reduce_session_event(state: unknown, event: unknown): unknown;
}

type WasmLoader = () => Promise<GeneratedModule>;

let cachedWasmPromise: Promise<StoplightWasmApi> | null = null;

export function loadStoplightWasm(loader: WasmLoader = defaultLoader): Promise<StoplightWasmApi> {
  if (!cachedWasmPromise) {
    cachedWasmPromise = loader().then(wrapGeneratedModule);
  }
  return cachedWasmPromise;
}

export function resetWasmCache(): void {
  cachedWasmPromise = null;
}

async function defaultLoader(): Promise<GeneratedModule> {
  await initGeneratedWasm();
  return generatedWasm;
}

function wrapGeneratedModule(module: GeneratedModule): StoplightWasmApi {
  return {
    normalizeRequest(input) {
      return module.normalize_request(input) as RequestRecord;
    },
    decodeBody(input) {
      return module.decode_body(input) as RequestRecord["body"];
    },
    buildContinuePayload(input) {
      return module.build_continue_payload(input) as ContinueCommand;
    },
    computeDiff(input) {
      return module.compute_diff(input) as RequestDiff;
    },
    reduceSessionEvent(state, event) {
      return module.reduce_session_event(state, event) as SessionState;
    },
  };
}
