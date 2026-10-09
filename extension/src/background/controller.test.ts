import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_SESSION_STATE, SESSION_STORAGE_KEY, PREFERENCES_STORAGE_KEY, type ContinueBuildInput, type SessionEvent, type SessionState, type StoplightPreferences } from "../shared/types";
import { getOrigin, headersToText } from "../shared/utils";
import type { StoplightWasmApi } from "../shared/wasm";
import { StoplightController, type ControllerDependencies } from "./controller";

function createMockWasm(): StoplightWasmApi {
  return {
    normalizeRequest(input) {
      return {
        id: input.id,
        networkId: input.networkId,
        origin: getOrigin(input.url),
        url: input.url,
        method: input.method.toUpperCase(),
        resourceType: input.resourceType,
        headers: input.headers,
        headerText: headersToText(input.headers),
        body: {
          kind: input.postData ? "json" : "empty",
          text: input.postData ?? "",
          editable: true,
          encoding: "utf-8",
          reason: null,
          contentType: input.headers.find((header) => header.name.toLowerCase() === "content-type")?.value ?? null,
        },
        createdAtMs: input.timestampMs,
      };
    },
    decodeBody(input) {
      return {
        kind: input.postData ? "json" : "empty",
        text: input.postData ?? "",
        editable: true,
        encoding: "utf-8",
        reason: null,
        contentType: input.contentType,
      };
    },
    buildContinuePayload(input: ContinueBuildInput) {
      return {
        requestId: input.requestId,
        headers: input.headers,
        postDataBase64: input.body.text ? Buffer.from(input.body.text).toString("base64") : null,
      };
    },
    computeDiff() {
      return {
        hasChanges: false,
        headersChanged: false,
        bodyChanged: false,
        changedHeaders: [],
        summary: "No changes",
      };
    },
    reduceSessionEvent(state: SessionState, event: SessionEvent) {
      switch (event.type) {
        case "updateArmTarget":
          return {
            ...state,
            armTarget: event.armTarget,
            updatedAtMs: event.timestampMs,
          };
        case "beginArmSession":
          return {
            ...EMPTY_SESSION_STATE,
            tabId: event.tabId,
            tabUrl: event.tabUrl,
            tabTitle: event.tabTitle,
            armTarget: state.armTarget,
            originAllowlist: [...event.originAllowlist],
            debuggerStatus: "arming",
            requestPhase: "arming",
            updatedAtMs: event.timestampMs,
          };
        case "armSession":
          return {
            ...state,
            debuggerStatus: "attached",
            requestPhase: "waiting",
            updatedAtMs: event.timestampMs,
          };
        case "updateAllowlist":
          return {
            ...state,
            originAllowlist: [...event.originAllowlist],
            updatedAtMs: event.timestampMs,
          };
        case "queueRequest":
          return {
            ...state,
            queue: [...state.queue.filter((request) => request.id !== event.request.id), event.request],
            requestPhase: "held",
            updatedAtMs: event.timestampMs,
          };
        case "continueRequest": {
          const previousQueueLength = state.queue.length;
          const queueAfterContinue = state.queue.filter((request) => request.id !== event.requestId);
          const removedCount = previousQueueLength - queueAfterContinue.length;
          return {
            ...state,
            queue: queueAfterContinue,
            requestPhase: queueAfterContinue.length ? "held" : "forwarded",
            lastForwardedAtMs: removedCount ? event.timestampMs : state.lastForwardedAtMs,
            forwardedRequestCount: state.forwardedRequestCount + removedCount,
            updatedAtMs: event.timestampMs,
          };
        }
        case "continueAll": {
          const previousQueueLength = state.queue.length;
          const queueAfterContinueAll = state.queue.filter((request) => !event.requestIds.includes(request.id));
          const removedCount = previousQueueLength - queueAfterContinueAll.length;
          return {
            ...state,
            queue: queueAfterContinueAll,
            requestPhase: queueAfterContinueAll.length ? "held" : "forwarded",
            lastForwardedAtMs: removedCount ? event.timestampMs : state.lastForwardedAtMs,
            forwardedRequestCount: state.forwardedRequestCount + removedCount,
            updatedAtMs: event.timestampMs,
          };
        }
        case "debuggerDetached":
          return {
            ...state,
            debuggerStatus: "detached",
            requestPhase: "detached",
            detachedReason: event.reason,
            queue: [],
            updatedAtMs: event.timestampMs,
          };
        case "debuggerError":
          return {
            ...state,
            debuggerStatus: "error",
            requestPhase: "error",
            lastError: event.message,
            updatedAtMs: event.timestampMs,
          };
        case "rehydrate":
          return event.state;
        case "reset":
          return {
            ...EMPTY_SESSION_STATE,
            updatedAtMs: event.timestampMs,
          };
      }
    },
  };
}

function createStorage(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key?: string | string[] | Record<string, unknown> | null) {
      if (!key) {
        return Object.fromEntries(store.entries());
      }
      if (typeof key === "string") {
        return { [key]: store.get(key) };
      }
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((entry) => [entry, store.get(entry)]));
      }
      return Object.fromEntries(
        Object.keys(key).map((entry) => [entry, store.get(entry) ?? key[entry]]),
      );
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
  };
}

