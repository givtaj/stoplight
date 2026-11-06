import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import {
  armCurrentTabFromSidePanel,
  continueUnchangedFromSidePanel,
  launchHarnessContext,
  launchStoplightHarness,
  startFixtureRequest,
  waitForFixtureRequest,
  waitForText,
} from "./support";

const SESSION_KEY = "stoplight.sessionState";
const PREFERENCES_KEY = "stoplight.preferences";
const SYNTHETIC_HEADER = "synthetic-alpha-lifecycle-header";
const SYNTHETIC_BODY = "synthetic-alpha-lifecycle-body-π";

type StorageSnapshot = {
  session: Record<string, unknown>;
  local: Record<string, unknown>;
};

async function readStorage(panel: Page): Promise<StorageSnapshot> {
  return panel.evaluate(async () => ({
    session: await chrome.storage.session.get(null),
    local: await chrome.storage.local.get(null),
  }));
}

async function record(testInfo: TestInfo, name: string, evidence: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
}

async function saveAllowlist(panel: Page, origin: string): Promise<void> {
  await panel.locator("#allowlist-input").fill(origin);
  await panel.locator("#save-allowlist-button").click();
  await expect.poll(async () => (await readStorage(panel)).local[PREFERENCES_KEY]).toEqual({
    allowlistsByOrigin: { [origin]: [origin] },
  });
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.locator("#app").waitFor();
  return panel;
}

async function arm(panel: Page, target: Page, origin: string): Promise<void> {
  await target.bringToFront();
  await panel.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel.locator("#arm-target-url")).toContainText(origin);
  await armCurrentTabFromSidePanel(panel, origin);
}

async function beginHeldRequest(panel: Page, target: Page, pathname: string): Promise<string> {
  const key = await startFixtureRequest(target, {
    url: pathname,
    method: "POST",
    headers: { "content-type": "text/plain", "x-stoplight": SYNTHETIC_HEADER },
    body: SYNTHETIC_BODY,
  });
  await expect(panel.locator(".queue-item strong")).toHaveText(pathname);
  await waitForText(panel, "#request-phase", "held");
  return key;
}

async function assertRearmWorks(panel: Page, target: Page, origin: string): Promise<void> {
  await arm(panel, target, origin);
  const key = await beginHeldRequest(panel, target, "/api/lifecycle-rearmed");
  await continueUnchangedFromSidePanel(panel);
  expect(await waitForFixtureRequest(target, key)).toMatchObject({ ok: true, status: 200 });
  await expect(panel.locator(".queue-item")).toHaveCount(0);
  await panel.locator("#detach-button").click();
  await waitForText(panel, "#status-pill", "detached");
}

