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
