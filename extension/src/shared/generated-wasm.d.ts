declare module "stoplight-wasm-generated" {
  export default function init(
    input?:
      | RequestInfo
      | URL
      | Response
      | BufferSource
      | WebAssembly.Module,
  ): Promise<unknown>;

  export function normalize_request(input: unknown): unknown;
  export function decode_body(input: unknown): unknown;
  export function build_continue_payload(input: unknown): unknown;
  export function compute_diff(input: unknown): unknown;
  export function reduce_session_event(state: unknown, event: unknown): unknown;
}
