import { expect, test, type TestInfo } from "@playwright/test";

import {
  armCurrentTabFromSidePanel,
  continueUnchangedFromSidePanel,
  dispatchClick,
  launchStoplightHarness,
  playAllFromSidePanel,
  setTextAreaValue,
  startFixtureRequest,
  TestServer,
  waitForFixtureRequest,
  waitForText,
  type StoplightHarness,
} from "./support";

async function receipt(testInfo: TestInfo, harness: StoplightHarness, extra: object = {}) {
  await testInfo.attach("synthetic-fixture-evidence", {
    contentType: "application/json",
    body: JSON.stringify({
      scenario: testInfo.title,
      profileDir: harness.profileDir,
      extensionPath: harness.extensionPath,
      origin: harness.server.origin,
      requests: harness.server.requestsSnapshot,
      ...extra,
    }, null, 2),
  });
}

test.describe("Alpha B2 target and origin boundaries", () => {
  test("only the armed tab and allowed origin pause across HTTP and HTTPS", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    const otherServer = await TestServer.create({ https: true });
    try {
      const { context, targetPage, sidePanel, server } = harness;
      const otherTab = await context.newPage();
      await otherTab.goto(server.url("/?other-tab=1"));
      await targetPage.bringToFront();
      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-url")).toHaveText(targetPage.url());
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      server.reset();
      otherServer.reset();

      const held = await startFixtureRequest(targetPage, {
        url: server.url("/api/armed"), headers: { "content-type": "text/plain" }, body: "armed original",
      });
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/armed");
      expect(server.requestsSnapshot).toHaveLength(0);

      const otherTabRequest = await startFixtureRequest(otherTab, {
        url: server.url("/api/other-tab"), transport: "xhr", headers: { "content-type": "text/plain" }, body: "other tab original",
      });
      expect((await waitForFixtureRequest(otherTab, otherTabRequest)).ok).toBe(true);
      const outsideOrigin = await startFixtureRequest(targetPage, {
        url: otherServer.url("/api/not-allowed"), headers: { "content-type": "text/plain" }, body: "excluded origin original",
      });
      expect((await waitForFixtureRequest(targetPage, outsideOrigin)).ok).toBe(true);
      expect(server.requestsSnapshot.map((item) => item.path)).toEqual(["/api/other-tab"]);
      expect(otherServer.requestsSnapshot.map((item) => item.path)).toEqual(["/api/not-allowed"]);
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/armed");

      await setTextAreaValue(sidePanel, "#allowlist-input", `${server.origin}\n${otherServer.origin}`);
      await dispatchClick(sidePanel, "#save-allowlist-button");
      await waitForText(sidePanel, "#allowlist-count", "2 origins");
      const nowAllowed = await startFixtureRequest(targetPage, {
        url: otherServer.url("/api/now-allowed"), transport: "xhr", headers: { "content-type": "text/plain" }, body: "HTTPS allowed original",
      });
      await expect(sidePanel.locator(".queue-item strong")).toHaveText(["/api/armed", "/api/now-allowed"]);
      expect(otherServer.requestsSnapshot).toHaveLength(1);
      await playAllFromSidePanel(sidePanel);
      expect((await waitForFixtureRequest(targetPage, held)).ok).toBe(true);
      expect((await waitForFixtureRequest(targetPage, nowAllowed)).ok).toBe(true);
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      expect((await server.waitForRequest((item) => item.path === "/api/armed")).body).toBe("armed original");
      expect((await otherServer.waitForRequest((item) => item.path === "/api/now-allowed")).body).toBe("HTTPS allowed original");
      await server.expectRequestCountToRemain(2);
      await otherServer.expectRequestCountToRemain(2);
      await receipt(testInfo, harness, { otherOrigin: otherServer.origin, otherRequests: otherServer.requestsSnapshot });
    } finally {
      await harness.close();
      await otherServer.close();
    }
  });

  test("rejects stale target identity before explicit review and re-arm", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { context, targetPage, sidePanel, server } = harness;
      const original = await sidePanel.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((tab) => tab.url === url)?.id;
      }, targetPage.url());
      expect(original).toBeDefined();
      const otherTab = await context.newPage();
      await otherTab.goto(server.url("/?target=second"));
      await otherTab.bringToFront();
      await sidePanel.evaluate(({ id, url }) => {
        const port = chrome.runtime.connect({ name: "stoplight-panel" });
        (window as Window & { __staleTargetPort?: chrome.runtime.Port }).__staleTargetPort = port;
        port.postMessage({ type: "armActiveTab", expectedTabId: id, expectedTabUrl: url });
      }, { id: original, url: targetPage.url() });
      await expect(sidePanel.locator("#banner")).toContainText("Arm target changed");
      await waitForText(sidePanel, "#status-pill", "idle");
      server.reset();
      const unarmed = await startFixtureRequest(otherTab, { url: "/api/stale-target", method: "GET" });
      expect((await waitForFixtureRequest(otherTab, unarmed)).ok).toBe(true);
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);

      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-url")).toContainText("target=second");
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      const reviewed = await startFixtureRequest(otherTab, { url: "/api/reviewed-target", method: "GET" });
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/reviewed-target");
      expect(server.requestsSnapshot).toHaveLength(1);
      await continueUnchangedFromSidePanel(sidePanel);
      expect((await waitForFixtureRequest(otherTab, reviewed)).ok).toBe(true);
      await server.expectRequestCountToRemain(2);
      await receipt(testInfo, harness, { staleTargetId: original });
    } finally {
      await harness.close();
    }
  });

  test("Chrome pages and the extension page cannot become an accidental arm target", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { context, targetPage, sidePanel } = harness;
      await targetPage.close();
      const internalPage = await context.newPage();
      await internalPage.goto("chrome://version/");
      await internalPage.bringToFront();
      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-status")).toHaveText("unsupported");
      await expect(sidePanel.locator("#arm-button")).toBeDisabled();
      await waitForText(sidePanel, "#status-pill", "idle");
      await sidePanel.bringToFront();
      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-status")).toHaveText("unsupported");
      await expect(sidePanel.locator("#arm-button")).toBeDisabled();
      await waitForText(sidePanel, "#status-pill", "idle");
      await receipt(testInfo, harness);
    } finally {
      await harness.close();
    }
  });

  test("same-tab navigation invalidates the previously reviewed URL", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { targetPage, sidePanel, server } = harness;
      const oldUrl = targetPage.url();
      const tabId = await sidePanel.evaluate(async (url) => {
        return (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id;
      }, oldUrl);
      expect(tabId).toBeDefined();
      await targetPage.goto(server.url("/?navigated=1"));
      await targetPage.bringToFront();
      await sidePanel.evaluate(({ id, url }) => {
        const port = chrome.runtime.connect({ name: "stoplight-panel" });
        (window as Window & { __staleUrlPort?: chrome.runtime.Port }).__staleUrlPort = port;
        port.postMessage({ type: "armActiveTab", expectedTabId: id, expectedTabUrl: url });
      }, { id: tabId, url: oldUrl });
      await expect(sidePanel.locator("#banner")).toContainText(/target changed|review/i);
      await waitForText(sidePanel, "#status-pill", "idle");
      server.reset();
      const unarmed = await startFixtureRequest(targetPage, { url: "/api/stale-url", method: "GET" });
      expect((await waitForFixtureRequest(targetPage, unarmed)).ok).toBe(true);
      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-url")).toContainText("navigated=1");
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      const reviewed = await startFixtureRequest(targetPage, { url: "/api/reviewed-url", method: "GET" });
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/reviewed-url");
      expect(server.requestsSnapshot).toHaveLength(1);
      await continueUnchangedFromSidePanel(sidePanel);
      expect((await waitForFixtureRequest(targetPage, reviewed)).ok).toBe(true);
      await server.expectRequestCountToRemain(2);
      await receipt(testInfo, harness, { oldUrl, reviewedUrl: targetPage.url(), tabId });
    } finally {
      await harness.close();
    }
  });
});

