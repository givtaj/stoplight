import "./styles.css";

import { EMPTY_SESSION_STATE, PORT_NAME, type PanelCommand, type RequestDiff, type RequestRecord, type SessionState, type WorkerEvent } from "../shared/types";
import { normalizeOrigins, parseHeaderText, requestPathLabel } from "../shared/utils";
import { loadStoplightWasm, type StoplightWasmApi } from "../shared/wasm";

type DraftState = {
  headerText: string;
  bodyText: string;
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing app root.");
}
const appRoot = root;

appRoot.innerHTML = `
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Manual API interception</p>
        <h1>Stoplight</h1>
      </div>
      <div class="hero-actions">
        <button id="arm-button" class="button button-primary">Arm Current Tab</button>
        <button id="detach-button" class="button button-secondary">Detach</button>
      </div>
    </header>

    <section class="status-card">
      <div class="status-head">
        <div>
          <p class="section-label">Session</p>
          <h2 id="tab-title">No tab armed</h2>
        </div>
        <span id="status-pill" class="status-pill idle">idle</span>
      </div>
      <p id="tab-url" class="tab-url">Click the toolbar action on the page you want to inspect, then arm the tab.</p>
      <div class="target-card">
        <div>
          <span class="metric-label">Arm target</span>
          <strong id="arm-target-title" class="target-title">No target selected</strong>
          <p id="arm-target-url" class="target-url">Open an http:// or https:// tab before arming Stoplight.</p>
        </div>
        <span id="arm-target-status" class="target-status none">none</span>
      </div>
      <div id="banner" class="banner hidden"></div>
      <div class="status-grid">
        <div>
          <span class="metric-label">Paused now</span>
          <strong id="paused-count" class="metric-value">0</strong>
        </div>
        <div>
          <span class="metric-label">Request phase</span>
          <strong id="request-phase" class="metric-value">idle</strong>
        </div>
        <div>
          <span class="metric-label">Allowlist</span>
          <strong id="allowlist-count" class="metric-value">0 origins</strong>
        </div>
      </div>
      <p id="phase-detail" class="phase-detail">No target is armed.</p>
      <label class="editor-group">
        <span class="editor-label">Origin allowlist</span>
        <textarea id="allowlist-input" class="allowlist-input" spellcheck="false"></textarea>
      </label>
      <button id="save-allowlist-button" class="button button-secondary">Save Allowlist</button>
    </section>

    <main class="workspace">
      <section class="panel queue-panel">
        <div class="panel-head">
          <div>
            <p class="section-label">Paused requests</p>
            <h3>Queue</h3>
          </div>
          <button id="play-all-button" class="button button-ghost">Play All Originals</button>
        </div>
        <p class="body-hint">Play All forwards each original request unchanged, in arrival order. Editor drafts are not applied.</p>
        <div id="queue-list" class="queue-list"></div>
      </section>

      <section class="panel detail-panel">
        <div class="panel-head">
          <div>
            <p class="section-label">Request detail</p>
            <h3 id="detail-title">Select a paused request</h3>
          </div>
        </div>
        <div id="detail-meta" class="detail-meta"></div>
        <div id="diff-summary" class="diff-summary">No request selected.</div>

        <label class="editor-group">
          <span class="editor-label">Raw headers</span>
          <textarea id="headers-editor" class="code-editor" spellcheck="false"></textarea>
        </label>

        <label class="editor-group">
          <span class="editor-label">Body payload</span>
          <textarea id="body-editor" class="code-editor code-editor-body" spellcheck="false"></textarea>
        </label>

        <p id="body-hint" class="body-hint"></p>

        <div class="detail-actions">
          <button id="continue-unchanged-button" class="button button-secondary">Continue Unchanged</button>
          <button id="continue-edited-button" class="button button-primary">Continue Edited</button>
        </div>
      </section>
    </main>
  </div>
`;

