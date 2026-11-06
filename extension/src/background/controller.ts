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
const MAX_BODY_PREVIEW_BYTES = 1024 * 1024;

type DebuggerTarget = { tabId: number; sessionId?: string };

interface PausedRequestEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string | number | boolean>;
    postData?: string;
    hasPostData?: boolean;
  };
  resourceType?: string;
  networkId?: string;
  responseStatusCode?: number;
}

interface PendingRequest {
  session: DebuggerTarget;
  request: RequestRecord;
}

interface BodyCapture {
  text: string | null;
  status: "complete" | "unavailable" | "truncated";
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
  private readonly continuingRequests = new Map<string, number>();
  private pauseQueue: Promise<void> = Promise.resolve();
  private stateWrite: Promise<void> = Promise.resolve();
  private sessionGeneration = 0;
  private armInFlight = false;
  private playAllInFlight = false;

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

    if (this.state.debuggerStatus === "attached" || this.state.debuggerStatus === "arming"
      || (this.state.debuggerStatus === "error" && this.state.queue.length > 0)) {
      if (typeof this.state.tabId === "number") {
        // A service-worker restart can leave the debugger transport attached.
        // Detach it before dropping the recovered queue so held traffic settles.
        const detached = await this.safeDetach(this.state.tabId);
        if (!detached) {
          for (const request of this.state.queue) {
            this.pendingRequests.set(request.id, { session: { tabId: this.state.tabId }, request });
          }
          await this.transition({
            type: "debuggerError",
            message: "The worker restarted but Chrome could not detach the previous session. Retry Detach to release held requests.",
            timestampMs: this.now(),
          });
          return;
        }
      }
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
        await this.armActiveTab(command.expectedTabId, command.expectedTabUrl);
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

  async armActiveTab(expectedTabId?: number | null, expectedTabUrl?: string | null): Promise<void> {
    if (this.armInFlight) {
      return;
    }
    this.armInFlight = true;
    try {
      await this.armReviewedTab(expectedTabId, expectedTabUrl);
    } finally {
      this.armInFlight = false;
    }
  }

  private async armReviewedTab(expectedTabId?: number | null, expectedTabUrl?: string | null): Promise<void> {
    let generation = this.sessionGeneration;
    const target = await this.resolveCurrentArmTarget();
    if (generation !== this.sessionGeneration) {
      return;
    }
    await this.transition({
      type: "updateArmTarget",
      armTarget: target.snapshot,
      timestampMs: this.now(),
    });
    if (generation !== this.sessionGeneration) {
      return;
    }

    if (target.snapshot.status !== "ready" || typeof target.tab?.id !== "number") {
      this.emitError(
        target.snapshot.reason ?? "No supported http:// or https:// tab is available to arm.",
      );
      return;
    }

    if ((expectedTabId != null && expectedTabId !== target.tab.id)
      || (expectedTabUrl !== undefined && expectedTabUrl !== target.snapshot.tabUrl)) {
      this.emitError(
        "Arm target changed before arming. Review the shown target and try again.",
      );
      return;
    }

    if (this.state.tabId && !["idle", "detached"].includes(this.state.debuggerStatus)) {
      if (!await this.detach("replaced_by_new_session")) {
        return;
      }
      generation = this.sessionGeneration;
    }

    const tab = target.tab;
    const targetTabId = tab.id;
    if (typeof targetTabId !== "number") {
      this.emitError("No supported http:// or https:// tab is available to arm.");
      return;
    }
    const session: DebuggerTarget = { tabId: targetTabId };
    generation = ++this.sessionGeneration;
    this.pauseQueue = Promise.resolve();
    let attached = false;

    try {
      await this.deps.debuggerApi.attach(session, CDP_PROTOCOL_VERSION);
      attached = true;

      const tabMetadata = await this.resolveTabMetadata(session, tab);
      if (generation !== this.sessionGeneration) {
        await this.safeDetach(targetTabId);
        return;
      }
      if (!isSupportedTargetUrl(tabMetadata.url) || !tabMetadata.origin) {
        this.emitError("The active tab does not expose a usable origin.");
        await this.safeDetach(targetTabId);
        return;
      }
      if (target.snapshot.tabUrl && tabMetadata.url !== target.snapshot.tabUrl) {
        await this.safeDetach(targetTabId);
        await this.refreshArmTarget();
        this.emitError("Arm target changed before arming. Review the shown target and try again.");
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
      if (generation !== this.sessionGeneration) {
        await this.safeDetach(targetTabId);
        return;
      }

      await this.deps.debuggerApi.sendCommand(session, "Network.enable", {
        maxPostDataSize: MAX_BODY_PREVIEW_BYTES,
      });
      if (generation !== this.sessionGeneration) {
        await this.safeDetach(targetTabId);
        return;
      }
      await this.deps.debuggerApi.sendCommand(session, "Fetch.enable", {
        patterns: [
          { resourceType: "XHR", requestStage: "Request" },
          { resourceType: "Fetch", requestStage: "Request" },
        ],
      });
      if (generation !== this.sessionGeneration) {
        await this.safeDetach(targetTabId);
        return;
      }

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

  async detach(reason: string): Promise<boolean> {
    const tabId = this.state.tabId;
    if (!tabId) {
      this.sessionGeneration += 1;
      return true;
    }

    try {
      await this.deps.debuggerApi.detach({ tabId });
    } catch (error) {
      if (!isAlreadyDetached(error)) {
        this.emitError(`Could not detach: ${toErrorMessage(error)}. Retry Detach to release interception.`);
        return false;
      }
    }

    this.sessionGeneration += 1;
    this.pauseQueue = Promise.resolve();
    this.pendingRequests.clear();
    this.continuingRequests.clear();
    await this.transition({
      type: "debuggerDetached",
      reason,
      timestampMs: this.now(),
    });
    return true;
  }

  async handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: unknown,
  ): Promise<void> {
    if (method !== "Fetch.requestPaused" || source.tabId !== this.state.tabId
      || !["attached", "arming"].includes(this.state.debuggerStatus)) {
      return;
    }

    const paused = params as PausedRequestEvent;
    const session = this.toSession(source);

    if (paused.responseStatusCode !== undefined || !this.shouldPause(paused)) {
      await this.resumeRequest(session, paused.requestId);
      return;
    }

    const generation = this.sessionGeneration;
    const receivedAtMs = this.now();
    // Queue before the first asynchronous body lookup to retain event arrival
    // order even when some payloads require a slower Network lookup.
    const pendingPause = this.pauseQueue.then(async () => {
      if (generation !== this.sessionGeneration) {
        return;
      }
      const capture = await this.resolvePostData(session, paused);
      if (generation !== this.sessionGeneration) {
        return;
      }
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
        postData: capture.text,
        timestampMs: receivedAtMs,
      });
      request.body.captureStatus = capture.status;
      if (capture.status !== "complete") {
        request.body.editable = false;
        request.body.reason = capture.status === "truncated"
          ? "Body capture is truncated. This request can only continue unchanged."
          : request.body.reason ?? "Body capture is unavailable. This request can only continue unchanged.";
      }

      this.pendingRequests.set(paused.requestId, { session, request });
      await this.transition({
        type: "queueRequest",
        request,
        timestampMs: this.now(),
      });
    }).catch((error) => {
      if (generation === this.sessionGeneration) {
        // A capture or persistence failure is never authorization to send a
        // matching request. Keep the debugger attached for explicit recovery.
        this.emitError(`${toErrorMessage(error)} Request remains held; use Continue Unchanged or Detach to recover.`);
      }
    });
    this.pauseQueue = pendingPause;
    await pendingPause;
  }

  async handleDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: string,
  ): Promise<void> {
    if (source.tabId !== this.state.tabId) {
      return;
    }

    this.sessionGeneration += 1;
    this.pauseQueue = Promise.resolve();
    this.pendingRequests.clear();
    this.continuingRequests.clear();
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
    const generation = this.sessionGeneration;
    const continued = await this.dispatchContinue(requestId, headerText, bodyText);
    if (!continued || generation !== this.sessionGeneration) {
      return;
    }

    await this.transition({
      type: "continueRequest",
      requestId,
      timestampMs: this.now(),
    });
  }

