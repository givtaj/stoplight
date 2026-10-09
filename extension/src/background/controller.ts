import {
  EMPTY_SESSION_STATE,
  PREFERENCES_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  type ArmTargetSnapshot,
  type ContinueBuildInput,
  type PanelCommand,
  type RequestRecord,
  type SessionEvent,
  type SessionState,
  type StoplightPreferences,
  type WorkerEvent,
} from "../shared/types";
import { getOrigin, headersToText, normalizeOrigins, parseHeaderText } from "../shared/utils";
import type { StoplightWasmApi } from "../shared/wasm";

const CDP_PROTOCOL_VERSION = "1.3";

type DebuggerTarget = { tabId: number; sessionId?: string };

interface PausedRequestEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string | number | boolean>;
    postData?: string;
  };
  resourceType?: string;
  networkId?: string;
  responseStatusCode?: number;
}

interface PendingRequest {
  session: DebuggerTarget;
  request: RequestRecord;
}

interface StorageAreaLike {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface DebuggerApiLike {
  attach(target: { tabId: number }, requiredVersion: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(
    target: DebuggerTarget,
    method: string,
    commandParams?: Record<string, unknown>,
  ): Promise<unknown>;
}

type ArmableTab = Pick<chrome.tabs.Tab, "id" | "url" | "title">;

type ResolvedArmTarget = {
  snapshot: ArmTargetSnapshot;
  tab: ArmableTab | null;
};

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
  };
}

interface TabsApiLike {
  query(queryInfo: chrome.tabs.QueryInfo): Promise<ArmableTab[]>;
}

export interface ControllerDependencies {
  wasm: StoplightWasmApi;
  debuggerApi: DebuggerApiLike;
  tabsApi: TabsApiLike;
  sessionStorage: StorageAreaLike;
  localStorage: StorageAreaLike;
  clock?: () => number;
}

export class StoplightController {
  private state: SessionState = EMPTY_SESSION_STATE;
  private preferences: StoplightPreferences = { allowlistsByOrigin: {} };
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(event: WorkerEvent) => void>();

  constructor(private readonly deps: ControllerDependencies) {}

