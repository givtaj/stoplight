import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  receivedAtMs: number;
};

type StoplightHarness = {
  context: BrowserContext;
  extensionId: string;
  sidePanel: Page;
  targetPage: Page;
  server: TestServer;
  close(): Promise<void>;
};

export class TestServer {
  private readonly requests: CapturedRequest[] = [];
  private readonly png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3ZsL0AAAAASUVORK5CYII=",
    "base64",
  );
  private server = createServer((req, res) => {
    void this.handleRequest(req, res);
  });

  private constructor(private port: number) {}

  static async create(): Promise<TestServer> {
    const server = new TestServer(0);
    await new Promise<void>((resolve) => {
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
    return `http://127.0.0.1:${this.port}`;
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

    this.requests.push({
      method: req.method ?? "GET",
      path: url.pathname + url.search,
      headers: req.headers,
      body,
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

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Stoplight Test</title></head><body><main id="app"></main></body></html>`);
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
        body,
      }),
    );
  }
}

export async function launchStoplightHarness(testInfo: TestInfo): Promise<StoplightHarness> {
  const server = await TestServer.create();
  const extensionPath = resolveExtensionPath();

  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    await server.close();
    throw new Error(
      `Missing built extension at ${extensionPath}. Run \`npm run build\` in the extension package first.`,
    );
  }

  const browserExecutablePath = resolveBrowserExecutablePath();
  const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), {
    headless: false,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const extensionId = await waitForExtensionId(context);
  const targetPage = await context.newPage();
  await targetPage.goto(server.url("/"));
  await targetPage.bringToFront();

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
    async close() {
      await context.close();
      await server.close();
    },
  };
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