const editedCases = [
  { label: "JSON Fetch HTTP", https: false, transport: "fetch", mime: "application/json", original: '{"value":"before"}', edited: '{"value":"after","unicode":"café ☕"}' },
  { label: "Unicode text XHR HTTPS", https: true, transport: "xhr", mime: "text/plain;charset=UTF-8", original: "Original café 🌍", edited: "Edited ñ € 東京 🌈" },
  { label: "urlencoded Fetch HTTP", https: false, transport: "fetch", mime: "application/x-www-form-urlencoded", original: "name=before&city=Madrid", edited: "name=Aid%C3%ADn&city=Barcelona%20centre" },
  { label: "XML XHR HTTPS", https: true, transport: "xhr", mime: "application/xml", original: "<item>before</item>", edited: "<item label=\"café\">東京 &amp; €</item>" },
  { label: "nonempty to empty Fetch HTTPS", https: true, transport: "fetch", mime: "text/plain", original: "erase these bytes", edited: "" },
] as const;

test.describe("Alpha B3 exact request edits", () => {
  for (const scenario of editedCases) {
    test(scenario.label, async ({}, testInfo) => {
      const harness = await launchStoplightHarness(testInfo, { https: scenario.https });
      try {
        const { targetPage, sidePanel, server } = harness;
        await armCurrentTabFromSidePanel(sidePanel, server.origin);
        const key = await startFixtureRequest(targetPage, {
          url: "/api/edit-matrix", transport: scenario.transport,
          headers: { "content-type": scenario.mime, "x-stoplight-original": "before" }, body: scenario.original,
        });
        await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/edit-matrix");
        expect(server.requestsSnapshot).toHaveLength(0);
        await expect(sidePanel.locator("#body-editor")).toHaveValue(scenario.original);
        const headers = await sidePanel.locator("#headers-editor").inputValue();
        await setTextAreaValue(sidePanel, "#headers-editor", headers.replace("x-stoplight-original: before", "x-stoplight-original: after") + "\nx-stoplight-added: synthetic");
        await setTextAreaValue(sidePanel, "#body-editor", scenario.edited);
        await sidePanel.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>("#continue-edited-button")!;
          button.click(); button.click(); button.click();
        });
        const captured = await server.waitForRequest((item) => item.path === "/api/edit-matrix");
        expect(captured.bodyBytes).toEqual(Array.from(Buffer.from(scenario.edited, "utf8")));
        expect(captured.headers["x-stoplight-original"]).toBe("after");
        expect(captured.headers["x-stoplight-added"]).toBe("synthetic");
        expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
        await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
        await server.expectRequestCountToRemain(1);
        await receipt(testInfo, harness, { transport: scenario.transport, expectedBody: scenario.edited });
      } finally {
        await harness.close();
      }
    });
  }

  for (const transport of ["fetch", "xhr"] as const) {
    test(`bodyless ${transport} preserves zero bytes and application headers`, async ({}, testInfo) => {
      const harness = await launchStoplightHarness(testInfo, { https: transport === "fetch" });
      try {
        const { targetPage, sidePanel, server } = harness;
        await armCurrentTabFromSidePanel(sidePanel, server.origin);
        const key = await startFixtureRequest(targetPage, { url: "/api/bodyless", transport, method: "GET", headers: { "x-stoplight-original": "unchanged" } });
        await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/bodyless");
        expect(server.requestsSnapshot).toHaveLength(0);
        await continueUnchangedFromSidePanel(sidePanel);
        const captured = await server.waitForRequest((item) => item.path === "/api/bodyless");
        expect(captured.method).toBe("GET");
        expect(captured.bodyBytes).toEqual([]);
        expect(captured.headers["x-stoplight-original"]).toBe("unchanged");
        expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
        await server.expectRequestCountToRemain(1);
        await receipt(testInfo, harness);
      } finally {
        await harness.close();
      }
    });
  }

  test("Continue Unchanged ignores edited body and header drafts", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo, { https: true });
    try {
      const { targetPage, sidePanel, server } = harness;
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      const body = "Original UTF-8: café 🌍\nSecond line";
      const key = await startFixtureRequest(targetPage, { url: "/api/original", transport: "xhr", headers: { "content-type": "text/plain;charset=UTF-8", "x-stoplight-original": "preserve" }, body });
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/original");
      expect(server.requestsSnapshot).toHaveLength(0);
      await setTextAreaValue(sidePanel, "#body-editor", "Discard this draft");
      await setTextAreaValue(sidePanel, "#headers-editor", "content-type: application/json\nx-stoplight-original: discard");
      await continueUnchangedFromSidePanel(sidePanel);
      const captured = await server.waitForRequest((item) => item.path === "/api/original");
      expect(captured.bodyBytes).toEqual(Array.from(Buffer.from(body)));
      expect(captured.headers["content-type"]).toBe("text/plain;charset=UTF-8");
      expect(captured.headers["x-stoplight-original"]).toBe("preserve");
      expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
      await server.expectRequestCountToRemain(1);
      await receipt(testInfo, harness);
    } finally {
      await harness.close();
    }
  });
});