  subscribe(listener: (event: WorkerEvent) => void): () => void {
    this.subscribers.add(listener);
    listener({ type: "state", state: this.state });
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getState(): SessionState {
    return this.state;
  }

  async hydrate(): Promise<void> {
    const sessionSnapshot = await this.deps.sessionStorage.get(SESSION_STORAGE_KEY);
    const preferencesSnapshot = await this.deps.localStorage.get(PREFERENCES_STORAGE_KEY);
    const storedState = sessionSnapshot[SESSION_STORAGE_KEY] as SessionState | undefined;
    const storedPreferences = preferencesSnapshot[
      PREFERENCES_STORAGE_KEY
    ] as StoplightPreferences | undefined;

    this.preferences = storedPreferences ?? { allowlistsByOrigin: {} };
    this.state = storedState ? { ...EMPTY_SESSION_STATE, ...storedState } : EMPTY_SESSION_STATE;

    if (this.state.debuggerStatus === "attached" || this.state.debuggerStatus === "arming") {
      await this.transition({
        type: "debuggerDetached",
        reason: "The extension worker restarted. Re-arm the tab to continue intercepting.",
        timestampMs: this.now(),
      });
      return;
    }

    this.emitState();
  }

  async handleCommand(command: PanelCommand): Promise<void> {
    switch (command.type) {
      case "requestState":
        await this.refreshArmTarget();
        return;
      case "armActiveTab":
        await this.armActiveTab(command.expectedTabId);
        return;
      case "detach":
        await this.detach("canceled_by_user");
        return;
      case "continueUnchanged":
        await this.continueRequest(command.requestId);
        return;
      case "continueRequest":
        await this.continueRequest(command.requestId, command.headerText, command.bodyText);
        return;
      case "continueAll":
        await this.continueAll();
        return;
      case "updateAllowlist":
        await this.updateAllowlist(command.origins);
        return;
    }
  }

  async refreshArmTarget(): Promise<void> {
    const target = await this.resolveCurrentArmTarget();
    await this.transition({
      type: "updateArmTarget",
      armTarget: target.snapshot,
      timestampMs: this.now(),
    });
  }

  async armActiveTab(expectedTabId?: number | null): Promise<void> {
    const target = await this.resolveCurrentArmTarget();
    await this.transition({
      type: "updateArmTarget",
      armTarget: target.snapshot,
      timestampMs: this.now(),
    });

    if (target.snapshot.status !== "ready" || typeof target.tab?.id !== "number") {
      this.emitError(
        target.snapshot.reason ?? "No supported http:// or https:// tab is available to arm.",
      );
      return;
    }

    if (expectedTabId != null && expectedTabId !== target.tab.id) {
      this.emitError(
        "Arm target changed before arming. Review the shown target and try again.",
      );
      return;
    }

    if (this.state.tabId && this.state.debuggerStatus === "attached") {
      await this.detach("replaced_by_new_session");
    }

    const tab = target.tab;
    const targetTabId = tab.id;
    if (typeof targetTabId !== "number") {
      this.emitError("No supported http:// or https:// tab is available to arm.");
      return;
    }
    const session: DebuggerTarget = { tabId: targetTabId };
    let attached = false;

    try {
      await this.deps.debuggerApi.attach(session, CDP_PROTOCOL_VERSION);
      attached = true;

      const tabMetadata = await this.resolveTabMetadata(session, tab);
      if (!tabMetadata.origin) {
        this.emitError("The active tab does not expose a usable origin.");
        await this.safeDetach(targetTabId);
        return;
      }

      const storedAllowlist = this.preferences.allowlistsByOrigin[tabMetadata.origin];
      const originAllowlist = storedAllowlist?.length
        ? storedAllowlist
        : [tabMetadata.origin];

      await this.transition({
        type: "beginArmSession",
        tabId: targetTabId,
        tabUrl: tabMetadata.url,
        tabTitle: tabMetadata.title,
        originAllowlist,
        timestampMs: this.now(),
      });

      await this.deps.debuggerApi.sendCommand(session, "Network.enable");
      await this.deps.debuggerApi.sendCommand(session, "Fetch.enable", {
        patterns: [
          { resourceType: "XHR", requestStage: "Request" },
          { resourceType: "Fetch", requestStage: "Request" },
        ],
      });

      await this.transition({
        type: "armSession",
        timestampMs: this.now(),
      });
    } catch (error) {
      if (this.state.tabId === targetTabId) {
        await this.transition({
          type: "debuggerError",
          message: toErrorMessage(error),
          timestampMs: this.now(),
        });
      }
      if (attached && this.state.debuggerStatus !== "attached") {
        await this.safeDetach(targetTabId);
      }
      this.emitError(toErrorMessage(error));
    }
  }

  async detach(reason: string): Promise<void> {
    const tabId = this.state.tabId;
    if (!tabId) {
      return;
    }

    try {
      await this.deps.debuggerApi.detach({ tabId });
    } catch {
      // Ignore detach failures and still reset the in-memory session.
    }

    this.pendingRequests.clear();
    await this.transition({
      type: "debuggerDetached",
      reason,
      timestampMs: this.now(),
    });
  }

  async handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: unknown,
  ): Promise<void> {
    if (method !== "Fetch.requestPaused" || source.tabId !== this.state.tabId) {
      return;
    }

    const paused = params as PausedRequestEvent;
    const session = this.toSession(source);

    if (paused.responseStatusCode !== undefined || !this.shouldPause(paused)) {
      await this.resumeRequest(session, paused.requestId);
      return;
    }

    try {
      const postData = await this.resolvePostData(session, paused);
      const request = this.deps.wasm.normalizeRequest({
        id: paused.requestId,
        networkId: paused.networkId ?? null,
        url: paused.request.url,
        method: paused.request.method,
        resourceType: paused.resourceType ?? "Other",
        headers: Object.entries(paused.request.headers ?? {}).map(([name, value]) => ({
          name,
          value: String(value),
        })),
        postData,
        timestampMs: this.now(),
      });

      this.pendingRequests.set(paused.requestId, { session, request });
      await this.transition({
        type: "queueRequest",
        request,
        timestampMs: this.now(),
      });
    } catch (error) {
      this.emitError(toErrorMessage(error));
      await this.resumeRequest(session, paused.requestId);
    }
  }

