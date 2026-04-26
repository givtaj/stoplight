# Privacy and Data Handling

## Summary

Stoplight is designed to keep its data handling local to the browser.

## Data Collected and Stored

Stoplight stores the following browser-local data:

- The armed tab session state, including the current queue of paused requests.
- The current tab URL and title while a session is active.
- The per-origin allowlist used to decide which requests should be paused.
- Request metadata needed to present the paused queue and continue requests.

## Data Location

- Session state is stored in `chrome.storage.session`.
- Lightweight preferences are stored in `chrome.storage.local`.
- The Rust/WASM code runs locally inside the extension bundle.

## Network Behavior

Stoplight does not require its own backend service for v0.1.

The extension works by attaching to the active tab through Chrome's Debugger API and using the DevTools Protocol `Fetch` and `Network` domains to pause matching outgoing requests. It does not proxy traffic through an external server.

## Data Sharing

Stoplight does not intentionally send request data to third-party services. Request metadata and request bodies stay inside the browser session unless the user continues them to the target site.

## User Control

Users can:

- detach the session at any time,
- clear the extension's stored browser data,
- remove the extension,
- and re-arm only the tab they want to inspect.

## v0.1 Scope Notes

- No account system.
- No cloud sync.
- No analytics pipeline.
- No remote storage of captured requests.
- No saved presets.
