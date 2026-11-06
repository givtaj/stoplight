import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

export type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyBytes: number[];
  receivedAtMs: number;
};

export type StoplightHarness = {
  context: BrowserContext;
  extensionId: string;
  sidePanel: Page;
  targetPage: Page;
  server: TestServer;
  profileDir: string;
  extensionPath: string;
  close(): Promise<void>;
};

export class TestServer {
  private readonly requests: CapturedRequest[] = [];
  private readonly png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==",
    "base64",
  );
  private readonly server: ReturnType<typeof createServer> | ReturnType<typeof createHttpsServer>;
  private certificateDirectory?: string;

  private constructor(private port: number, private readonly secure: boolean) {
    const listener = (req: IncomingMessage, res: ServerResponse) => {
      void this.handleRequest(req, res);
    };
    if (secure) {
      // This key exists only for synthetic loopback traffic, never a real site.
      this.certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "stoplight-fixture-tls-"));
      const key = path.join(this.certificateDirectory, "key.pem");
      const cert = path.join(this.certificateDirectory, "cert.pem");
      const config = path.join(this.certificateDirectory, "openssl.cnf");
      fs.writeFileSync(config, "[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-config", config], { stdio: "ignore" });
      this.server = createHttpsServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, listener);
    } else {
      this.server = createServer(listener);
    }
  }

  static async create(options: { https?: boolean } = {}): Promise<TestServer> {
    const server = new TestServer(0, options.https ?? false);
    await new Promise<void>((resolve, reject) => {
      server.server.once("error", reject);
      server.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server.");
    }
    server.port = address.port;
    return server;
  }

  get origin(): string {
    return `${this.secure ? "https" : "http"}://127.0.0.1:${this.port}`;
  }

  get requestsSnapshot(): CapturedRequest[] {
    return [...this.requests];
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    if (this.certificateDirectory) {
      fs.rmSync(this.certificateDirectory, { recursive: true });
      this.certificateDirectory = undefined;
    }
  }

  reset(): void {
    this.requests.length = 0;
  }

  url(pathname: string): string {
    return `${this.origin}${pathname}`;
  }

  async waitForRequestCount(count: number, timeoutMs = 5000): Promise<void> {
    await waitFor(() => this.requests.length >= count, timeoutMs, () => {
      throw new Error(
        `Timed out waiting for ${count} request(s); saw ${this.requests.length}.`,
      );
    });
  }

  async expectRequestCountToRemain(count: number, quietMs = 250): Promise<void> {
    const deadline = Date.now() + quietMs;
    do {
      if (this.requests.length !== count) {
        throw new Error(`Expected exactly ${count} deliveries, observed ${this.requests.length}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
  }

  async waitForRequest(
    predicate: (request: CapturedRequest) => boolean,
    timeoutMs = 5000,
  ): Promise<CapturedRequest> {
    await waitFor(() => this.requests.some(predicate), timeoutMs, () => {
      throw new Error("Timed out waiting for the expected request.");
    });

    const found = this.requests.find(predicate);
    if (!found) {
      throw new Error("Expected request was not captured.");
    }
    return found;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);
    const body = await readBody(req);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    this.requests.push({
      method: req.method ?? "GET",
      path: url.pathname + url.search,
      headers: req.headers,
      body: body.toString("utf8"),
      bodyBytes: Array.from(body),
      receivedAtMs: Date.now(),
    });

    if (url.pathname === "/asset.png") {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      res.end(this.png);
      return;
    }

    if (url.pathname === "/asset.css") {
      res.writeHead(200, { "Content-Type": "text/css", "Cache-Control": "no-store" });
      res.end("#static-style-proof { color: rgb(12, 34, 56); }");
      return;
    }

    if (url.pathname === "/asset.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      res.end("window.__stoplightStaticScriptLoaded = true;");
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Stoplight Test</title></head><body><main id="app"></main></body></html>`);
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        path: url.pathname,
        method: req.method ?? "GET",
        body: body.toString("utf8"),
      }),
    );
  }
}