test("Alpha B4 Play All sends three originals once in arrival order despite a draft", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo);
  try {
    const { targetPage, sidePanel, server } = harness;
    await armCurrentTabFromSidePanel(sidePanel, server.origin);
    const keys: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      keys.push(await startFixtureRequest(targetPage, { url: `/api/fifo/${index}`, transport: index === 2 ? "xhr" : "fetch", headers: { "content-type": "text/plain", "x-order": String(index) }, body: `original ${index}` }));
      await expect(sidePanel.locator(".queue-item")).toHaveCount(index);
    }
    expect(server.requestsSnapshot).toHaveLength(0);
    await expect(sidePanel.locator(".queue-item strong")).toHaveText(["/api/fifo/1", "/api/fifo/2", "/api/fifo/3"]);
    await sidePanel.locator(".queue-item").nth(1).click();
    await setTextAreaValue(sidePanel, "#body-editor", "unsent draft");
    await setTextAreaValue(sidePanel, "#headers-editor", "content-type: text/plain\nx-order: edited");
    await expect(sidePanel.locator("#play-all-button")).toContainText("Originals");
    await expect(sidePanel.locator(".queue-panel")).toContainText(/draft|unchanged/i);
    await sidePanel.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>("#play-all-button")!;
      button.click(); button.click(); button.click();
    });
    for (const key of keys) expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
    await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
    expect(server.requestsSnapshot.map((item) => item.path)).toEqual(["/api/fifo/1", "/api/fifo/2", "/api/fifo/3"]);
    expect(server.requestsSnapshot.map((item) => item.body)).toEqual(["original 1", "original 2", "original 3"]);
    expect(server.requestsSnapshot.map((item) => item.headers["x-order"])).toEqual(["1", "2", "3"]);
    await server.expectRequestCountToRemain(3);
    await receipt(testInfo, harness);
  } finally {
    await harness.close();
  }
});

