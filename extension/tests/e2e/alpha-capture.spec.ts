import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

import {
  armCurrentTabFromSidePanel,
  continueUnchangedFromSidePanel,
  launchStoplightHarness,
  startFixtureRequest,
  waitForFixtureRequest,
  waitForText,
} from "./support";

test("B6 oversized textual capture stays inspect-only and preserves the full original bytes", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo);
  const { context, sidePanel, targetPage, server } = harness;
  const pathname = "/api/oversized-text";
  // Exceed the one-MiB capture cap in UTF-8 bytes, including multibyte text.
  // The actual request is sent through Chrome; no CDP result is stubbed.
  const originalBody = `synthetic-large-body-start\n${"界🙂".repeat(200_000)}\nsynthetic-large-body-end`;
  const expectedBytes = Buffer.from(originalBody, "utf8");
  expect(expectedBytes.byteLength).toBeGreaterThan(1024 * 1024);
  const completed: string[] = [];
  context.on("requestfinished", (request) => {
    if (request.url() === server.url(pathname)) completed.push(request.url());
  });

  try {
    await targetPage.bringToFront();
    await armCurrentTabFromSidePanel(sidePanel, server.origin);
    server.reset();
    const key = await startFixtureRequest(targetPage, {
      url: pathname,
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-stoplight": "synthetic-oversized-capture",
      },
      body: originalBody,
    });

    await expect(sidePanel.locator(".queue-item strong")).toHaveText(pathname);
    await waitForText(sidePanel, "#request-phase", "held");
    expect(server.requestsSnapshot).toHaveLength(0);
    expect(completed).toHaveLength(0);
    await expect(sidePanel.locator("#body-hint")).toContainText("truncated");
    await expect(sidePanel.locator("#body-editor")).toBeDisabled();
    await expect(sidePanel.locator("#headers-editor")).toBeDisabled();
    await expect(sidePanel.locator("#continue-edited-button")).toBeDisabled();
    await expect(sidePanel.locator("#continue-unchanged-button")).toBeEnabled();
    const preview = await sidePanel.locator("#body-editor").inputValue();
    expect(Buffer.byteLength(preview)).toBeLessThan(expectedBytes.byteLength);
    expect(originalBody.startsWith(preview)).toBe(true);

    await continueUnchangedFromSidePanel(sidePanel);
    const outcome = await waitForFixtureRequest(targetPage, key);
    expect(outcome).toMatchObject({ ok: true, status: 200 });
    const received = await server.waitForRequest((request) => request.path === pathname);
    const receivedBytes = Buffer.from(received.bodyBytes);
    expect(receivedBytes.byteLength).toBe(expectedBytes.byteLength);
    expect(receivedBytes.equals(expectedBytes)).toBe(true);
    expect(received.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(received.headers["x-stoplight"]).toBe("synthetic-oversized-capture");
    expect(server.requestsSnapshot).toHaveLength(1);
    await expect.poll(() => completed.length).toBe(1);
    await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
    await waitForText(sidePanel, "#request-phase", "forwarded");

    await testInfo.attach("oversized-capture-preservation", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        source: "Real browser Fetch POST; synthetic multibyte payload; no mocked capture response",
        originalBytes: expectedBytes.byteLength,
        previewBytes: Buffer.byteLength(preview),
        receivedBytes: receivedBytes.byteLength,
        originalSha256: createHash("sha256").update(expectedBytes).digest("hex"),
        receivedSha256: createHash("sha256").update(receivedBytes).digest("hex"),
        receiptCount: server.requestsSnapshot.length,
        completedRequestCount: completed.length,
        pageOutcome: { ok: outcome.ok, status: outcome.status },
      }, null, 2)),
    });
  } finally {
    await harness.close();
  }
});