describe("StoplightController", () => {
  const debuggerApi = {
    attach: vi.fn<ControllerDependencies["debuggerApi"]["attach"]>(
      async () => undefined,
    ),
    detach: vi.fn<ControllerDependencies["debuggerApi"]["detach"]>(
      async () => undefined,
    ),
    sendCommand: vi.fn<ControllerDependencies["debuggerApi"]["sendCommand"]>(
      async () => undefined,
    ),
  };
  const tabsApi = {
    query: vi.fn<ControllerDependencies["tabsApi"]["query"]>(async () => [
      {
        id: 12,
        url: "https://example.com/dashboard",
        title: "Dashboard",
      },
    ]),
  };

  beforeEach(() => {
    debuggerApi.attach.mockReset();
    debuggerApi.attach.mockResolvedValue(undefined);
    debuggerApi.detach.mockReset();
    debuggerApi.detach.mockResolvedValue(undefined);
    debuggerApi.sendCommand.mockReset();
    debuggerApi.sendCommand.mockResolvedValue(undefined);
    tabsApi.query.mockReset();
    tabsApi.query.mockResolvedValue([
      {
        id: 12,
        url: "https://example.com/dashboard",
        title: "Dashboard",
      },
    ]);
  });

  it("rehydrates attached sessions into a detached state", async () => {
    const sessionStorage = createStorage({
      [SESSION_STORAGE_KEY]: {
        ...EMPTY_SESSION_STATE,
        tabId: 12,
        tabUrl: "https://example.com/dashboard",
        debuggerStatus: "attached",
      },
    });
    const localStorage = createStorage();
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage,
      localStorage,
      clock: () => 100,
    });

    await controller.hydrate();

    expect(controller.getState().debuggerStatus).toBe("detached");
    expect(controller.getState().detachedReason).toContain("worker restarted");
  });

  it("arms the active tab with a stored allowlist", async () => {
    const preferences: StoplightPreferences = {
      allowlistsByOrigin: {
        "https://example.com": ["https://example.com", "https://api.example.com"],
      },
    };
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage({
        [PREFERENCES_STORAGE_KEY]: preferences,
      }),
      clock: () => 200,
    });

    await controller.hydrate();
    await controller.armActiveTab();

    expect(debuggerApi.attach).toHaveBeenCalledWith({ tabId: 12 }, "1.3");
    expect(controller.getState().originAllowlist).toEqual([
      "https://example.com",
      "https://api.example.com",
    ]);
    expect(controller.getState().debuggerStatus).toBe("attached");
  });

  it("rejects the Stoplight panel as an arm target", async () => {
    tabsApi.query.mockResolvedValue([
      {
        id: 99,
        url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html",
        title: "Stoplight",
      },
    ]);
    const errors: string[] = [];
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 225,
    });
    controller.subscribe((event) => {
      if (event.type === "error") {
        errors.push(event.message);
      }
    });

    await controller.hydrate();
    await controller.armActiveTab();

    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().debuggerStatus).toBe("idle");
    expect(errors.at(-1)).toContain("Stoplight panel");
  });

  it("rejects unsupported internal pages as arm targets", async () => {
    tabsApi.query.mockResolvedValue([
      {
        id: 88,
        url: "chrome://extensions/",
        title: "Extensions",
      },
    ]);
    const errors: string[] = [];
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 226,
    });
    controller.subscribe((event) => {
      if (event.type === "error") {
        errors.push(event.message);
      }
    });

    await controller.hydrate();
    await controller.armActiveTab();

    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().debuggerStatus).toBe("idle");
    expect(errors.at(-1)).toContain("Only http:// and https:// tabs");
  });

  it("does not silently arm a different active tab than the panel expected", async () => {
    tabsApi.query.mockResolvedValue([
      {
        id: 13,
        url: "https://other.example.com/dashboard",
        title: "Other Dashboard",
      },
    ]);
    const errors: string[] = [];
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 227,
    });
    controller.subscribe((event) => {
      if (event.type === "error") {
        errors.push(event.message);
      }
    });

    await controller.hydrate();
    await controller.handleCommand({ type: "armActiveTab", expectedTabId: 12 } as never);

    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().debuggerStatus).toBe("idle");
    expect(errors.at(-1)).toContain("Arm target changed");
  });

  it("arms the retained website target when the Stoplight panel is active", async () => {
    tabsApi.query
      .mockResolvedValueOnce([
        {
          id: 12,
          url: "https://example.com/dashboard",
          title: "Dashboard",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 99,
          url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html",
          title: "Stoplight",
        },
      ]);
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 228,
    });

    await controller.hydrate();
    await controller.refreshArmTarget();
    expect(controller.getState().armTarget).toMatchObject({
      tabId: 12,
      status: "ready",
      source: "activeTab",
    });

    await controller.handleCommand({ type: "armActiveTab", expectedTabId: 12 });

    expect(debuggerApi.attach).toHaveBeenCalledWith({ tabId: 12 }, "1.3");
    expect(controller.getState().debuggerStatus).toBe("attached");
    expect(controller.getState().armTarget).toMatchObject({
      tabId: 12,
      status: "ready",
      source: "retainedTab",
    });
  });

  it("uses the debugger session to resolve tab metadata when activeTab hides the URL", async () => {
    tabsApi.query.mockResolvedValue([
      {
        id: 12,
      },
    ]);
    debuggerApi.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method !== "Runtime.evaluate") {
        return undefined;
      }

      const expression = params?.expression;
      return {
        result: {
          value:
            typeof expression === "string" && expression.includes("document.title")
              ? "Dashboard"
              : "https://example.com/dashboard",
        },
      };
    });

    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 250,
    });

    await controller.hydrate();
    await controller.armActiveTab();

    expect(debuggerApi.attach).toHaveBeenCalledWith({ tabId: 12 }, "1.3");
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      "Runtime.evaluate",
      {
        expression: "typeof location === 'object' ? location.href : null",
        returnByValue: true,
      },
    );
    expect(controller.getState()).toMatchObject({
      tabUrl: "https://example.com/dashboard",
      tabTitle: "Dashboard",
      originAllowlist: ["https://example.com"],
      debuggerStatus: "attached",
      requestPhase: "waiting",
    });
  });

  it("queues paused requests and drains them in order", async () => {
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 300,
    });

    await controller.hydrate();
    await controller.armActiveTab();
    await controller.updateAllowlist(["https://api.example.com"]);

    await controller.handleDebuggerEvent(
      { tabId: 12 },
      "Fetch.requestPaused",
      {
        requestId: "request-1",
        request: {
          url: "https://api.example.com/v1/items",
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          postData: "{\"first\":true}",
        },
        resourceType: "Fetch",
      },
    );
    await controller.handleDebuggerEvent(
      { tabId: 12 },
      "Fetch.requestPaused",
      {
        requestId: "request-2",
        request: {
          url: "https://api.example.com/v1/items/2",
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          postData: "{\"second\":true}",
        },
        resourceType: "Fetch",
      },
    );

    expect(controller.getState().queue.map((request) => request.id)).toEqual([
      "request-1",
      "request-2",
    ]);
    expect(controller.getState().requestPhase).toBe("held");

    debuggerApi.sendCommand.mockClear();
    await controller.continueAll();

    expect(controller.getState().queue).toEqual([]);
    expect(controller.getState().requestPhase).toBe("forwarded");
    expect(controller.getState().forwardedRequestCount).toBe(2);
    const continueCalls = debuggerApi.sendCommand.mock.calls as unknown as Array<
      [unknown, string, { requestId: string }]
    >;
    expect(
      continueCalls
        .filter(([, method]) => method === "Fetch.continueRequest")
        .map(([, , payload]) => payload.requestId),
    ).toEqual(["request-1", "request-2"]);
  });

  it("continues a paused request with edited headers and body", async () => {
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 350,
    });

    await controller.hydrate();
    await controller.armActiveTab();
    await controller.updateAllowlist(["https://api.example.com"]);
    await controller.handleDebuggerEvent(
      { tabId: 12 },
      "Fetch.requestPaused",
      {
        requestId: "request-1",
        request: {
          url: "https://api.example.com/v1/items",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stoplight": "original",
          },
          postData: "{\"status\":\"original\"}",
        },
        resourceType: "Fetch",
      },
    );

    debuggerApi.sendCommand.mockClear();
    await controller.continueRequest(
      "request-1",
      "content-type: application/json\nx-stoplight: edited",
      "{\"status\":\"edited\"}",
    );

    expect(controller.getState().queue).toEqual([]);
    expect(controller.getState().requestPhase).toBe("forwarded");
    expect(controller.getState().forwardedRequestCount).toBe(1);
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      "Fetch.continueRequest",
      {
        requestId: "request-1",
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "x-stoplight", value: "edited" },
        ],
        postData: Buffer.from("{\"status\":\"edited\"}").toString("base64"),
      },
    );
  });

  it("marks the session as detached on debugger disconnect", async () => {
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 400,
    });

    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerDetach({ tabId: 12 }, "canceled_by_user");

    expect(controller.getState().debuggerStatus).toBe("detached");
    expect(controller.getState().requestPhase).toBe("detached");
    expect(controller.getState().detachedReason).toBe("canceled_by_user");
  });

  it("auto-continues non matching requests without queueing them", async () => {
    const controller = new StoplightController({
      wasm: createMockWasm(),
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 500,
    });

    await controller.hydrate();
    await controller.armActiveTab();

    debuggerApi.sendCommand.mockClear();
    await controller.handleDebuggerEvent(
      { tabId: 12 },
      "Fetch.requestPaused",
      {
        requestId: "asset-1",
        request: {
          url: "https://example.com/assets/logo.png",
          method: "GET",
          headers: {},
        },
        resourceType: "Image",
      },
    );

    expect(controller.getState().queue).toHaveLength(0);
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 12 },
      "Fetch.continueRequest",
      { requestId: "asset-1" },
    );
  });
});
