# Chrome Web Store Copy

## Short Description

Pause, inspect, edit, and continue API requests from the current tab.

## Long Description

Stoplight is a Chrome MV3 extension for manual API request interception on one active tab at a time.

Use it when you want to pause matching XHR and fetch requests before they leave the browser, inspect the outgoing headers and body, make edits, and then continue a single request or release the whole queue in arrival order.

Stoplight is designed for hands-on API debugging rather than automated rewriting. It keeps the scope intentionally narrow:

- one active tab
- manual arm/detach flow
- request-stage interception only
- outgoing request editing only
- no response editing
- no saved presets or rewrite rules

The side panel shows the armed tab, the allowlist of origins that are eligible for interception, the paused queue, and a per-request editor for headers and body text. When you choose Play All, requests are released in the order they arrived.

## Feature Highlights

- Pause matching API requests before they are sent.
- Inspect the raw request metadata in a persistent side panel.
- Edit headers and textual bodies for supported request types.
- Continue one request or drain the queue with one action.
- Persist the current session state and per-origin allowlist locally in the browser.

## Permission Explanation

### `debugger`

Stoplight uses the Chrome Debugger API to attach to the active tab and control the DevTools Protocol `Fetch` and `Network` domains.

That permission is required because MV3 extensions cannot rely on blocking `webRequest` for this use case. The debugger permission lets Stoplight pause request-stage network traffic, inspect it, and continue it after edits are applied.

Stoplight does not use the debugger permission for general browsing or page content access. It only attaches to the single tab the user arms.

### `tabs`

Required to show and validate the website tab Stoplight is about to arm, especially when the Stoplight panel itself has focus. Stoplight uses tab URL and title metadata to reject unsupported Chrome pages and its own extension panel before attaching the debugger.

Stoplight does not use this permission to read page content or monitor all browsing. It uses it to present the intended target clearly and attach only after the user arms that target.

### `sidePanel`

Required to present the paused-request queue and request editor in a persistent side panel.

### `storage`

Required to persist the current session state and lightweight per-origin preferences across service-worker restarts.

### `activeTab`

Required for the user-initiated arm action on the selected tab.