test("B6 unavailable streaming capture is visibly inspect-only and forwards original bytes", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo, { http2: true });
  const { context, sidePanel, targetPage, server, extensionId } = harness;
  const pathname = "/api/unavailable-stream";
  type CaptureFaultEvidence = {
    failures: number;
    nativeEvents: Array<{
      hasPostData?: boolean;
      inlinePostDataPresent: boolean;
      networkIdPresent: boolean;
    }>;
  };
  try {
    await targetPage.bringToFront();
    await armCurrentTabFromSidePanel(sidePanel, server.origin);
    server.reset();
    const worker = context.serviceWorkers().find((candidate) =>
      candidate.url().startsWith(`chrome-extension://${extensionId}/`),
    );
    expect(worker).toBeDefined();
    await worker!.evaluate((pathname) => {
      const scope = globalThis as typeof globalThis & { __stoplightCaptureFault?: CaptureFaultEvidence };
      const evidence: CaptureFaultEvidence = { failures: 0, nativeEvents: [] };
      scope.__stoplightCaptureFault = evidence;
      // Observe Chrome's real pause packet without modifying it or UI/storage.
      chrome.debugger.onEvent.addListener((_source, method, params) => {
        if (method !== "Fetch.requestPaused") return;
        const event = params as {
          networkId?: string;
          request?: { url?: string; postData?: string; hasPostData?: boolean };
        };
        if (!event.request?.url?.endsWith(pathname)) return;
        evidence.nativeEvents.push({
          hasPostData: event.request.hasPostData,
          inlinePostDataPresent: typeof event.request.postData === "string",
          networkIdPresent: typeof event.networkId === "string",
        });
      });
      const original = chrome.debugger.sendCommand.bind(chrome.debugger);
      chrome.debugger.sendCommand = ((...args: Parameters<typeof original>) => {
        if (args[1] === "Network.getRequestPostData") {
          chrome.debugger.sendCommand = original;
          evidence.failures += 1;
          // The production adapter wraps Chrome's callback API in a Promise,
          // so this simulates an actual capture-command rejection, once only.
          throw new Error("Synthetic unavailable request-body capture");
        }
        return original(...args);
      }) as typeof chrome.debugger.sendCommand;
    }, pathname);

    const expected = await targetPage.evaluate((pathname) => {
      const bytes = new TextEncoder().encode("Synthetic streaming capture: café ☕ 東京\nOriginal body must survive unchanged.");
      let offset = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 7, bytes.length);
          controller.enqueue(bytes.slice(offset, end));
          offset = end;
        },
      });
      const contentType = "text/plain; charset=utf-8";
      const request = new Request(new URL(pathname, location.href), {
        method: "POST",
        headers: { "content-type": contentType, "x-stoplight": "synthetic-unavailable-capture" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const win = window as Window & {
        __stoplightUnavailableRequest?: Promise<{ ok: boolean; status: number }>;
      };
      win.__stoplightUnavailableRequest = fetch(request).then(async (response) => {
        await response.text();
        return { ok: response.ok, status: response.status };
      });
      return { bytes: Array.from(bytes), contentType };
    }, pathname);

    await expect(sidePanel.locator(".queue-item strong")).toHaveText(pathname);
    await waitForText(sidePanel, "#request-phase", "held");
    const faultEvidence = await worker!.evaluate(() =>
      (globalThis as typeof globalThis & { __stoplightCaptureFault?: CaptureFaultEvidence }).__stoplightCaptureFault,
    );
    await testInfo.attach("native-capture-fault-probe", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(faultEvidence, null, 2)),
    });
    // These assertions prevent an incidental inspect-only MIME pass from
    // masquerading as coverage of the missing-capture handling path.
    expect(faultEvidence?.failures).toBe(1);
    expect(faultEvidence?.nativeEvents).toHaveLength(1);
    expect(faultEvidence?.nativeEvents[0]).toMatchObject({
      inlinePostDataPresent: false,
      networkIdPresent: true,
    });
    const capturedBody = await sidePanel.evaluate(async (pathname) => {
      const state = (await chrome.storage.session.get("stoplight.sessionState"))["stoplight.sessionState"] as {
        queue: Array<{ url: string; body: { captureStatus?: string; editable: boolean; text: string; reason: string | null } }>;
      };
      return state.queue.find((request) => request.url.endsWith(pathname))?.body;
    }, pathname);
    expect(capturedBody).toMatchObject({ captureStatus: "unavailable", editable: false, text: "" });
    await expect(sidePanel.locator("#body-hint")).toContainText(/unavailable/i);
    await expect(sidePanel.locator("#body-editor")).toBeDisabled();
    await expect(sidePanel.locator("#headers-editor")).toBeDisabled();
    await expect(sidePanel.locator("#continue-edited-button")).toBeDisabled();
    await expect(sidePanel.locator("#continue-unchanged-button")).toBeEnabled();
    await server.expectRequestCountToRemain(0);

    await continueUnchangedFromSidePanel(sidePanel);
    const outcome = await targetPage.evaluate(async () =>
      (window as Window & { __stoplightUnavailableRequest?: Promise<{ ok: boolean; status: number }> }).__stoplightUnavailableRequest,
    );
    expect(outcome).toEqual({ ok: true, status: 200 });
    const received = await server.waitForRequest((request) => request.path === pathname);
    expect(received.bodyBytes).toEqual(expected.bytes);
    expect(received.httpVersion).toBe("2.0");
    expect(received.headers["content-type"]).toBe(expected.contentType);
    expect(received.headers["x-stoplight"]).toBe("synthetic-unavailable-capture");
    await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
    await waitForText(sidePanel, "#request-phase", "forwarded");
    await server.expectRequestCountToRemain(1);
    await testInfo.attach("unavailable-capture-preservation", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        profileDir: harness.profileDir,
        extensionPath: harness.extensionPath,
        source: "Real ReadableStream Fetch upload over HTTP/2 TLS; one Network.getRequestPostData failure injected; native pause event and UI/storage unmodified",
        faultEvidence,
        capturedBody,
        originalBytes: expected.bytes.length,
        receivedBytes: received.bodyBytes.length,
        originalSha256: createHash("sha256").update(Buffer.from(expected.bytes)).digest("hex"),
        receivedSha256: createHash("sha256").update(Buffer.from(received.bodyBytes)).digest("hex"),
        receiptCount: server.requestsSnapshot.length,
        httpVersion: received.httpVersion,
        outcome,
      }, null, 2)),
    });
  } finally {
    await harness.close();
  }
});
