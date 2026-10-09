import { createServer } from "node:http";

const requestedPort = Number.parseInt(process.env.PORT ?? "43118", 10);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3ZsL0AAAAASUVORK5CYII=",
  "base64",
);
const received = [];

const server = createServer(async (req, res) => {
  const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
  const url = new URL(req.url ?? "/", origin);
  const body = await readBody(req);

  if (url.pathname === "/") {
    sendHtml(res, pageHtml());
    return;
  }

  if (url.pathname === "/asset.png") {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    res.end(png);
    return;
  }

  if (url.pathname === "/api/log") {
    sendJson(res, { received });
    return;
  }

  if (url.pathname === "/api/reset") {
    received.length = 0;
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const record = {
      method: req.method ?? "GET",
      path: url.pathname,
      headers: {
        "content-type": req.headers["content-type"] ?? null,
        "x-stoplight": req.headers["x-stoplight"] ?? null,
      },
      body,
      receivedAt: new Date().toISOString(),
    };
    received.push(record);
    sendJson(res, {
      ok: true,
      record,
      receivedCount: received.length,
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind Stoplight demo server.");
  }

  console.log(`Stoplight demo: http://127.0.0.1:${address.port}`);
});

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, payload) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stoplight Demo Target</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111314;
      --panel: #1b2022;
      --panel-2: #22282b;
      --line: #374145;
      --text: #f3f7f5;
      --muted: #aeb8b4;
      --green: #58d68d;
      --red: #ff6b5d;
      --amber: #ffd166;
      --blue: #8ecae6;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .shell {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: end;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    h1 {
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: 0;
    }

    .lede {
      max-width: 700px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.55;
    }

    .status {
      min-width: 240px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }

    .status span {
      display: block;
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .status strong {
      display: block;
      margin-top: 6px;
      font-size: 1.4rem;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(280px, 0.85fr) minmax(320px, 1.15fr);
      gap: 18px;
      margin-top: 24px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }

    .panel-head {
      padding: 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }

    .panel-head p {
      color: var(--muted);
      line-height: 1.45;
      margin-top: 4px;
    }

    .actions {
      display: grid;
      gap: 10px;
      padding: 16px;
    }

    button {
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #293135;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      text-align: left;
      padding: 10px 12px;
    }

    button:hover {
      border-color: var(--green);
    }

    button strong {
      display: block;
      margin-bottom: 3px;
    }

    button span {
      display: block;
      color: var(--muted);
      font-size: 0.86rem;
      line-height: 1.35;
    }

    .log {
      height: 590px;
      overflow: auto;
      padding: 0;
      list-style: none;
      margin: 0;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 0.85rem;
    }

    .log li {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      white-space: pre-wrap;
      line-height: 1.45;
    }

    .tag {
      display: inline-block;
      margin-right: 8px;
      color: #0d1612;
      background: var(--green);
      border-radius: 999px;
      padding: 2px 7px;
      font-family: inherit;
      font-size: 0.72rem;
      font-weight: 700;
    }

    .tag.pending {
      background: var(--amber);
    }

    .tag.error {
      background: var(--red);
    }

    .tag.info {
      background: var(--blue);
    }

    img {
      display: block;
      width: 24px;
      height: 24px;
      image-rendering: pixelated;
      margin-top: 8px;
    }

    @media (max-width: 820px) {
      header,
      .grid {
        grid-template-columns: 1fr;
      }

      .status {
        min-width: 0;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Stoplight demo target</h1>
        <p class="lede">Use this page with the unpacked Stoplight extension. Each button starts browser traffic that should pause in the side panel before the server sees it.</p>
      </div>
      <div class="status">
        <span>Server receipts</span>
        <strong id="receipt-count">0</strong>
      </div>
    </header>

    <main class="grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Demo actions</h2>
          <p>Arm this tab in Stoplight before sending requests.</p>
        </div>
        <div class="actions">
          <button id="send-json">
            <strong>Send editable JSON</strong>
            <span>Pause, edit header/body, then continue edited.</span>
          </button>
          <button id="send-queue">
            <strong>Queue two requests</strong>
            <span>Both should wait in Stoplight until Play All.</span>
          </button>
          <button id="send-text">
            <strong>Send plain text</strong>
            <span>Shows non-JSON textual body editing.</span>
          </button>
          <button id="send-form">
            <strong>Send multipart form</strong>
            <span>Expected v0.1 behavior: inspect-only body.</span>
          </button>
          <button id="load-asset">
            <strong>Load static asset</strong>
            <span>Expected v0.1 behavior: no paused queue noise.</span>
          </button>
          <button id="reset-log">
            <strong>Reset server log</strong>
            <span>Clear the receipt counter and local event log.</span>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>Event log</h2>
          <p>Pending means the browser request has started but Stoplight has not continued it yet.</p>
        </div>
        <ol id="log" class="log"></ol>
      </section>
    </main>
  </div>

  <script>
    const log = document.querySelector("#log");
    const count = document.querySelector("#receipt-count");
    let sequence = 0;

    document.querySelector("#send-json").addEventListener("click", () => {
      runFetch("editable JSON", "/api/orders/draft", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stoplight": "original"
        },
        body: JSON.stringify({ status: "original", amount: 42 })
      });
    });

    document.querySelector("#send-queue").addEventListener("click", () => {
      runFetch("queue request 1", "/api/queue/1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: 1 })
      });
      runFetch("queue request 2", "/api/queue/2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: 2 })
      });
    });

    document.querySelector("#send-text").addEventListener("click", () => {
      runFetch("plain text", "/api/plain-text", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "manual payload from demo page"
      });
    });

    document.querySelector("#send-form").addEventListener("click", () => {
      const form = new FormData();
      form.append("alpha", "bravo");
      form.append("charlie", "delta");
      runFetch("multipart form", "/api/form", {
        method: "POST",
        body: form
      });
    });

    document.querySelector("#load-asset").addEventListener("click", () => {
      const image = new Image();
      image.alt = "Loaded static asset";
      image.src = "/asset.png?nonce=" + Date.now();
      image.onload = () => append("info", "static asset loaded without fetch/XHR queue pressure");
      image.onerror = () => append("error", "static asset failed to load");
      document.querySelector(".actions").appendChild(image);
      append("pending", "loading static asset via <img>");
    });

    document.querySelector("#reset-log").addEventListener("click", async () => {
      await fetch("/api/reset", { method: "POST" });
      log.replaceChildren();
      sequence = 0;
      await refreshCount();
      append("info", "server log reset");
    });

    refreshCount();
    append("info", "demo page ready");

    async function runFetch(label, url, options) {
      const id = ++sequence;
      append("pending", "#" + id + " " + label + " started: " + url);
      try {
        const response = await fetch(url, options);
        const payload = await response.json();
        append("ok", "#" + id + " server received:\\n" + JSON.stringify(payload.record, null, 2));
        await refreshCount();
      } catch (error) {
        append("error", "#" + id + " failed: " + (error && error.message ? error.message : String(error)));
      }
    }

    async function refreshCount() {
      const response = await fetch("/api/log");
      const payload = await response.json();
      count.textContent = String(payload.received.length);
    }

    function append(kind, text) {
      const item = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "tag " + (kind === "ok" ? "" : kind);
      tag.textContent = kind.toUpperCase();
      item.append(tag, document.createTextNode(text));
      log.prepend(item);
    }
  </script>
</body>
</html>`;
}
