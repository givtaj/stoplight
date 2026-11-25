import { expect, test, type Page } from "@playwright/test";

import { PREFERENCES_STORAGE_KEY, SESSION_STORAGE_KEY } from "../../src/shared/types";
import {
  armCurrentTabFromSidePanel,
  continueEditedFromSidePanel,
  launchStoplightHarness,
  setTextAreaValue,
  startFixtureRequest,
  waitForFixtureRequest,
  type StoplightHarness,
} from "./support";

function backgroundWorker({ context, extensionId }: StoplightHarness) {
  const worker = context.serviceWorkers().find((entry) => entry.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!worker) throw new Error("Stoplight's service worker was not available.");
  return worker;
}

async function readStorage(panel: Page) {
  return panel.evaluate(async () => ({
    session: await chrome.storage.session.get(null),
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
}

test("captured data stays in session storage and an edit reaches the original URL", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo);
  try {
    const { server, sidePanel, targetPage } = harness;
    await armCurrentTabFromSidePanel(sidePanel, server.origin);
    const path = "/api/notes?sample=fixture-query";
    const request = await startFixtureRequest(targetPage, {
      url: server.url(path),
      body: "fixture-original-body",
      headers: { "x-fixture": "fixture-original-header" },
    });
    await expect(sidePanel.locator("#body-editor")).toHaveValue("fixture-original-body");
    await setTextAreaValue(sidePanel, "#body-editor", "fixture-edited-body");
    // Exercise the durable preference writer while a capture and an unsent draft exist.
    await setTextAreaValue(sidePanel, "#allowlist-input", server.url("/unused?sample=fixture-preference"));
    await sidePanel.locator("#save-allowlist-button").click();
    const preferences = { [PREFERENCES_STORAGE_KEY]: { allowlistsByOrigin: { [server.origin]: [server.origin] } } };
    await expect.poll(async () => (await readStorage(sidePanel)).local).toEqual(preferences);
    const held = await readStorage(sidePanel);
    expect(held.session[SESSION_STORAGE_KEY].queue).toMatchObject([{
      url: server.url(path),
      headers: expect.arrayContaining([{ name: expect.stringMatching(/^x-fixture$/i), value: "fixture-original-header" }]),
      body: { text: "fixture-original-body" },
    }]);
    expect(JSON.stringify(held.session)).not.toContain("fixture-edited-body");
    expect(held.sync).toEqual({});
    expect(server.requestsSnapshot).toEqual([]);

    await continueEditedFromSidePanel(sidePanel);
    expect((await waitForFixtureRequest(targetPage, request)).ok).toBe(true);
    expect(server.requestsSnapshot).toMatchObject([{ method: "POST", path, body: "fixture-edited-body" }]);
    await expect.poll(async () => (await readStorage(sidePanel)).session[SESSION_STORAGE_KEY].queue).toEqual([]);
    const released = await readStorage(sidePanel);
    expect(JSON.stringify(released.session)).not.toMatch(/fixture-(query|original|edited)/);
    expect(released.local).toEqual(preferences);
    expect(released.sync).toEqual({});
  } finally {
    await harness.close();
  }
});

test("the panel and worker cannot initiate connections to a website", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo);
  try {
    const { server, sidePanel } = harness;
    const worker = backgroundWorker(harness);
    // The receiver is reachable from the normal website. no-cors makes a CORS failure
    // insufficient to pass the extension check: a transmitted opaque request would resolve.
    const probe = async (url: string) => {
      try {
        await fetch(url, { mode: "no-cors", credentials: "omit" });
        return "delivered";
      } catch {
        return "blocked";
      }
    };
    expect(await harness.targetPage.evaluate(probe, server.url("/control"))).toBe("delivered");
    expect(server.requestsSnapshot.map((entry) => entry.path)).toEqual(["/control"]);
    server.reset();
    expect(await sidePanel.evaluate(probe, server.url("/panel-probe"))).toBe("blocked");
    expect(await worker.evaluate(probe, server.url("/worker-probe"))).toBe("blocked");
    await server.expectRequestCountToRemain(0);
  } finally {
    await harness.close();
  }
});

test("closing the last idle panel stops observing navigation until the panel reopens", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo);
  try {
    const { server, sidePanel, targetPage, context } = harness;
    const worker = backgroundWorker(harness);
    const panelUrl = sidePanel.url();
    const listeners = () => worker.evaluate(() => ({
      tabChanges: chrome.tabs.onUpdated.hasListeners(),
      activations: chrome.tabs.onActivated.hasListeners(),
    }));
    await expect(sidePanel.locator("#arm-target-url")).toHaveText(targetPage.url());
    await expect.poll(listeners).toEqual({ tabChanges: true, activations: true });
    await sidePanel.close();
    await expect.poll(listeners).toEqual({ tabChanges: false, activations: false });

    const privateUrl = server.url("/?sample=closed-panel-navigation");
    await targetPage.goto(privateUrl);
    const session = await worker.evaluate(() => chrome.storage.session.get(null));
    expect(JSON.stringify(session)).not.toContain("closed-panel-navigation");

    const reopened = await context.newPage();
    await reopened.goto(panelUrl);
    await expect(reopened.locator("#arm-target-url")).toHaveText(privateUrl);
    await expect.poll(listeners).toEqual({ tabChanges: true, activations: true });
  } finally {
    await harness.close();
  }
});