test.describe("Developer alpha lifecycle and retention", () => {
  test("B8/B9 detach settles held traffic, clears captured payloads and permits rearm", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { context, sidePanel, targetPage, server } = harness;
    const observedNetwork: string[] = [];
    context.on("request", (request) => {
      if (/^https?:/.test(request.url())) observedNetwork.push(request.url());
    });
    try {
      const before = await readStorage(sidePanel);
      expect(JSON.stringify(before)).not.toContain(SYNTHETIC_BODY);
      const permissions = await sidePanel.evaluate(() => chrome.permissions.getAll());
      expect(permissions.permissions?.sort()).toEqual(["activeTab", "debugger", "sidePanel", "storage", "tabs"]);
      expect(permissions.origins ?? []).toEqual([]);

      await arm(sidePanel, targetPage, server.origin);
      await saveAllowlist(sidePanel, server.origin);
      server.reset();
      const key = await beginHeldRequest(sidePanel, targetPage, "/api/explicit-detach");
      expect(server.requestsSnapshot).toHaveLength(0);
      const held = await readStorage(sidePanel);
      expect(JSON.stringify(held.session)).toContain(SYNTHETIC_BODY);
      expect(JSON.stringify(held.session)).toContain(SYNTHETIC_HEADER);
      expect(JSON.stringify(held.local)).not.toContain(SYNTHETIC_BODY);
      expect(JSON.stringify(held.local)).not.toContain(SYNTHETIC_HEADER);

      await sidePanel.locator("#detach-button").click();
      await waitForText(sidePanel, "#status-pill", "detached");
      const outcome = await waitForFixtureRequest(targetPage, key);
      expect(outcome).toMatchObject({ ok: true, status: 200 });
      const receipt = await server.waitForRequest((request) => request.path === "/api/explicit-detach");
      expect(receipt.bodyBytes).toEqual(Array.from(Buffer.from(SYNTHETIC_BODY)));
      expect(receipt.headers["x-stoplight"]).toBe(SYNTHETIC_HEADER);
      expect(server.requestsSnapshot).toHaveLength(1);
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      const detached = await readStorage(sidePanel);
      expect(JSON.stringify(detached)).not.toContain(SYNTHETIC_BODY);
      expect(JSON.stringify(detached)).not.toContain(SYNTHETIC_HEADER);
      expect(detached.local).toEqual(held.local);
      expect(detached.session[SESSION_KEY]).toMatchObject({ debuggerStatus: "detached", queue: [] });
      await assertRearmWorks(sidePanel, targetPage, server.origin);
      expect(observedNetwork.every((url) => new URL(url).origin === server.origin)).toBe(true);
      await record(testInfo, "detach-retention-and-network", {
        before, held, detached, permissions, outcome, receipt, observedNetwork,
        scope: "Synthetic fixture traffic; observed browser-context network only. Detach releases original request, it does not cancel it.",
      });
    } finally {
      await harness.close();
    }
  });

  test("B8 closing the armed target settles transport and a new tab can be armed", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { context, sidePanel, targetPage, server } = harness;
    const terminal: Array<{ outcome: string; failure?: string | null }> = [];
    context.on("requestfailed", (request) => {
      if (request.url().endsWith("/api/close-target")) {
        terminal.push({ outcome: "failed", failure: request.failure()?.errorText });
      }
    });
    context.on("requestfinished", (request) => {
      if (request.url().endsWith("/api/close-target")) terminal.push({ outcome: "finished" });
    });
    try {
      await arm(sidePanel, targetPage, server.origin);
      server.reset();
      await beginHeldRequest(sidePanel, targetPage, "/api/close-target");
      expect(server.requestsSnapshot).toHaveLength(0);
      await targetPage.close();
      await expect.poll(() => terminal.length).toBe(1);
      await waitForText(sidePanel, "#status-pill", "detached");
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      const afterClose = await readStorage(sidePanel);
      expect(JSON.stringify(afterClose)).not.toContain(SYNTHETIC_BODY);
      const replacement = await context.newPage();
      await replacement.goto(server.url("/"));
      const normal = await startFixtureRequest(replacement, { url: "/api/new-tab-unarmed" });
      expect(await waitForFixtureRequest(replacement, normal)).toMatchObject({ ok: true, status: 200 });
      await assertRearmWorks(sidePanel, replacement, server.origin);
      await record(testInfo, "target-close-recovery", { terminal, afterClose, receipts: server.requestsSnapshot });
    } finally {
      await harness.close();
    }
  });

  test("B8 stopping the extension worker releases held traffic and requires explicit rearm", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { context, sidePanel, targetPage, server, extensionId } = harness;
    const cdp = await context.newCDPSession(sidePanel);
    const versions = new Map<string, { versionId: string; scriptURL: string; runningStatus: string }>();
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }) => {
      for (const version of updates) versions.set(version.versionId, version);
    });
    try {
      await cdp.send("ServiceWorker.enable");
      await arm(sidePanel, targetPage, server.origin);
      server.reset();
      const key = await beginHeldRequest(sidePanel, targetPage, "/api/worker-restart");
      expect(server.requestsSnapshot).toHaveLength(0);
      await expect.poll(() => [...versions.values()].some((version) =>
        version.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && version.runningStatus === "running",
      )).toBe(true);
      const version = [...versions.values()].find((item) =>
        item.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && item.runningStatus === "running",
      )!;
      await cdp.send("ServiceWorker.stopWorker", { versionId: version.versionId });
      await waitForText(sidePanel, "#status-pill", "detached", 15_000);
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      const outcome = await waitForFixtureRequest(targetPage, key);
      expect(outcome).toMatchObject({ ok: true, status: 200 });
      const receipt = await server.waitForRequest((request) => request.path === "/api/worker-restart");
      expect(receipt.bodyBytes).toEqual(Array.from(Buffer.from(SYNTHETIC_BODY)));
      expect(server.requestsSnapshot).toHaveLength(1);
      const restarted = await readStorage(sidePanel);
      expect(JSON.stringify(restarted)).not.toContain(SYNTHETIC_BODY);
      const normal = await startFixtureRequest(targetPage, { url: "/api/after-worker-restart" });
      expect(await waitForFixtureRequest(targetPage, normal)).toMatchObject({ ok: true, status: 200 });
      await assertRearmWorks(sidePanel, targetPage, server.origin);
      await record(testInfo, "worker-stop-recovery", { version, outcome, receipt, restarted });
    } finally {
      await cdp.detach().catch(() => undefined);
      await harness.close();
    }
  });

  test("B9 closing and reopening the same browser profile clears captured session data", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { sidePanel, targetPage, server, extensionId } = harness;
    let reopened: BrowserContext | undefined;
    try {
      await arm(sidePanel, targetPage, server.origin);
      await saveAllowlist(sidePanel, server.origin);
      server.reset();
      await beginHeldRequest(sidePanel, targetPage, "/api/browser-session-end");
      const held = await readStorage(sidePanel);
      expect(JSON.stringify(held.session)).toContain(SYNTHETIC_BODY);
      expect(JSON.stringify(held.local)).not.toContain(SYNTHETIC_BODY);
      await harness.context.close();
      reopened = await launchHarnessContext(harness.profileDir, harness.extensionPath);
      const panel = await openPanel(reopened, extensionId);
      await waitForText(panel, "#status-pill", "idle");
      const afterRestart = await readStorage(panel);
      expect(JSON.stringify(afterRestart)).not.toContain(SYNTHETIC_BODY);
      expect(JSON.stringify(afterRestart)).not.toContain(SYNTHETIC_HEADER);
      expect(afterRestart.local).toEqual(held.local);
      await expect(panel.locator(".queue-item")).toHaveCount(0);
      const target = await reopened.newPage();
      await target.goto(server.url("/"));
      const key = await startFixtureRequest(target, { url: "/api/new-browser-session" });
      expect(await waitForFixtureRequest(target, key)).toMatchObject({ ok: true, status: 200 });
      await assertRearmWorks(panel, target, server.origin);
      await record(testInfo, "browser-session-retention", {
        profileDir: harness.profileDir, held, afterRestart,
        observation: "Same profile reopened. Captured session headers/body gone; saved origin allowlist retained. No silent rearm.",
      });
    } finally {
      await reopened?.close();
      await harness.close();
    }
  });

  test("B10 detach then extension reload preserves normal traffic without silently rearming", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { context, sidePanel, targetPage, server, extensionId } = harness;
    try {
      await arm(sidePanel, targetPage, server.origin);
      server.reset();
      const held = await beginHeldRequest(sidePanel, targetPage, "/api/before-reload");
      await sidePanel.locator("#detach-button").click();
      expect(await waitForFixtureRequest(targetPage, held)).toMatchObject({ ok: true, status: 200 });
      await waitForText(sidePanel, "#status-pill", "detached");
      const previousWorker = context.serviceWorkers().find((worker) =>
        worker.url().startsWith(`chrome-extension://${extensionId}/`),
      );
      expect(previousWorker).toBeDefined();
      let previousWorkerClosed = false;
      previousWorker!.once("close", () => { previousWorkerClosed = true; });
      await sidePanel.evaluate(() => setTimeout(() => chrome.runtime.reload(), 0));
      await expect.poll(() => previousWorkerClosed).toBe(true);
      await expect.poll(() => context.serviceWorkers().some((worker) =>
        worker !== previousWorker && worker.url().startsWith(`chrome-extension://${extensionId}/`),
      )).toBe(true);
      const panel = await openPanel(context, extensionId);
      await expect(panel.locator("#status-pill")).toHaveText(/^(idle|detached)$/);
      await expect(panel.locator(".queue-item")).toHaveCount(0);
      const key = await startFixtureRequest(targetPage, { url: "/api/after-extension-reload" });
      expect(await waitForFixtureRequest(targetPage, key)).toMatchObject({ ok: true, status: 200 });
      await assertRearmWorks(panel, targetPage, server.origin);
      await record(testInfo, "extension-reload-recovery", {
        storage: await readStorage(panel), receipts: server.requestsSnapshot,
        scope: "Reload of the same unpacked candidate after detach, not an update from an earlier release.",
      });
    } finally {
      await harness.close();
    }
  });

  test("B10 detach then uninstall removes control and ordinary requests keep working", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const { context, sidePanel, targetPage, server, extensionId } = harness;
    const cdp = await context.newCDPSession(targetPage);
    try {
      await arm(sidePanel, targetPage, server.origin);
      server.reset();
      const held = await beginHeldRequest(sidePanel, targetPage, "/api/before-uninstall");
      await sidePanel.locator("#detach-button").click();
      expect(await waitForFixtureRequest(targetPage, held)).toMatchObject({ ok: true, status: 200 });
      await waitForText(sidePanel, "#status-pill", "detached");
      await cdp.send("Extensions.uninstall", { id: extensionId });
      await expect.poll(() => context.serviceWorkers().some((worker) =>
        worker.url().startsWith(`chrome-extension://${extensionId}/`),
      )).toBe(false);
      const key = await startFixtureRequest(targetPage, { url: "/api/after-uninstall" });
      expect(await waitForFixtureRequest(targetPage, key)).toMatchObject({ ok: true, status: 200 });
      const receipts = server.requestsSnapshot.filter((request) => request.path.startsWith("/api/"));
      expect(receipts.map((request) => request.path)).toEqual(["/api/before-uninstall", "/api/after-uninstall"]);
      await record(testInfo, "uninstall-recovery", {
        extensionId, receipts,
        scope: "CDP uninstall of this disposable profile's unpacked extension after explicit detach; native disable/remove UI checked separately.",
      });
    } finally {
      await cdp.detach().catch(() => undefined);
      await harness.close();
    }
  });
});
