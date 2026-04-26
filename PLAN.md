# Stoplight Plan

## Summary

Build `stoplight` as a Chrome MV3 extension for manual request interception on one active tab at a time. The extension should pause matching API requests before they are sent, show each paused request in a persistent side panel, let the user inspect and edit headers/body, then either continue one request or release the whole queue with a global play action.

Use a thin TypeScript extension shell plus a Rust/WASM core. The TS layer owns Chrome APIs, debugger transport, side panel UI, and message passing. The Rust/WASM layer owns request models, body decoding/encoding, validation, diffing, and session-state reduction.

Platform constraint already verified from official docs: MV3 cannot use blocking `webRequest` for most extensions, so the implementation should use [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger) with CDP [`Fetch`](https://chromedevtools.github.io/devtools-protocol/) rather than relying on [`webRequestBlocking`](https://developer.chrome.com/docs/extensions/reference/api/webRequest). Use [`chrome.sidePanel`](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), require Chrome 118+ for stable MV3 service-worker behavior, and include `wasm-unsafe-eval` in MV3 CSP for WASM support per Chrome’s extensions notes: [MV3 WASM CSP](https://developer.chrome.com/docs/extensions/whats-new).

## Implementation Changes

- Convert the repo into a Rust workspace with:
  - `crates/core`: pure Rust domain logic.
  - `crates/wasm`: `wasm-bindgen` exports for browser use.
  - `extension/`: MV3 extension app, built with Vite + TypeScript.
- Extension manifest:
  - `manifest_version: 3`
  - permissions: `debugger`, `sidePanel`, `storage`, `activeTab`
  - `minimum_chrome_version: "118"`
  - no broad default host permissions
  - side panel page and background service worker
  - CSP updated for WASM
- Service worker responsibilities:
  - arm/disarm interception for the current tab only
  - attach via `chrome.debugger.attach({ tabId }, "1.3")`
  - enable `Network` and `Fetch`
  - pause only request-stage API traffic for an origin allowlist seeded from the current tab origin
  - maintain paused-request queue and session lifecycle
  - persist live session state in `chrome.storage.session`
  - persist lightweight preferences in `chrome.storage.local`
- Side panel responsibilities:
  - session header with armed tab, origin allowlist, and status
  - paused-request queue ordered by arrival
  - request detail view with raw headers editor and body editor
  - actions: `Continue unchanged`, `Continue edited`, `Play all`, `Detach`
- Request editing rules:
  - v1 edits only outgoing requests, not responses
  - v1 supports editing headers and textual bodies
  - editable body types: JSON, urlencoded form data, plain text, XML-ish text
  - multipart and binary bodies are inspect-only in v1 and may only continue unchanged
- Matching and flow:
  - interception is single-tab, manual-session, no saved presets or automation
  - matching is an editable origin allowlist, seeded from the current tab origin
  - per-request continue sends the latest draft for that request
  - global play drains the paused queue in arrival order
  - if the debugger detaches, the UI must show the session as terminated and require a fresh arm
- Rust/WASM public surface:
  - `normalize_request`
  - `decode_body`
  - `build_continue_payload`
  - `compute_diff`
  - `reduce_session_event`
- Shared DTOs:
  - `SessionState`
  - `RequestRecord`
  - `EditableBody`
  - `HeaderDraft`
  - `ContinueCommand`
  - `DebuggerStatus`

## Test Plan

- Rust unit tests:
  - request normalization
  - JSON/text/urlencoded decode and encode
  - header validation
  - body diff generation
  - queue reducer behavior
  - multipart/binary non-editable detection
- TS unit/integration tests:
  - debugger lifecycle controller
  - side panel to worker message flow
  - storage rehydration after worker restart
  - `continue_all` queue ordering
  - detach handling
- Browser E2E with Playwright and unpacked extension:
  - arm one tab and verify matching API requests pause before send
  - edit a JSON POST request and verify the server receives the modified payload
  - pause multiple requests and verify `Play all` releases them in arrival order
  - verify static assets are not paused in v1
  - verify multipart/binary requests are visible but not editable
  - verify opening DevTools causes a visible detach/error state instead of a silent hang
- Release checks:
  - verify Chrome permission warnings are accurate and justified
  - verify the Chrome Web Store listing explains the `debugger` permission clearly

## Assumptions

- v1 is Chrome-only and MV3-only.
- v1 is optimized for manual API testing, not freezing every asset by default.
- v1 is single-tab only.
- v1 has no response editing, multi-tab control, saved presets, or auto-rewrite rules.
- A thin TS shell is acceptable even though Rust is preferred, because Chrome extension APIs are not practical to implement directly in pure Rust.