export async function launchStoplightHarness(
  testInfo: TestInfo,
  options: { https?: boolean } = {},
): Promise<StoplightHarness> {
  const server = await TestServer.create(options);
  const extensionPath = resolveExtensionPath();

  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    await server.close();
    throw new Error(
      `Missing built extension at ${extensionPath}. Run \`npm run build\` in the extension package first.`,
    );
  }

  const profileDir = testInfo.outputPath("profile");
  const ownsDisposableProfile = !fs.existsSync(profileDir);
  const removeDisposableProfile = () => {
    // Only the exact profile newly created by this harness is disposable.
    // Test attachments/receipts remain in the surrounding output directory.
    if (ownsDisposableProfile) fs.rmSync(profileDir, { recursive: true, force: true });
  };
  let launchedContext: BrowserContext | undefined;
  try {
    const context = await launchHarnessContext(profileDir, extensionPath);
    launchedContext = context;
    const extensionId = await waitForExtensionId(context);
    const targetPage = await context.newPage();
    await targetPage.goto(server.url("/"));
    await targetPage.bringToFront();
    // Initial navigation is not a request under test. The data-URL favicon also
    // prevents a late browser favicon request from contaminating receipt counts.
    server.reset();

    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidePanel.waitForSelector("#app");
    await targetPage.bringToFront();

    return {
      context,
      extensionId,
      sidePanel,
      targetPage,
      server,
      profileDir,
      extensionPath,
      async close() {
        let contextClosed = false;
        try {
          await context.close();
          contextClosed = true;
        } finally {
          try {
            await server.close();
          } finally {
            if (contextClosed) removeDisposableProfile();
          }
        }
      },
    };
  } catch (error) {
    // Setup failures must not leave a listener/profile alive and stall the run.
    let contextClosed = false;
    if (launchedContext) {
      await launchedContext.close().then(() => { contextClosed = true; }).catch(() => undefined);
    }
    await server.close().catch(() => undefined);
    if (contextClosed) removeDisposableProfile();
    throw error;
  }
}

export async function launchHarnessContext(
  profileDir: string,
  extensionPath: string,
): Promise<BrowserContext> {
  const browserExecutablePath = resolveBrowserExecutablePath();
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    // Only these isolated test contexts trust the ephemeral loopback fixture cert.
    ignoreHTTPSErrors: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
}

export type FixtureRequestOutcome = {
  ok: boolean;
  status?: number;
  text?: string;
  error?: string;
};

export async function startFixtureRequest(page: Page, input: {
  url: string;
  transport?: "fetch" | "xhr";
  method?: string;
  headers?: Record<string, string>;
  body?: string | number[];
  key?: string;
}): Promise<string> {
  const key = input.key ?? `request-${Date.now()}-${Math.random()}`;
  await page.evaluate(({ request, key }) => {
    const win = window as Window & {
      __stoplightFixtureRequests?: Record<string, Promise<FixtureRequestOutcome>>;
    };
    win.__stoplightFixtureRequests ??= {};
    const body = Array.isArray(request.body) ? new Uint8Array(request.body) : request.body;
    const promise: Promise<FixtureRequestOutcome> = request.transport === "xhr"
      ? new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open(request.method ?? "POST", request.url);
          for (const [name, value] of Object.entries(request.headers ?? {})) xhr.setRequestHeader(name, value);
          xhr.onload = () => resolve({ ok: true, status: xhr.status, text: xhr.responseText });
          xhr.onerror = () => resolve({ ok: false, error: "XHR network error" });
          xhr.onabort = () => resolve({ ok: false, error: "XHR aborted" });
          xhr.send(body ?? null);
        })
      : fetch(request.url, {
          method: request.method ?? "POST",
          headers: request.headers,
          body,
        }).then(async (response) => ({ ok: true, status: response.status, text: await response.text() }))
          .catch((error: unknown) => ({ ok: false, error: String(error) }));
    win.__stoplightFixtureRequests[key] = promise;
  }, { request: input, key });
  return key;
}

export async function waitForFixtureRequest(page: Page, key: string): Promise<FixtureRequestOutcome> {
  return page.evaluate(async (key) => {
    const requests = (window as Window & {
      __stoplightFixtureRequests?: Record<string, Promise<FixtureRequestOutcome>>;
    }).__stoplightFixtureRequests;
    if (!requests?.[key]) throw new Error(`Unknown fixture request: ${key}`);
    return requests[key];
  }, key);
}

