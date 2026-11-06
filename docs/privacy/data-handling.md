# Privacy and Data Handling

## Summary

Stoplight is designed to keep its data handling local to the browser.

## Data Collected and Stored

Stoplight stores the following browser-local data:

- The armed tab session state, including the current queue of paused requests.
- The shown arm target URL and title, plus the current tab URL and title while a session is active.
- The per-origin allowlist used to decide which requests should be paused.
- Captured request URLs (including query strings), methods, headers and available request bodies needed to present the paused queue and continue requests. These may contain cookies, authorization tokens, personal data or other secrets from the website being debugged.
- Session status, timestamps, forwarded-request counts and the latest error/detach reason.

## Data Location

- Session state is stored in `chrome.storage.session`.
- Lightweight preferences are stored in `chrome.storage.local`.
- The Rust/WASM code runs locally inside the extension bundle.

## Retention and Clearing

Continuing a request removes it from the stored queue. Detaching clears the queue and its captured headers/bodies, but the session can retain tab URL/title, origin allowlist, counters and status metadata. Editor drafts live in the panel's memory, rather than the persistent origin preferences.

Chrome clears `storage.session` when the extension is disabled, reloaded or updated, and when the browser restarts. Origin allowlists in `storage.local` survive those actions. Removing Stoplight clears its local extension storage. Clearing ordinary browsing history is not a reliable way to remove extension preferences. These storage lifetimes follow [Chrome's storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage#storage-areas); the release receipt records which lifecycle paths were exercised.

## Network Behavior

Stoplight does not require its own backend service for v0.1.

The extension works by attaching to the active tab through Chrome's Debugger API and using the DevTools Protocol `Fetch` and `Network` domains to pause matching outgoing requests. It does not proxy traffic through an external server.

Stoplight also reads tab URL and title metadata so the side panel can show the website target before arming and reject unsupported pages such as `chrome://` URLs or Stoplight's own panel.

## Data Sharing

Stoplight has no telemetry or external backend and does not send captured data to a separate service. Continuing a request sends it to its original destination, with edits only when explicitly requested. Play All sends originals. Detachment or browser cleanup may also let held original requests proceed; pausing is not cancellation. The destination website still handles requests according to its own behavior and privacy practices.

## User Control

Users can:

- detach the session at any time,
- review the website target before arming,
- clear the extension's stored browser data,
- remove the extension,
- and re-arm only the tab they want to inspect.

## v0.1 Scope Notes

- No account system.
- No cloud sync.
- No analytics pipeline.
- No remote storage of captured requests.
- No saved presets.