test("Alpha B5 image stylesheet and script load while an API request remains held", async ({}, testInfo) => {
  const harness = await launchStoplightHarness(testInfo, { https: true });
  try {
    const { targetPage, sidePanel, server } = harness;
    await armCurrentTabFromSidePanel(sidePanel, server.origin);
    const key = await startFixtureRequest(targetPage, { url: "/api/static-boundary", body: "held", headers: { "content-type": "text/plain" } });
    await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/static-boundary");
    expect(server.requestsSnapshot).toHaveLength(0);
    const result = await targetPage.evaluate(async () => {
      function loaded(element: HTMLElement) {
        return new Promise<void>((resolve, reject) => {
          element.onload = () => resolve();
          element.onerror = () => reject(new Error(`Static fixture failed: ${element.tagName}`));
          document.head.appendChild(element);
        });
      }
      const proof = document.createElement("div");
      proof.id = "static-style-proof";
      document.body.appendChild(proof);
      const img = new Image(); img.src = "/asset.png";
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/asset.css";
      const script = document.createElement("script"); script.src = "/asset.js";
      await Promise.all([loaded(img), loaded(link), loaded(script)]);
      await img.decode();
      return {
        image: [img.naturalWidth, img.naturalHeight],
        color: getComputedStyle(proof).color,
        script: (window as Window & { __stoplightStaticScriptLoaded?: boolean }).__stoplightStaticScriptLoaded,
      };
    });
    expect(result).toEqual({ image: [1, 1], color: "rgb(12, 34, 56)", script: true });
    expect(server.requestsSnapshot.map((item) => item.path).sort()).toEqual(["/asset.css", "/asset.js", "/asset.png"]);
    await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/static-boundary");
    await continueUnchangedFromSidePanel(sidePanel);
    expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
    await server.expectRequestCountToRemain(4);
    await receipt(testInfo, harness, { observedAssets: result });
  } finally {
    await harness.close();
  }
});