const refs = {
  armButton: query<HTMLButtonElement>("#arm-button"),
  detachButton: query<HTMLButtonElement>("#detach-button"),
  saveAllowlistButton: query<HTMLButtonElement>("#save-allowlist-button"),
  playAllButton: query<HTMLButtonElement>("#play-all-button"),
  tabTitle: query<HTMLElement>("#tab-title"),
  tabUrl: query<HTMLElement>("#tab-url"),
  armTargetTitle: query<HTMLElement>("#arm-target-title"),
  armTargetUrl: query<HTMLElement>("#arm-target-url"),
  armTargetStatus: query<HTMLSpanElement>("#arm-target-status"),
  pausedCount: query<HTMLElement>("#paused-count"),
  requestPhase: query<HTMLElement>("#request-phase"),
  phaseDetail: query<HTMLElement>("#phase-detail"),
  allowlistCount: query<HTMLElement>("#allowlist-count"),
  allowlistInput: query<HTMLTextAreaElement>("#allowlist-input"),
  queueList: query<HTMLDivElement>("#queue-list"),
  detailTitle: query<HTMLElement>("#detail-title"),
  detailMeta: query<HTMLDivElement>("#detail-meta"),
  diffSummary: query<HTMLDivElement>("#diff-summary"),
  headersEditor: query<HTMLTextAreaElement>("#headers-editor"),
  bodyEditor: query<HTMLTextAreaElement>("#body-editor"),
  bodyHint: query<HTMLParagraphElement>("#body-hint"),
  continueUnchangedButton: query<HTMLButtonElement>("#continue-unchanged-button"),
  continueEditedButton: query<HTMLButtonElement>("#continue-edited-button"),
  statusPill: query<HTMLSpanElement>("#status-pill"),
  banner: query<HTMLDivElement>("#banner"),
};

let wasmApi: StoplightWasmApi | null = null;
let state: SessionState = EMPTY_SESSION_STATE;
let selectedRequestId: string | null = null;
const drafts = new Map<string, DraftState>();
let port: chrome.runtime.Port | null = null;
let reconnectTimerId: number | null = null;
let reconnectAttempts = 0;

connectPort();

void loadStoplightWasm()
  .then((api) => {
    wasmApi = api;
    render();
  })
  .catch((error: unknown) => {
    showBanner(error instanceof Error ? error.message : "Failed to load the Rust/WASM core.");
  });

refs.armButton.addEventListener("click", () =>
  send({ type: "armActiveTab", expectedTabId: state.armTarget.tabId, expectedTabUrl: state.armTarget.tabUrl }),
);
refs.detachButton.addEventListener("click", () => send({ type: "detach" }));
refs.saveAllowlistButton.addEventListener("click", () =>
  send({
    type: "updateAllowlist",
    origins: normalizeOrigins(refs.allowlistInput.value),
  }),
);
refs.playAllButton.addEventListener("click", () => send({ type: "continueAll" }));
refs.continueUnchangedButton.addEventListener("click", () => {
  if (!selectedRequestId) {
    return;
  }
  send({ type: "continueUnchanged", requestId: selectedRequestId });
});
refs.continueEditedButton.addEventListener("click", () => {
  const request = getSelectedRequest();
  if (!request?.body.editable) {
    return;
  }

  const draft = ensureDraft(request);
  send({
    type: "continueRequest",
    requestId: request.id,
    headerText: draft.headerText,
    bodyText: draft.bodyText,
  });
});

refs.queueList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const requestButton = target.closest<HTMLButtonElement>("[data-request-id]");
  if (!requestButton) {
    return;
  }

  selectedRequestId = requestButton.dataset.requestId ?? null;
  render();
});

refs.headersEditor.addEventListener("input", () => {
  const request = getSelectedRequest();
  if (!request) {
    return;
  }
  ensureDraft(request).headerText = refs.headersEditor.value;
  renderDiff(request);
});

refs.bodyEditor.addEventListener("input", () => {
  const request = getSelectedRequest();
  if (!request) {
    return;
  }
  ensureDraft(request).bodyText = refs.bodyEditor.value;
  renderDiff(request);
});
window.addEventListener("focus", () => send({ type: "requestState" }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    send({ type: "requestState" });
  }
});

render();

function connectPort(): void {
  clearReconnectTimer();

  try {
    const nextPort = chrome.runtime.connect({ name: PORT_NAME });
    port = nextPort;
    hideBanner();

    nextPort.onMessage.addListener((event: WorkerEvent) => {
      if (port !== nextPort) {
        return;
      }

      if (event.type === "state") {
        reconnectAttempts = 0;
        state = event.state;
        reconcileDrafts();
        hideBanner();
        render();
        return;
      }

      showBanner(event.message);
    });

    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) {
        return;
      }

      port = null;
      scheduleReconnect();
    });

    send({ type: "requestState" });
  } catch (error) {
    port = null;
    scheduleReconnect(error instanceof Error ? error.message : null);
  }
}

function scheduleReconnect(message?: string | null): void {
  if (reconnectTimerId !== null) {
    return;
  }

  showBanner(
    message ??
      "The side panel lost contact with the background worker. Retrying automatically. Reload the extension if this persists.",
  );

  const delayMs = reconnectDelayMs(reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    connectPort();
  }, delayMs);
}

