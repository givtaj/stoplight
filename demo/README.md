# Stoplight Demo

This demo gives reviewers a local target page for manually exercising the built
Chrome extension.

## Run

From the repository root:

```bash
node demo/server.mjs
```

The server prints the local URL, usually `http://127.0.0.1:43118`.

## Demo Flow

1. Install the verified alpha ZIP, or build the extension with `cd extension && npm ci && npm run build`.
2. Load its extracted folder (or `extension/dist` for a local build) as an unpacked Chrome extension.
3. Open the demo URL printed by the server.
4. Open Stoplight, confirm the side panel shows the demo page as the arm target,
   and click `Arm Current Tab`.
5. Click `Send editable JSON`, edit the queued request in Stoplight, then click
   `Continue Edited`.
6. Queue three requests, confirm all pause, change one editor draft, then click `Play All`. All three originals should arrive once, in order; Play All does not apply unsent drafts.
7. Exercise the Unicode text, urlencoded, XML and bodyless examples, checking the received bytes.
8. Send multipart and binary examples to inspect the unchanged-only behavior, including file/PNG bytes.
9. Load the static image/script/stylesheet examples and confirm they do not pollute the paused queue.
10. Detach when finished. Held original traffic may proceed on detach; this is not a cancel action.

The page keeps a local event log so the reviewer can see when a request is still
pending and what the server received after Stoplight continues it.

The event log is in-memory process state only. It is useful demo evidence for
local forwarding behavior, not durable persistence or audit logging.