  async handleDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: string,
  ): Promise<void> {
    if (source.tabId !== this.state.tabId) {
      return;
    }

    this.pendingRequests.clear();
    await this.transition({
      type: "debuggerDetached",
      reason,
      timestampMs: this.now(),
    });
  }

  async updateAllowlist(origins: string[]): Promise<void> {
    const nextAllowlist = normalizeOrigins(origins);
    const currentSiteOrigin = getOrigin(this.state.tabUrl);

    if (currentSiteOrigin) {
      this.preferences.allowlistsByOrigin[currentSiteOrigin] = nextAllowlist.length
        ? nextAllowlist
        : [currentSiteOrigin];
      await this.persistPreferences();
    }

    await this.transition({
      type: "updateAllowlist",
      originAllowlist: nextAllowlist.length
        ? nextAllowlist
        : currentSiteOrigin
          ? [currentSiteOrigin]
          : [],
      timestampMs: this.now(),
    });
  }

  async continueRequest(
    requestId: string,
    headerText?: string,
    bodyText?: string,
  ): Promise<void> {
    const continued = await this.dispatchContinue(requestId, headerText, bodyText);
    if (!continued) {
      return;
    }

    await this.transition({
      type: "continueRequest",
      requestId,
      timestampMs: this.now(),
    });
  }

  async continueAll(): Promise<void> {
    const requestIds = this.state.queue.map((request) => request.id);
    const continued: string[] = [];

    for (const requestId of requestIds) {
      const didContinue = await this.dispatchContinue(requestId);
      if (didContinue) {
        continued.push(requestId);
      }
    }

    if (!continued.length) {
      return;
    }

    await this.transition({
      type: "continueAll",
      requestIds: continued,
      timestampMs: this.now(),
    });
  }

  private async dispatchContinue(
    requestId: string,
    headerText?: string,
    bodyText?: string,
  ): Promise<boolean> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.emitError(`Request ${requestId} is no longer paused.`);
      return false;
    }

    const headers = parseHeaderText(headerText ?? pending.request.headerText);
    const input: ContinueBuildInput = {
      requestId,
      headers,
      body: {
        ...pending.request.body,
        text: bodyText ?? pending.request.body.text,
      },
    };

    try {
      const command = this.deps.wasm.buildContinuePayload(input);
      await this.deps.debuggerApi.sendCommand(pending.session, "Fetch.continueRequest", {
        requestId: command.requestId,
        headers: command.headers,
        ...(command.postDataBase64 ? { postData: command.postDataBase64 } : {}),
      });
      this.pendingRequests.delete(requestId);
      return true;
    } catch (error) {
      this.emitError(toErrorMessage(error));
      return false;
    }
  }

  private async resolvePostData(
    session: DebuggerTarget,
    paused: PausedRequestEvent,
  ): Promise<string | null> {
    if (typeof paused.request.postData === "string") {
      return paused.request.postData;
    }

    if (!paused.networkId) {
      return null;
    }

    try {
      const response = (await this.deps.debuggerApi.sendCommand(
        session,
        "Network.getRequestPostData",
        {
          requestId: paused.networkId,
        },
      )) as { postData?: string };
      return typeof response.postData === "string" ? response.postData : null;
    } catch {
      return null;
    }
  }

  private shouldPause(paused: PausedRequestEvent): boolean {
    const resourceType = paused.resourceType ?? "Other";
    if (resourceType !== "Fetch" && resourceType !== "XHR") {
      return false;
    }

    const origin = getOrigin(paused.request.url);
    if (!origin) {
      return false;
    }

    return this.state.originAllowlist.includes(origin);
  }

  private toSession(source: chrome.debugger.Debuggee): DebuggerTarget {
    const sourceWithSession = source as chrome.debugger.Debuggee & { sessionId?: string };
    return {
      tabId: source.tabId ?? 0,
      ...(typeof sourceWithSession.sessionId === "string"
        ? { sessionId: sourceWithSession.sessionId }
        : {}),
    };
  }

  private async resolveCurrentArmTarget(): Promise<ResolvedArmTarget> {
    const [activeTab] = await this.deps.tabsApi.query({
      active: true,
      lastFocusedWindow: true,
    });
    const activeSnapshot = this.snapshotArmTarget(activeTab, "activeTab");

    if (activeSnapshot.status === "ready") {
      return { snapshot: activeSnapshot, tab: activeTab };
    }

    if (isStoplightPanelUrl(activeSnapshot.tabUrl) && this.state.armTarget.status === "ready") {
      return {
        snapshot: {
          ...this.state.armTarget,
          reason:
            "Stoplight panel is active. The shown website tab will be armed; review it before continuing.",
          source: "retainedTab",
          updatedAtMs: this.now(),
        },
        tab: {
          id: this.state.armTarget.tabId ?? undefined,
          url: this.state.armTarget.tabUrl ?? undefined,
          title: this.state.armTarget.tabTitle ?? undefined,
        },
      };
    }

    if (isStoplightPanelUrl(activeSnapshot.tabUrl)) {
      const fallback = await this.resolveOnlyWebsiteTabTarget();
      if (fallback) {
        return fallback;
      }
    }

    return { snapshot: activeSnapshot, tab: null };
  }

  private async resolveOnlyWebsiteTabTarget(): Promise<ResolvedArmTarget | null> {
    const tabs = await this.deps.tabsApi.query({
      lastFocusedWindow: true,
    });
    const supportedTargets: Array<{ tab: ArmableTab; snapshot: ArmTargetSnapshot }> = [];

    for (const tab of tabs) {
      if (isStoplightPanelUrl(tab.url)) {
        continue;
      }

      const snapshot = this.snapshotArmTarget(tab, "onlyWebsiteTab");
      if (snapshot.status === "ready") {
        supportedTargets.push({ tab, snapshot });
        continue;
      }

      if (!tab.url && typeof tab.id === "number") {
        const inspected = await this.inspectBackgroundTabForArmTarget(tab);
        if (inspected?.snapshot.status === "ready") {
          supportedTargets.push(inspected);
        }
      }
    }

    if (supportedTargets.length !== 1) {
      return null;
    }

    const [{ tab, snapshot }] = supportedTargets;
    return {
      tab,
      snapshot: {
        ...snapshot,
        reason:
          "Stoplight panel is active. This is the only supported website tab in the focused window.",
      },
    };
  }

  private async inspectBackgroundTabForArmTarget(
    tab: ArmableTab,
  ): Promise<{ tab: ArmableTab; snapshot: ArmTargetSnapshot } | null> {
    if (typeof tab.id !== "number") {
      return null;
    }

    const session = { tabId: tab.id };
    let attached = false;
    try {
      await this.deps.debuggerApi.attach(session, CDP_PROTOCOL_VERSION);
      attached = true;
      const metadata = await this.resolveTabMetadata(session, tab);
      const inspectedTab = {
        id: tab.id,
        url: metadata.url ?? undefined,
        title: metadata.title ?? tab.title,
      };
      const snapshot = this.snapshotArmTarget(inspectedTab, "onlyWebsiteTab");
      return { tab: inspectedTab, snapshot };
    } catch {
      return null;
    } finally {
      if (attached) {
        await this.safeDetach(tab.id);
      }
    }
  }

  private snapshotArmTarget(
    tab: ArmableTab | undefined,
    source: "activeTab" | "onlyWebsiteTab",
  ): ArmTargetSnapshot {
    const timestampMs = this.now();
    if (!tab?.id) {
      return {
        tabId: null,
        tabUrl: null,
        tabTitle: null,
        origin: null,
        status: "none",
        reason: "No active tab is available to arm.",
        source: null,
        updatedAtMs: timestampMs,
      };
    }

    const url = tab.url ?? null;
    const title = tab.title ?? null;

    if (isStoplightPanelUrl(url)) {
      return {
        tabId: tab.id,
        tabUrl: url,
        tabTitle: title,
        origin: getOrigin(url),
        status: "unsupported",
        reason:
          "Stoplight panel cannot be armed. Select the website tab you want to inspect, then arm Stoplight.",
        source,
        updatedAtMs: timestampMs,
      };
    }

    if (!url && source === "onlyWebsiteTab") {
      return {
        tabId: tab.id,
        tabUrl: null,
        tabTitle: title,
        origin: null,
        status: "unsupported",
        reason: "Chrome did not expose this background tab URL, so Stoplight cannot confirm it is safe to arm.",
        source,
        updatedAtMs: timestampMs,
      };
    }

    if (!url) {
      return {
        tabId: tab.id,
        tabUrl: null,
        tabTitle: title,
        origin: null,
        status: "ready",
        reason: "Ready to arm this active tab. Chrome will expose its URL after attach.",
        source,
        updatedAtMs: timestampMs,
      };
    }

    if (!isSupportedTargetUrl(url)) {
      return {
        tabId: tab.id,
        tabUrl: url,
        tabTitle: title,
        origin: getOrigin(url),
        status: "unsupported",
        reason: "Only http:// and https:// tabs can be armed for request interception.",
        source,
        updatedAtMs: timestampMs,
      };
    }

    return {
      tabId: tab.id,
      tabUrl: url,
      tabTitle: title,
      origin: getOrigin(url),
      status: "ready",
      reason: "Ready to arm this website tab.",
      source,
      updatedAtMs: timestampMs,
    };
  }

  private async resolveTabMetadata(
    session: DebuggerTarget,
    tab: ArmableTab,
  ): Promise<{
    url: string | null;
    title: string | null;
    origin: string | null;
  }> {
    const evaluatedUrl =
      getOrigin(tab.url) === null
        ? await this.evaluateString(
            session,
            "typeof location === 'object' ? location.href : null",
          )
        : null;
    const url = getOrigin(tab.url) === null ? evaluatedUrl : tab.url ?? evaluatedUrl;
    const title =
      tab.title ??
      (await this.evaluateString(
        session,
        "typeof document === 'object' ? document.title : null",
      ));

    return {
      url,
      title,
      origin: getOrigin(url),
    };
  }

  private async evaluateString(
    session: DebuggerTarget,
    expression: string,
  ): Promise<string | null> {
    try {
      const response = (await this.deps.debuggerApi.sendCommand(
        session,
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
        },
      )) as RuntimeEvaluateResponse;
      const value = response.result?.value;
      return typeof value === "string" && value.length ? value : null;
    } catch {
      return null;
    }
  }

  private async safeDetach(tabId: number): Promise<void> {
    try {
      await this.deps.debuggerApi.detach({ tabId });
    } catch {
      // Ignore cleanup failures after partial arm attempts.
    }
  }

  private async resumeRequest(session: DebuggerTarget, requestId: string): Promise<void> {
    try {
      await this.deps.debuggerApi.sendCommand(session, "Fetch.continueRequest", {
        requestId,
      });
    } catch {
      // Swallow auto-continue failures; the detach path will surface fatal issues separately.
    }
  }

  private async transition(event: SessionEvent): Promise<void> {
    this.state = this.deps.wasm.reduceSessionEvent(this.state, event);
    await this.persistState();
    this.emitState();
  }

  private async persistState(): Promise<void> {
    await this.deps.sessionStorage.set({
      [SESSION_STORAGE_KEY]: this.state,
    });
  }

  private async persistPreferences(): Promise<void> {
    await this.deps.localStorage.set({
      [PREFERENCES_STORAGE_KEY]: this.preferences,
    });
  }

  private emitState(): void {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "state", state: this.state });
    }
  }

  private emitError(message: string): void {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "error", message });
    }
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Unknown error";
}

function isStoplightPanelUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "chrome-extension:" && parsed.pathname.endsWith("/sidepanel.html");
  } catch {
    return false;
  }
}

function isSupportedTargetUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function draftDefaultsForRequest(request: RequestRecord): {
  headerText: string;
  bodyText: string;
} {
  return {
    headerText: request.headerText || headersToText(request.headers),
    bodyText: request.body.text,
  };
}
