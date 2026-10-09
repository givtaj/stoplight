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

1. Build the extension with `cd extension && npm run build`.
2. Load `extension/dist` as an unpacked Chrome extension.
3. Open the demo URL printed by the server.
4. Open Stoplight, confirm the side panel shows the demo page as the arm target,
   and click `Arm Current Tab`.
5. Click `Send editable JSON`, edit the queued request in Stoplight, then click
   `Continue Edited`.
6. Click `Queue two requests`, confirm both pause, then click `Play All`.
7. Click `Send multipart form` to inspect the v0.1 non-editable body behavior.
8. Click `Load static asset` and confirm it does not pollute the paused queue.

The page keeps a local event log so the reviewer can see when a request is still
pending and what the server received after Stoplight continues it.

The event log is in-memory process state only. It is useful demo evidence for
local forwarding behavior, not durable persistence or audit logging.