function render(): void {
  refs.tabTitle.textContent = state.tabTitle ?? "No tab armed";
  refs.tabUrl.textContent =
    state.tabUrl ??
    "Click the toolbar action on the page you want to inspect, then arm the tab.";
  refs.pausedCount.textContent = String(state.queue.length);
  renderArmTarget();
  renderRequestPhase();
  refs.allowlistCount.textContent = `${state.originAllowlist.length} origin${state.originAllowlist.length === 1 ? "" : "s"}`;
  refs.statusPill.textContent = state.debuggerStatus;
  refs.statusPill.className = `status-pill ${state.debuggerStatus}`;

  refs.armButton.disabled = state.debuggerStatus === "arming" || state.armTarget.status !== "ready";
  refs.detachButton.disabled = !state.tabId;
  refs.playAllButton.disabled = state.queue.length === 0;

  if (document.activeElement !== refs.allowlistInput) {
    refs.allowlistInput.value = state.originAllowlist.join("\n");
  }

  refs.queueList.innerHTML = state.queue.length
    ? state.queue
        .map((request) => {
          const selected = request.id === selectedRequestId;
          return `
            <button class="queue-item ${selected ? "selected" : ""}" data-request-id="${request.id}">
              <div class="queue-line">
                <span class="method-pill">${request.method}</span>
                <strong>${escapeHtml(requestPathLabel(request.url))}</strong>
              </div>
              <div class="queue-line queue-muted">
                <span>${escapeHtml(request.origin ?? "unknown origin")}</span>
                <span>${escapeHtml(request.body.kind)}</span>
              </div>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state">Paused API calls will appear here once the active tab is armed.</div>`;

  renderDetail();
  renderRequestPhase();
}

function renderArmTarget(): void {
  refs.armTargetTitle.textContent = state.armTarget.tabTitle ?? "No supported target";
  refs.armTargetUrl.textContent =
    state.armTarget.tabUrl ??
    state.armTarget.reason ??
    "Open an http:// or https:// tab before arming Stoplight.";
  refs.armTargetStatus.textContent = state.armTarget.status;
  refs.armTargetStatus.className = `target-status ${state.armTarget.status}`;
}

function renderRequestPhase(): void {
  const phase = requestPhaseView();
  refs.requestPhase.textContent = phase.label;
  refs.requestPhase.className = `metric-value phase-${phase.tone}`;
  refs.phaseDetail.textContent = phase.detail;
}

function renderDetail(): void {
  const request = getSelectedRequest();
  if (!request) {
    refs.detailTitle.textContent = "Select a paused request";
    refs.detailMeta.innerHTML = `<div class="empty-state">No paused request is selected.</div>`;
    refs.headersEditor.value = "";
    refs.bodyEditor.value = "";
    refs.headersEditor.disabled = true;
    refs.bodyEditor.disabled = true;
    refs.bodyHint.textContent = "";
    refs.continueUnchangedButton.disabled = true;
    refs.continueEditedButton.disabled = true;
    refs.diffSummary.textContent = "No request selected.";
    return;
  }

  const draft = ensureDraft(request);
  refs.detailTitle.textContent = requestPathLabel(request.url);
  refs.detailMeta.innerHTML = `
    <span class="meta-pill">${escapeHtml(request.method)}</span>
    <span class="meta-pill">${escapeHtml(request.resourceType)}</span>
    <span class="meta-pill">${escapeHtml(request.body.kind)}</span>
    <span class="meta-pill">${escapeHtml(request.origin ?? "unknown origin")}</span>
  `;
  refs.headersEditor.disabled = !request.body.editable;
  refs.bodyEditor.disabled = !request.body.editable;
  refs.headersEditor.value = draft.headerText;
  refs.bodyEditor.value = draft.bodyText;
  refs.bodyHint.textContent = request.body.editable
    ? "Editable textual body. Continue Edited will send the latest header and body draft."
    : request.body.reason ?? "This body is inspect-only and can only continue unchanged.";
  if (request.body.captureStatus === "unavailable") {
    refs.bodyHint.textContent += " Body preview is unavailable; the empty editor does not mean the original request was empty.";
  } else if (request.body.captureStatus === "truncated") {
    refs.bodyHint.textContent += " Body preview is truncated; only the original request can be forwarded unchanged.";
  }
  refs.continueUnchangedButton.disabled = false;
  refs.continueEditedButton.disabled = !request.body.editable;

  renderDiff(request);
  renderRequestPhase();
}

function renderDiff(request: RequestRecord): void {
  const diff = computeDraftDiff(request);
  if (!wasmApi) {
    refs.diffSummary.textContent = "WASM core is still loading.";
    return;
  }

  refs.diffSummary.textContent = diff?.summary ?? "Could not compute the request diff.";
  renderRequestPhase();
}

function computeDraftDiff(request: RequestRecord): RequestDiff | null {
  const draft = ensureDraft(request);
  if (!wasmApi) {
    return null;
  }

  try {
    return wasmApi.computeDiff({
      originalHeaders: request.headers,
      editedHeaders: parseHeaderText(draft.headerText),
      originalBody: request.body,
      editedBody: {
        ...request.body,
        text: draft.bodyText,
      },
    });
  } catch {
    return null;
  }
}

function requestPhaseView(): { label: string; detail: string; tone: string } {
  if (state.debuggerStatus === "detached") {
    return {
      label: "detached",
      detail: state.detachedReason
        ? `Detached: ${state.detachedReason}. Re-arm a website tab to intercept again.`
        : "Detached. Re-arm a website tab to intercept again.",
      tone: "risk",
    };
  }

  if (state.debuggerStatus === "error") {
    return {
      label: "error",
      detail: state.lastError ?? "Debugger session failed.",
      tone: "risk",
    };
  }

  const selectedRequest = getSelectedRequest();
  if (selectedRequest) {
    const diff = computeDraftDiff(selectedRequest);
    if (diff?.hasChanges) {
      return {
        label: "edited, held",
        detail:
          "Local edits are still held in the browser queue. Continue Edited forwards the draft; verify receipt independently when that matters.",
        tone: "warn",
      };
    }
  }

  if (state.queue.length > 0) {
    return {
      label: "held",
      detail:
        "A matching request is intercepted and has not been continued from Stoplight's queue.",
      tone: "warn",
    };
  }

  switch (state.requestPhase) {
    case "arming":
      return {
        label: "arming",
        detail: "Attaching Chrome debugger to the selected website tab.",
        tone: "warn",
      };
    case "waiting":
      return {
        label: "waiting",
        detail: "Debugger is attached and waiting for a matching XHR or fetch request.",
        tone: "ok",
      };
    case "forwarded":
      return {
        label: "forwarded",
        detail:
          "Stoplight forwarded the queued request. This does not prove remote receipt or durable persistence.",
        tone: "ok",
      };
    case "detached":
      return {
        label: "detached",
        detail: "Detached. Re-arm a website tab to intercept again.",
        tone: "risk",
      };
    case "error":
      return {
        label: "error",
        detail: state.lastError ?? "Debugger session failed.",
        tone: "risk",
      };
    case "held":
      return {
        label: "held",
        detail: "A matching request is intercepted and held in Stoplight's queue.",
        tone: "warn",
      };
    case "idle":
    default:
      return {
        label: "idle",
        detail: state.armTarget.status === "ready"
          ? "Review the shown website target, then arm Stoplight."
          : state.armTarget.reason ?? "No supported website target is selected.",
        tone: state.armTarget.status === "ready" ? "ok" : "muted",
      };
  }
}

function reconcileDrafts(): void {
  const activeIds = new Set(state.queue.map((request) => request.id));
  for (const requestId of Array.from(drafts.keys())) {
    if (!activeIds.has(requestId)) {
      drafts.delete(requestId);
    }
  }

  if (!selectedRequestId || !activeIds.has(selectedRequestId)) {
    selectedRequestId = state.queue[0]?.id ?? null;
  }
}

function getSelectedRequest(): RequestRecord | null {
  return state.queue.find((request) => request.id === selectedRequestId) ?? null;
}

function ensureDraft(request: RequestRecord): DraftState {
  const existing = drafts.get(request.id);
  if (existing) {
    return existing;
  }

  const draft: DraftState = {
    headerText: request.headerText,
    bodyText: request.body.text,
  };
  drafts.set(request.id, draft);
  return draft;
}

function send(command: PanelCommand): void {
  if (!port) {
    scheduleReconnect();
    return;
  }

  try {
    port.postMessage(command);
  } catch (error) {
    port = null;
    scheduleReconnect(error instanceof Error ? error.message : null);
  }
}

function showBanner(message: string): void {
  refs.banner.textContent = message;
  refs.banner.classList.remove("hidden");
}

function hideBanner(): void {
  refs.banner.textContent = "";
  refs.banner.classList.add("hidden");
}

function clearReconnectTimer(): void {
  if (reconnectTimerId === null) {
    return;
  }

  window.clearTimeout(reconnectTimerId);
  reconnectTimerId = null;
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2_000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function query<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element for selector: ${selector}`);
  }
  return element;
}