export async function dispatchClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing clickable element for selector: ${sel}`);
    }
    element.click();
  }, selector);
}

export async function setTextAreaValue(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({ sel, nextValue }) => {
      const element = document.querySelector(sel);
      if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error(`Missing textarea for selector: ${sel}`);
      }

      element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: selector, nextValue: value },
  );
}

export async function armCurrentTabFromSidePanel(
  page: Page,
  expectedOrigin?: string,
): Promise<void> {
  await dispatchClick(page, "#arm-button");
  await waitForStatus(page, "attached");

  if (expectedOrigin) {
    await waitForSessionTabUrlToContain(page, expectedOrigin);
  }
}

export async function continueEditedFromSidePanel(
  page: Page,
  options: {
    headerText?: string;
    bodyText?: string;
  } = {},
): Promise<void> {
  if (typeof options.headerText === "string") {
    await setTextAreaValue(page, "#headers-editor", options.headerText);
  }

  if (typeof options.bodyText === "string") {
    await setTextAreaValue(page, "#body-editor", options.bodyText);
  }

  await dispatchClick(page, "#continue-edited-button");
}

export async function continueUnchangedFromSidePanel(page: Page): Promise<void> {
  await dispatchClick(page, "#continue-unchanged-button");
}

export async function playAllFromSidePanel(page: Page): Promise<void> {
  await dispatchClick(page, "#play-all-button");
}

export async function readText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) {
      throw new Error(`Missing element for selector: ${sel}`);
    }
    return element.textContent ?? "";
  }, selector);
}

export async function waitForText(
  page: Page,
  selector: string,
  text: string,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(
      async () => readText(page, selector),
      {
        timeout: timeoutMs,
      },
    )
    .toBe(text);
}

export async function waitForSessionTabUrlToContain(
  page: Page,
  expected: string,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(
      async () => readText(page, "#tab-url"),
      {
        timeout: timeoutMs,
      },
    )
    .toContain(expected);
}

export async function waitForQueueLength(
  page: Page,
  expectedLength: number,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelectorAll(".queue-item").length),
      {
        timeout: timeoutMs,
      },
    )
    .toBe(expectedLength);
}

export async function readQueueLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".queue-item strong")).map(
      (element) => element.textContent ?? "",
    ),
  );
}

export async function readBodyEditorDisabled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.querySelector("#body-editor");
    return element instanceof HTMLTextAreaElement ? element.disabled : false;
  });
}

export async function readBodyHint(page: Page): Promise<string> {
  return readText(page, "#body-hint");
}

export async function waitForStatus(page: Page, expected: string, timeoutMs = 5000): Promise<void> {
  await expect
    .poll(
      async () => readText(page, "#status-pill"),
      {
        timeout: timeoutMs,
      },
    )
    .toBe(expected);
}

export async function waitForBannerToContain(
  page: Page,
  expected: string,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(
      async () => readText(page, "#banner"),
      {
        timeout: timeoutMs,
      },
    )
    .toContain(expected);
}

export async function waitForServiceWorker(
  context: BrowserContext,
  workerUrl: string,
  timeoutMs = 5000,
): Promise<void> {
  await expect
    .poll(
      async () => context.serviceWorkers().map((worker) => worker.url()),
      {
        timeout: timeoutMs,
      },
    )
    .toContain(workerUrl);
}

function resolveExtensionPath(): string {
  const override = process.env.STOPLIGHT_EXTENSION_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.resolve(process.cwd(), "dist");
}

function resolveBrowserExecutablePath(): string | null {
  const override = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }

  return null;
}

async function waitForExtensionId(context: BrowserContext): Promise<string> {
  const probePage = await context.newPage();
  try {
    await probePage.goto("chrome://extensions/");
    await probePage.waitForFunction(() => {
      const manager = document.querySelector("extensions-manager");
      const list = manager?.shadowRoot?.querySelector("extensions-item-list");
      return (list?.shadowRoot?.querySelectorAll("extensions-item").length ?? 0) > 0;
    });

    const extensionId = await probePage.evaluate(() => {
      const manager = document.querySelector("extensions-manager");
      const list = manager?.shadowRoot?.querySelector("extensions-item-list");
      const cards = list?.shadowRoot?.querySelectorAll("extensions-item");

      if (!cards || !cards.length) {
        return null;
      }

      const stoplightCard = Array.from(cards).find((card) => {
        const name = card.shadowRoot?.querySelector("#name")?.textContent?.trim();
        return name === "Stoplight";
      });

      return (stoplightCard ?? cards[0])?.id ?? null;
    });

    if (!extensionId) {
      throw new Error("Failed to identify the Stoplight extension on chrome://extensions.");
    }

    return extensionId;
  } finally {
    await probePage.close();
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  onTimeout: () => never,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  onTimeout();
}
