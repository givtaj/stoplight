import { expect, test } from "@playwright/test";

import {
  armCurrentTabFromSidePanel,
  continueEditedFromSidePanel,
  continueUnchangedFromSidePanel,
  launchStoplightHarness,
  playAllFromSidePanel,
  waitForServiceWorker,
  waitForText,
} from "./support";

const STATIC_ASSET_SKIP_REASON =
  "Static asset interception remains nondeterministic in this Chromium environment; keep it manual until request auto-continue is consistently observable in CI.";
const MULTIPART_SKIP_REASON =
  "Multipart interception remains nondeterministic in this Chromium environment; keep it manual until paused multipart requests are consistently observable in CI.";

test.describe("Stoplight extension smoke", () => {
  test("loads the unpacked extension shell and background worker", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      expect(harness.extensionId).toMatch(/^[a-p]{32}$/);

      await expect(harness.sidePanel.locator("#app")).toBeVisible();
      await expect(harness.sidePanel.locator("#arm-button")).toBeVisible();
      await expect(harness.sidePanel.locator("#play-all-button")).toBeVisible();
      await expect(harness.sidePanel.locator("#headers-editor")).toBeVisible();
      await expect(harness.sidePanel.locator("#body-editor")).toBeVisible();
      await waitForText(harness.sidePanel, "#status-pill", "idle");

      await waitForServiceWorker(
        harness.context,
        `chrome-extension://${harness.extensionId}/assets/background.js`,
      );
    } finally {
      await harness.close();
    }
  });
});

test.describe("Stoplight extension release flows", () => {
  test("arms the active tab and continues an edited request", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      server.reset();

      await targetPage.evaluate(() => {
        const win = window as Window & {
          __stoplightEditPromise?: Promise<string>;
        };

        win.__stoplightEditPromise = fetch("/api/edit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stoplight": "original",
          },
          body: JSON.stringify({
            status: "original",
          }),
        }).then(async (response) => response.text());
      });

      await expect.poll(() => server.requestsSnapshot.length).toBe(0);
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(1);

      const originalHeaders = await sidePanel.locator("#headers-editor").inputValue();
      const editedHeaders = originalHeaders.replace(
        "x-stoplight: original",
        "x-stoplight: edited",
      );

      await continueEditedFromSidePanel(sidePanel, {
        headerText: editedHeaders,
        bodyText: JSON.stringify({ status: "edited" }),
      });

      await server.waitForRequest((request) => request.path === "/api/edit");
      const [captured] = server.requestsSnapshot;
      expect(captured?.headers["x-stoplight"]).toBe("edited");
      expect(captured?.body).toContain('"status":"edited"');

      await targetPage.evaluate(async () => {
        const win = window as Window & {
          __stoplightEditPromise?: Promise<string>;
        };

        await win.__stoplightEditPromise;
      });

      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
      await waitForText(sidePanel, "#diff-summary", "No request selected.");
    } finally {
      await harness.close();
    }
  });

  test("releases queued requests in arrival order", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      server.reset();

      await targetPage.evaluate(() => {
        const win = window as Window & {
          __stoplightQueuePromises?: Array<Promise<string>>;
        };

        win.__stoplightQueuePromises = [
          fetch("/api/queue/1", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ order: 1 }),
          }).then(async (response) => response.text()),
          fetch("/api/queue/2", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ order: 2 }),
          }).then(async (response) => response.text()),
        ];
      });

      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(2);
      expect(server.requestsSnapshot).toHaveLength(0);
      expect(await sidePanel.locator(".queue-item strong").allTextContents()).toEqual([
        "/api/queue/1",
        "/api/queue/2",
      ]);

      await playAllFromSidePanel(sidePanel);
      await server.waitForRequestCount(2);

      expect(server.requestsSnapshot.map((request) => request.path)).toEqual([
        "/api/queue/1",
        "/api/queue/2",
      ]);
      expect(server.requestsSnapshot.map((request) => request.body)).toEqual([
        JSON.stringify({ order: 1 }),
        JSON.stringify({ order: 2 }),
      ]);
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);

      await targetPage.evaluate(async () => {
        const win = window as Window & {
          __stoplightQueuePromises?: Array<Promise<string>>;
        };

        await Promise.all(win.__stoplightQueuePromises ?? []);
      });
    } finally {
      await harness.close();
    }
  });

  test("auto-continues static asset requests", async ({}, testInfo) => {
    test.skip(true, STATIC_ASSET_SKIP_REASON);
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);

      await targetPage.evaluate(() => {
        const img = new Image();
        img.id = "stoplight-asset";
        img.src = `/asset.png?nonce=${Date.now()}`;
        document.body.appendChild(img);
      });

      await server.waitForRequest((request) => request.path.startsWith("/asset.png"));
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
      await waitForText(sidePanel, "#paused-count", "0");
    } finally {
      await harness.close();
    }
  });

  test("marks multipart form requests as inspect-only", async ({}, testInfo) => {
    test.skip(true, MULTIPART_SKIP_REASON);
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);

      await targetPage.evaluate(() => {
        const form = new FormData();
        form.append("alpha", "bravo");
        form.append("charlie", "delta");

        void fetch("/api/form", {
          method: "POST",
          body: form,
        });
      });

      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(1);
      expect(server.requestsSnapshot).toHaveLength(0);

      await waitForText(sidePanel, "#body-hint", "Multipart payloads are inspect-only in v1.");
      await expect(sidePanel.locator("#body-editor")).toBeDisabled();

      await continueUnchangedFromSidePanel(sidePanel);
      await server.waitForRequest((request) => request.path === "/api/form");
      expect(server.requestsSnapshot[0]?.body).toContain('name="alpha"');
      expect(server.requestsSnapshot[0]?.body).toContain("bravo");
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
    } finally {
      await harness.close();
    }
  });
});