  async continueAll(): Promise<void> {
    if (this.playAllInFlight) {
      return;
    }
    this.playAllInFlight = true;
    try {
      await this.continueAllOriginals();
    } finally {
      this.playAllInFlight = false;
    }
  }

  private async continueAllOriginals(): Promise<void> {
    const generation = this.sessionGeneration;
    const requestIds = this.state.queue.map((request) => request.id);
    const continued: string[] = [];

    for (const requestId of requestIds) {
      if (generation !== this.sessionGeneration) {
        return;
      }
      const didContinue = await this.dispatchContinue(requestId);
      if (didContinue) {
        continued.push(requestId);
      }
    }

    if (!continued.length || generation !== this.sessionGeneration) {
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
    if (this.continuingRequests.has(requestId)) {
      return false;
    }
    if (!pending) {
      this.emitError(`Request ${requestId} is no longer paused.`);
      return false;
    }

    const hasDraft = headerText !== undefined || bodyText !== undefined;
    const generation = this.sessionGeneration;
    if (hasDraft && !pending.request.body.editable) {
      this.emitError("This request is inspect-only and can only continue unchanged.");
      return false;
    }

    try {
      this.continuingRequests.set(requestId, generation);
      if (!hasDraft) {
        // Let Chrome retain the original headers and bytes, including multipart
        // file parts and binary data that CDP may not expose as text.
        await this.deps.debuggerApi.sendCommand(pending.session, "Fetch.continueRequest", {
          requestId,
        });
      } else {
        const input: ContinueBuildInput = {
          requestId,
          headers: parseHeaderText(headerText ?? pending.request.headerText),
          body: {
            ...pending.request.body,
            text: bodyText ?? pending.request.body.text,
          },
        };
        const command = this.deps.wasm.buildContinuePayload(input);
        const postData = bodyText === "" ? "" : command.postDataBase64;
        await this.deps.debuggerApi.sendCommand(pending.session, "Fetch.continueRequest", {
          requestId: command.requestId,
          headers: command.headers,
          ...(postData !== null ? { postData } : {}),
        });
      }
      if (generation !== this.sessionGeneration) {
        return false;
      }
      this.pendingRequests.delete(requestId);
      return true;
    } catch (error) {
      this.emitError(toErrorMessage(error));
      return false;
    } finally {
      if (this.continuingRequests.get(requestId) === generation) {
        this.continuingRequests.delete(requestId);
      }
    }
  }

  private async resolvePostData(
    session: DebuggerTarget,
    paused: PausedRequestEvent,
  ): Promise<BodyCapture> {
    const contentLengthText = Object.entries(paused.request.headers)
      .find(([name]) => name.toLowerCase() === "content-length")?.[1];
    const contentLength = contentLengthText === undefined ? null : Number(contentLengthText);
    let text = paused.request.postData;
    if (typeof text !== "string" && paused.networkId && paused.request.hasPostData !== false) {
      try {
        const response = (await this.deps.debuggerApi.sendCommand(
          session, "Network.getRequestPostData", { requestId: paused.networkId },
        )) as { postData?: string } | undefined;
        text = response?.postData;
      } catch {
        // Missing capture must not be interpreted as an editable empty body.
      }
    }
    if (typeof text !== "string") {
      const bodyless = paused.request.hasPostData === false
        || (paused.request.hasPostData !== true && (contentLength === 0
          || ["GET", "HEAD"].includes(paused.request.method.toUpperCase())));
      return bodyless ? { text: "", status: "complete" } : { text: null, status: "unavailable" };
    }
    const byteLength = new TextEncoder().encode(text).length;
    if (byteLength > MAX_BODY_PREVIEW_BYTES) {
      return { text: text.slice(0, MAX_BODY_PREVIEW_BYTES / 4), status: "truncated" };
    }
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength > byteLength) {
      return { text, status: text.length ? "truncated" : "unavailable" };
    }
    if (text === "" && paused.request.hasPostData === true && contentLength !== 0) {
      return { text: null, status: "unavailable" };
    }
    return { text, status: "complete" };
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
      const tabs = await this.deps.tabsApi.query({ lastFocusedWindow: true });
      const retainedTab = tabs.find((tab) => tab.id === this.state.armTarget.tabId);
      const retainedSnapshot = this.snapshotArmTarget(retainedTab, "retainedTab");
      return {
        snapshot: {
          ...retainedSnapshot,
          reason:
            retainedSnapshot.status === "ready"
              ? "Stoplight panel is active. The shown website tab will be armed; review it before continuing."
              : retainedSnapshot.reason,
          source: "retainedTab",
          updatedAtMs: this.now(),
        },
        tab: retainedTab ?? null,
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

  private snapshotArmTarget(
    tab: ArmableTab | undefined,
    source: "activeTab" | "onlyWebsiteTab" | "retainedTab",
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

    if (!url && source !== "activeTab") {
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
    const evaluatedUrl = await this.evaluateString(
      session,
      "typeof location === 'object' ? location.href : null",
    );
    const liveTab = evaluatedUrl ? tab : (await this.deps.tabsApi.query({})).find((candidate) => candidate.id === tab.id);
    const url = evaluatedUrl ?? liveTab?.url ?? null;
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

  private async safeDetach(tabId: number): Promise<boolean> {
    try {
      await this.deps.debuggerApi.detach({ tabId });
      return true;
    } catch (error) {
      return isAlreadyDetached(error);
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
    this.emitState();
    try {
      await this.persistState();
    } catch (error) {
      this.emitError(`Could not save session state: ${toErrorMessage(error)}. The visible session is still active in memory; use Detach before closing if interception is active.`);
    }
  }

  private async persistState(): Promise<void> {
    const snapshot = this.state;
    // Serialize writes so a slow older queue snapshot cannot restore captured
    // headers or bodies after a newer detach/continue has cleared them.
    const write = this.stateWrite.catch(() => undefined).then(() =>
      this.deps.sessionStorage.set({ [SESSION_STORAGE_KEY]: snapshot }),
    );
    this.stateWrite = write;
    await write;
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

function isAlreadyDetached(error: unknown): boolean {
  return /not attached|no tab with given id|no target with given id/i.test(toErrorMessage(error));
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
