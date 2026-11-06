import { expect, test } from "@playwright/test";

import {
  armCurrentTabFromSidePanel,
  continueUnchangedFromSidePanel,
  launchStoplightHarness,
  playAllFromSidePanel,
  setTextAreaValue,
  waitForServiceWorker,
  waitForText,
} from "./support";

test.describe("Stoplight extension smoke", () => {
  test("loads the unpacked extension shell and background worker", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      expect(harness.extensionId).toMatch(/^[a-p]{32}$/);

      await expect(harness.sidePanel.locator("#app")).toBeVisible();
      await expect(harness.sidePanel.locator("#arm-button")).toBeVisible();
      await expect(harness.sidePanel.locator("#arm-target-title")).toBeVisible();
      await expect(harness.sidePanel.locator("#request-phase")).toBeVisible();
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
  test("arms the shown website target when the extension panel tab is active", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await sidePanel.bringToFront();
      await sidePanel.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(sidePanel.locator("#arm-target-title")).toContainText("Stoplight Test");
      await expect(sidePanel.locator("#arm-target-status")).toContainText("ready");

      await sidePanel.locator("#arm-button").click();

      await waitForText(sidePanel, "#status-pill", "attached");
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      await waitForText(sidePanel, "#request-phase", "waiting");
    } finally {
      await harness.close();
    }
  });

  test("arms the active tab and continues an edited request", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      await waitForText(sidePanel, "#request-phase", "waiting");
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
      await waitForText(sidePanel, "#request-phase", "held");

      const originalHeaders = await sidePanel.locator("#headers-editor").inputValue();
      const editedHeaders = originalHeaders.replace(
        "x-stoplight: original",
        "x-stoplight: edited",
      );

      await setTextAreaValue(sidePanel, "#headers-editor", editedHeaders);
      await setTextAreaValue(sidePanel, "#body-editor", JSON.stringify({ status: "edited" }));
      await waitForText(sidePanel, "#request-phase", "edited, held");
      await expect(sidePanel.locator("#phase-detail")).toContainText("still held");
      await sidePanel.locator("#continue-edited-button").click();

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
      await waitForText(sidePanel, "#request-phase", "forwarded");
      await expect(sidePanel.locator("#phase-detail")).toContainText("does not prove remote receipt");
      await waitForText(sidePanel, "#diff-summary", "No request selected.");
    } finally {
      await harness.close();
    }
  });

  test("continues an edited text request with its body cleared", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;
      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      server.reset();

      await targetPage.evaluate(() => {
        const win = window as Window & {
          __stoplightEmptyEditPromise?: Promise<string>;
        };
        win.__stoplightEmptyEditPromise = fetch("/api/empty-edit", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "remove this body",
        }).then((response) => response.text());
      });

      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/empty-edit");
      expect(server.requestsSnapshot).toHaveLength(0);
      await expect(sidePanel.locator("#body-editor")).toHaveValue("remove this body");
      await setTextAreaValue(sidePanel, "#body-editor", "");
      await waitForText(sidePanel, "#request-phase", "edited, held");
      await sidePanel.locator("#continue-edited-button").click();

      const captured = await server.waitForRequest((request) => request.path === "/api/empty-edit");
      expect(captured.bodyBytes).toEqual([]);
      expect(captured.headers["content-type"]).toBe("text/plain");
      expect(server.requestsSnapshot).toHaveLength(1);
      await targetPage.evaluate(async () => {
        await (window as Window & {
          __stoplightEmptyEditPromise?: Promise<string>;
        }).__stoplightEmptyEditPromise;
      });
      await expect(sidePanel.locator(".queue-item")).toHaveCount(0);
      await waitForText(sidePanel, "#request-phase", "forwarded");
    } finally {
      await harness.close();
    }
  });

  test("detach clears a held request and shows detached phase", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      server.reset();

      await targetPage.evaluate(() => {
        void fetch("/api/detach", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "pending" }),
        }).catch(() => undefined);
      });

      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(1);
      expect(server.requestsSnapshot).toHaveLength(0);
      await waitForText(sidePanel, "#request-phase", "held");

      await sidePanel.locator("#detach-button").click();

      await waitForText(sidePanel, "#status-pill", "detached");
      await waitForText(sidePanel, "#request-phase", "detached");
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
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
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      server.reset();

      await targetPage.evaluate(() => {
        const win = window as Window & {
          __stoplightStaticControlPromise?: Promise<string>;
        };
        win.__stoplightStaticControlPromise = fetch("/api/static-control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ held: true }),
        }).then((response) => response.text());
      });

      // A held API request proves interception is active while the image loads.
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/static-control");
      expect(server.requestsSnapshot).toHaveLength(0);
      const imageSize = await targetPage.evaluate(async () => {
        const img = new Image();
        img.id = "stoplight-asset";
        const loaded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Static image failed to load."));
        });
        img.src = `/asset.png?nonce=${Date.now()}`;
        document.body.appendChild(img);
        await loaded;
        await img.decode();
        return { width: img.naturalWidth, height: img.naturalHeight };
      });

      expect(imageSize).toEqual({ width: 1, height: 1 });
      await server.waitForRequest((request) => request.path.startsWith("/asset.png"));
      expect(server.requestsSnapshot).toHaveLength(1);
      await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/static-control");
      await waitForText(sidePanel, "#paused-count", "1");
      await waitForText(sidePanel, "#status-pill", "attached");

      await continueUnchangedFromSidePanel(sidePanel);
      await server.waitForRequest((request) => request.path === "/api/static-control");
      await targetPage.evaluate(async () => {
        await (window as Window & {
          __stoplightStaticControlPromise?: Promise<string>;
        }).__stoplightStaticControlPromise;
      });
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
      await waitForText(sidePanel, "#paused-count", "0");
    } finally {
      await harness.close();
    }
  });

  test("marks multipart form requests as inspect-only", async ({}, testInfo) => {
    const harness = await launchStoplightHarness(testInfo);
    try {
      const { server, sidePanel, targetPage } = harness;

      await targetPage.bringToFront();
      await armCurrentTabFromSidePanel(sidePanel, server.origin);
      await expect(sidePanel.locator("#tab-url")).toContainText(server.origin);
      server.reset();

      const expected = await targetPage.evaluate(async () => {
        const form = new FormData();
        form.append("alpha", "bravo");
        form.append("charlie", "delta");
        form.append("attachment", new Blob([new Uint8Array([0, 128, 255, 13, 10])], {
          type: "application/octet-stream",
        }), "sample.bin");

        // Capture the browser's actual boundary and binary file bytes before
        // sending the same Request, so unchanged means byte-for-byte unchanged.
        const request = new Request(new URL("/api/form", location.href), {
          method: "POST",
          body: form,
        });
        const bytes = Array.from(new Uint8Array(await request.clone().arrayBuffer()));
        const win = window as Window & {
          __stoplightMultipartPromise?: Promise<string>;
        };
        win.__stoplightMultipartPromise = fetch(request).then((response) => response.text());
        return { bytes, contentType: request.headers.get("content-type") };
      });

      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(1);
      expect(server.requestsSnapshot).toHaveLength(0);

      await expect(sidePanel.locator("#body-hint")).toContainText("Multipart payloads are inspect-only in v1.");
      await expect(sidePanel.locator("#body-editor")).toBeDisabled();
      await expect(sidePanel.locator("#headers-editor")).toBeDisabled();
      await expect(sidePanel.locator("#continue-edited-button")).toBeDisabled();
      await expect(sidePanel.locator("#continue-unchanged-button")).toBeEnabled();

      await continueUnchangedFromSidePanel(sidePanel);
      const captured = await server.waitForRequest((request) => request.path === "/api/form");
      expect(captured.headers["content-type"]).toBe(expected.contentType);
      expect(captured.bodyBytes).toEqual(expected.bytes);
      expect(server.requestsSnapshot).toHaveLength(1);
      await targetPage.evaluate(async () => {
        await (window as Window & {
          __stoplightMultipartPromise?: Promise<string>;
        }).__stoplightMultipartPromise;
      });
      await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
      await waitForText(sidePanel, "#request-phase", "forwarded");
    } finally {
      await harness.close();
    }
  });

  for (const { label, contentType, bytes } of [
    {
      label: "non-UTF-8",
      contentType: "application/octet-stream",
      bytes: [0, 1, 127, 128, 192, 255, 13, 10, 0],
    },
    { label: "empty", contentType: "application/octet-stream", bytes: [] },
    {
      label: "PNG",
      contentType: "image/png",
      bytes: Array.from(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==",
        "base64",
      )),
    },
  ]) {
    test(`keeps ${label} binary requests inspect-only and forwards unchanged bytes`, async ({}, testInfo) => {
      const harness = await launchStoplightHarness(testInfo);
      try {
        const { server, sidePanel, targetPage } = harness;
        await targetPage.bringToFront();
        await armCurrentTabFromSidePanel(sidePanel, server.origin);
        server.reset();

        await targetPage.evaluate(({ payload, mimeType }) => {
          const win = window as Window & {
            __stoplightBinaryPromise?: Promise<string>;
          };
          win.__stoplightBinaryPromise = fetch("/api/binary", {
            method: "POST",
            headers: { "content-type": mimeType },
            body: new Uint8Array(payload),
          }).then((response) => response.text());
        }, { payload: bytes, mimeType: contentType });

        await expect(sidePanel.locator(".queue-item strong")).toHaveText("/api/binary");
        expect(server.requestsSnapshot).toHaveLength(0);
        await waitForText(sidePanel, "#request-phase", "held");
        await expect(sidePanel.locator("#body-hint")).toContainText("Binary payloads are inspect-only in v1.");
        await expect(sidePanel.locator("#body-editor")).toBeDisabled();
        await expect(sidePanel.locator("#headers-editor")).toBeDisabled();
        await expect(sidePanel.locator("#continue-edited-button")).toBeDisabled();
        await expect(sidePanel.locator("#continue-unchanged-button")).toBeEnabled();

        await continueUnchangedFromSidePanel(sidePanel);
        const captured = await server.waitForRequest((request) => request.path === "/api/binary");
        expect(captured.headers["content-type"]).toBe(contentType);
        expect(captured.bodyBytes).toEqual(bytes);
        expect(server.requestsSnapshot).toHaveLength(1);
        await targetPage.evaluate(async () => {
          await (window as Window & {
            __stoplightBinaryPromise?: Promise<string>;
          }).__stoplightBinaryPromise;
        });
        await expect.poll(() => sidePanel.locator(".queue-item").count()).toBe(0);
        await waitForText(sidePanel, "#request-phase", "forwarded");
      } finally {
        await harness.close();
      }
    });
  }
});