test.describe("Alpha B7 invalid edits and failure recovery", () => {
  for (const invalidHeaders of ["bad name: rejected", "x-stoplight: safe\ninjected-without-colon"]) {
    test(`rejects invalid headers ${JSON.stringify(invalidHeaders)}`, async ({}, testInfo) => {
      const harness = await launchStoplightHarness(testInfo);
      try {
        const { targetPage, sidePanel, server } = harness;
        await armCurrentTabFromSidePanel(sidePanel, server.origin);
        const key = await startFixtureRequest(targetPage, { url: "/api/invalid-edit", headers: { "content-type": "text/plain", "x-stoplight-original": "preserve" }, body: "original" });
        await expect(sidePanel.locator(".queue-item")).toHaveCount(1);
        await setTextAreaValue(sidePanel, "#headers-editor", invalidHeaders);
        await dispatchClick(sidePanel, "#continue-edited-button");
        await expect(sidePanel.locator("#banner")).toBeVisible();
        await expect(sidePanel.locator("#banner")).toContainText(/header|invalid|colon/i);
        await expect(sidePanel.locator(".queue-item")).toHaveCount(1);
        await server.expectRequestCountToRemain(0);
        await sidePanel.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>("#continue-unchanged-button")!;
          button.click(); button.click(); button.click();
        });
        expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
        await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
        expect(server.requestsSnapshot[0]?.body).toBe("original");
        expect(server.requestsSnapshot[0]?.headers["x-stoplight-original"]).toBe("preserve");
        await server.expectRequestCountToRemain(1);
        await receipt(testInfo, harness, { rejectedDraft: invalidHeaders });
      } finally {
        await harness.close();
      }
    });
  }

  test("a continuation transport failure is visible and recovers unchanged", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { targetPage, sidePanel, server, context } = harness;
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      const key = await startFixtureRequest(targetPage, { url: "/api/command-failure", headers: { "content-type": "text/plain" }, body: "original" });
      await expect(sidePanel.locator(".queue-item")).toHaveCount(1);
      const worker = context.serviceWorkers().find((item) => item.url().startsWith(`chrome-extension://${harness.extensionId}/`));
      expect(worker).toBeDefined();
      // Inject exactly one transport rejection; the request itself uses real CDP,
      // browser Fetch, and the receiving server throughout the recovery path.
      await worker!.evaluate(() => {
        const original = chrome.debugger.sendCommand.bind(chrome.debugger);
        chrome.debugger.sendCommand = ((...args: Parameters<typeof original>) => {
          if (args[1] === "Fetch.continueRequest") {
            chrome.debugger.sendCommand = original;
            // Production wraps the callback-style Chrome API in a Promise;
            // throwing is observed by that wrapper, unlike a returned rejection.
            throw new Error("Synthetic continuation transport failure");
          }
          return original(...args);
        }) as typeof chrome.debugger.sendCommand;
      });
      await setTextAreaValue(sidePanel, "#body-editor", "discard failed edit");
      await dispatchClick(sidePanel, "#continue-edited-button");
      await expect(sidePanel.locator("#banner")).toContainText("Synthetic continuation transport failure");
      await expect(sidePanel.locator(".queue-item")).toHaveCount(1);
      await server.expectRequestCountToRemain(0);
      await continueUnchangedFromSidePanel(sidePanel);
      expect((await waitForFixtureRequest(targetPage, key)).ok).toBe(true);
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      expect(server.requestsSnapshot[0]?.body).toBe("original");
      await server.expectRequestCountToRemain(1);
      await receipt(testInfo, harness, { fault: "one rejected Fetch.continueRequest call" });
    } finally {
      await harness.close();
    }
  });
});
