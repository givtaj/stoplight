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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function pausedRequest(id: string, postData: string | undefined = "original") {
  return {
    requestId: id,
    networkId: `network-${id}`,
    resourceType: "Fetch",
    request: {
      url: `https://example.com/api/${id}`,
      method: "POST",
      headers: { "content-type": "text/plain" } as Record<string, string>,
      postData: postData as string | undefined,
      hasPostData: true,
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

  function makeController(overrides: Partial<ControllerDependencies> = {}) {
    return new StoplightController({
      wasm: createMockWasm(), debuggerApi, tabsApi,
      sessionStorage: createStorage(), localStorage: createStorage(),
      ...overrides,
    });
  }

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
        .map(([, , payload]) => payload),
    ).toEqual([{ requestId: "request-1" }, { requestId: "request-2" }]);
  });

  it.each(["{\"status\":\"edited\"}", ""])("continues a paused request with edited headers and body %j", async (bodyText) => {
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
      bodyText,
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
        postData: Buffer.from(bodyText).toString("base64"),
      },
    );
  });

  it.each(["binary", "multipart"] as const)("rejects %s edits and continues original bytes without overrides", async (kind) => {
    const wasm = createMockWasm();
    const normalizeRequest = wasm.normalizeRequest;
    wasm.normalizeRequest = (input) => {
      const request = normalizeRequest(input);
      request.body = { ...request.body, kind, editable: false };
      return request;
    };
    const buildPayload = vi.spyOn(wasm, "buildContinuePayload");
    const errors: string[] = [];
    const controller = new StoplightController({
      wasm,
      debuggerApi,
      tabsApi,
      sessionStorage: createStorage(),
      localStorage: createStorage(),
      clock: () => 360,
    });
    controller.subscribe((event) => {
      if (event.type === "error") {
        errors.push(event.message);
      }
    });

    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", {
      requestId: "inspect-only",
      request: {
        url: "https://example.com/upload",
        method: "POST",
        headers: {
          "content-type": kind === "binary" ? "application/octet-stream" : "multipart/form-data; boundary=test",
        },
        // The original payload may be unavailable from CDP.
      },
      resourceType: "Fetch",
    });

    debuggerApi.sendCommand.mockClear();
    await controller.continueRequest("inspect-only", "x-test: edited");
    await controller.continueRequest("inspect-only", undefined, "changed");
    await controller.continueRequest("inspect-only", undefined, "");

    expect(errors).toHaveLength(3);
    expect(errors.every((message) => message.includes("inspect-only"))).toBe(true);
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    expect(controller.getState().queue).toHaveLength(1);

    await controller.continueRequest("inspect-only");

    expect(buildPayload).not.toHaveBeenCalled();
    expect(debuggerApi.sendCommand).toHaveBeenCalledExactlyOnceWith(
      { tabId: 12 }, "Fetch.continueRequest", { requestId: "inspect-only" },
    );
    expect(controller.getState().queue).toEqual([]);
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

  it("rejects a same-tab navigation before attaching", async () => {
    const controller = makeController();
    await controller.hydrate();
    tabsApi.query.mockResolvedValue([{ id: 12, url: "https://example.com/changed" }]);
    await controller.armActiveTab(12, "https://example.com/dashboard");
    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().armTarget.tabUrl).toBe("https://example.com/changed");
  });

  it("rechecks a retained website URL rather than trusting its old snapshot", async () => {
    const controller = makeController();
    await controller.hydrate();
    await controller.refreshArmTarget();
    tabsApi.query.mockResolvedValueOnce([{ id: 99, url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html" }]);
    tabsApi.query.mockResolvedValueOnce([{ id: 12, url: "https://elsewhere.example/new" }]);
    await controller.armActiveTab(12, "https://example.com/dashboard");
    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().armTarget.tabUrl).toBe("https://elsewhere.example/new");
  });

  it("rejects navigation during debugger attach before enabling interception", async () => {
    const controller = makeController();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) =>
      method === "Runtime.evaluate" ? { result: { value: "https://elsewhere.example/new" } } : undefined);
    await controller.hydrate();
    await controller.armActiveTab(12, "https://example.com/dashboard");
    expect(debuggerApi.detach).toHaveBeenCalledWith({ tabId: 12 });
    expect(debuggerApi.sendCommand.mock.calls.some(([, method]) => method === "Fetch.enable")).toBe(false);
  });

  it("does not enable interception after detach races an in-flight arm", async () => {
    const network = deferred<void>();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) =>
      method === "Network.enable" ? network.promise : undefined);
    const controller = makeController();
    await controller.hydrate();
    const arm = controller.armActiveTab();
    await vi.waitFor(() => expect(debuggerApi.sendCommand.mock.calls.some(([, method]) => method === "Network.enable")).toBe(true));
    await controller.detach("canceled_by_user");
    network.resolve();
    await arm;
    expect(controller.getState().debuggerStatus).toBe("detached");
    expect(debuggerApi.sendCommand.mock.calls.some(([, method]) => method === "Fetch.enable")).toBe(false);
  });

  it("keeps restart detach failures visible and permits a later detach retry", async () => {
    const controller = makeController({ sessionStorage: createStorage({
      [SESSION_STORAGE_KEY]: { ...EMPTY_SESSION_STATE, tabId: 12, debuggerStatus: "attached" },
    }) });
    debuggerApi.detach.mockRejectedValueOnce(new Error("Transport temporarily unavailable"));
    await controller.hydrate();
    expect(controller.getState().debuggerStatus).toBe("error");
    expect(controller.getState().lastError).toContain("Retry Detach");
    await controller.detach("canceled_by_user");
    expect(controller.getState().debuggerStatus).toBe("detached");
  });

  it("deduplicates concurrent continuation and keeps a failed request recoverable", async () => {
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("one"));
    debuggerApi.sendCommand.mockClear();
    const delivery = deferred<void>();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) =>
      method === "Fetch.continueRequest" ? delivery.promise : undefined);
    const first = controller.continueRequest("one");
    const duplicates = [controller.continueRequest("one"), controller.continueRequest("one")];
    expect(debuggerApi.sendCommand).toHaveBeenCalledTimes(1);
    delivery.resolve();
    await Promise.all([first, ...duplicates]);
    expect(controller.getState().forwardedRequestCount).toBe(1);

    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("two"));
    debuggerApi.sendCommand.mockRejectedValueOnce(new Error("Command failed"));
    await controller.continueRequest("two");
    expect(controller.getState().queue.map(({ id }) => id)).toEqual(["two"]);
    debuggerApi.sendCommand.mockResolvedValue(undefined);
    await controller.continueRequest("two");
    expect(controller.getState().queue).toEqual([]);
  });

  it("does not let an old continuation change a detached session", async () => {
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("one"));
    const delivery = deferred<void>();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) => method === "Fetch.continueRequest" ? delivery.promise : undefined);
    const first = controller.continueRequest("one");
    await controller.detach("canceled_by_user");
    delivery.resolve();
    await first;
    expect(controller.getState().debuggerStatus).toBe("detached");
    expect(controller.getState().requestPhase).toBe("detached");
    expect(controller.getState().forwardedRequestCount).toBe(0);
  });

  it.each(["bad name: rejected", "x-stoplight: safe\ninjected-without-colon"])("rejects invalid header draft %j without forwarding", async (headers) => {
    const errors: string[] = [];
    const controller = makeController();
    controller.subscribe((event) => { if (event.type === "error") errors.push(event.message); });
    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("one"));
    debuggerApi.sendCommand.mockClear();
    await controller.continueRequest("one", headers, "edited");
    expect(errors).toHaveLength(1);
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    expect(controller.getState().queue).toHaveLength(1);
    await controller.continueRequest("one");
    expect(debuggerApi.sendCommand).toHaveBeenCalledExactlyOnceWith({ tabId: 12 }, "Fetch.continueRequest", { requestId: "one" });
  });

  it("preserves paused-event order across a slow first body capture", async () => {
    const body = deferred<{ postData: string }>();
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) => method === "Network.getRequestPostData" ? body.promise : undefined);
    const firstEvent = pausedRequest("one");
    firstEvent.request.postData = undefined;
    const first = controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", firstEvent);
    const second = controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("two"));
    await vi.waitFor(() => expect(debuggerApi.sendCommand.mock.calls.some(([, method]) => method === "Network.getRequestPostData")).toBe(true));
    expect(controller.getState().queue).toEqual([]);
    body.resolve({ postData: "first body" });
    await Promise.all([first, second]);
    expect(controller.getState().queue.map(({ id }) => id)).toEqual(["one", "two"]);
  });

  it("discards a body lookup that finishes after detach without restoring captured data", async () => {
    const body = deferred<{ postData: string }>();
    const sessionStorage = createStorage();
    const controller = makeController({ sessionStorage });
    await controller.hydrate();
    await controller.armActiveTab();
    debuggerApi.sendCommand.mockImplementation(async (_target, method) => method === "Network.getRequestPostData" ? body.promise : undefined);
    const event = pausedRequest("one");
    event.request.postData = undefined;
    const captured = controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", event);
    await vi.waitFor(() => expect(debuggerApi.sendCommand.mock.calls.some(([, method]) => method === "Network.getRequestPostData")).toBe(true));
    await controller.detach("canceled_by_user");
    body.resolve({ postData: "private synthetic body" });
    await captured;
    expect(controller.getState().queue).toEqual([]);
    expect(JSON.stringify(await sessionStorage.get())).not.toContain("private synthetic body");
  });

  it("retains a held request when session storage fails instead of forwarding it", async () => {
    const sessionStorage = createStorage();
    const originalSet = sessionStorage.set;
    sessionStorage.set = async (items) => {
      if ((items[SESSION_STORAGE_KEY] as SessionState).queue.length) throw new Error("Storage quota exceeded");
      return originalSet(items);
    };
    const errors: string[] = [];
    const controller = makeController({ sessionStorage });
    controller.subscribe((event) => { if (event.type === "error") errors.push(event.message); });
    await controller.hydrate();
    await controller.armActiveTab();
    debuggerApi.sendCommand.mockClear();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("one"));
    expect(controller.getState().queue).toHaveLength(1);
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    expect(errors.at(-1)).toContain("Storage quota exceeded");
    await controller.continueRequest("one");
    expect(controller.getState().queue).toEqual([]);
  });

  it.each([
    { name: "missing textual capture", data: undefined, length: undefined, hasBody: true, method: "POST", status: "unavailable", editable: false },
    { name: "truncated textual capture", data: "partial", length: "100", hasBody: true, method: "POST", status: "truncated", editable: false },
    { name: "bodyless GET", data: undefined, length: undefined, hasBody: false, method: "GET", status: "complete", editable: true },
    { name: "complete empty POST", data: "", length: "0", hasBody: false, method: "POST", status: "complete", editable: true },
  ])("marks $name truthfully", async ({ data, length, hasBody, method, status, editable }) => {
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    const event = pausedRequest("one");
    event.request.postData = data;
    event.request.hasPostData = hasBody;
    event.request.method = method;
    if (length) event.request.headers["content-length"] = length;
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", event);
    expect(controller.getState().queue[0]?.body).toMatchObject({ captureStatus: status, editable });
  });


  it("aborts replacement arming when the previous tab cannot detach", async () => {
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("original"));
    debuggerApi.attach.mockClear();
    debuggerApi.detach.mockRejectedValueOnce(new Error("Transport temporarily unavailable"));
    tabsApi.query.mockResolvedValue([{ id: 13, url: "https://elsewhere.example/new" }]);
    await controller.armActiveTab(13, "https://elsewhere.example/new");
    expect(debuggerApi.attach).not.toHaveBeenCalled();
    expect(controller.getState().tabId).toBe(12);
    expect(controller.getState().queue.map(({ id }) => id)).toEqual(["original"]);
  });

  it("serializes storage so a delayed queue write cannot restore payloads after detach", async () => {
    const storage = createStorage();
    const originalSet = storage.set;
    const heldWrite = deferred<void>();
    let writingHeld = false;
    storage.set = async (items) => {
      if ((items[SESSION_STORAGE_KEY] as SessionState).queue.length) {
        writingHeld = true;
        await heldWrite.promise;
      }
      await originalSet(items);
    };
    const controller = makeController({ sessionStorage: storage });
    await controller.hydrate();
    await controller.armActiveTab();
    const pause = controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("sensitive", "synthetic retained body"));
    await vi.waitFor(() => expect(writingHeld).toBe(true));
    const detach = controller.detach("canceled_by_user");
    await vi.waitFor(() => expect(controller.getState().debuggerStatus).toBe("detached"));
    heldWrite.resolve();
    await Promise.all([pause, detach]);
    expect(JSON.stringify(await storage.get())).not.toContain("synthetic retained body");
    expect((await storage.get(SESSION_STORAGE_KEY))[SESSION_STORAGE_KEY]).toMatchObject({ debuggerStatus: "detached", queue: [] });
  });

  it("bounds oversized text previews and disallows replacing their original bodies", async () => {
    const controller = makeController();
    await controller.hydrate();
    await controller.armActiveTab();
    await controller.handleDebuggerEvent({ tabId: 12 }, "Fetch.requestPaused", pausedRequest("large", "a".repeat(1024 * 1024 + 1)));
    const body = controller.getState().queue[0]?.body;
    expect(body).toMatchObject({ captureStatus: "truncated", editable: false });
    expect(new TextEncoder().encode(body?.text).length).toBeLessThanOrEqual(1024 * 1024);
    debuggerApi.sendCommand.mockClear();
    await controller.continueRequest("large", "content-type: text/plain", "replacement");
    expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    await controller.continueRequest("large");
    expect(debuggerApi.sendCommand).toHaveBeenCalledExactlyOnceWith({ tabId: 12 }, "Fetch.continueRequest", { requestId: "large" });
  });

});
