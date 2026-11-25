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
    <header class="masthead">
      <div class="brand">
        <img class="signal-mark" src="assets/stoplight-32.png" srcset="assets/stoplight-48.png 1.5x, assets/stoplight-128.png 4x" width="32" height="32" alt="">
        <h1>Stoplight</h1>
      </div>
      <span id="status-pill" class="status-pill idle" role="status" aria-label="Debugger status">idle</span>
    </header>

    <section class="target-panel" aria-labelledby="target-label">
      <div class="section-top">
        <h2 id="target-label" class="section-label">Arm target</h2>
        <span id="arm-target-status" class="target-status none">none</span>
      </div>
      <h3 id="arm-target-title" class="target-title">No target selected</h3>
      <p id="arm-target-url" class="target-url"></p>
      <div id="session-context" class="session-context" hidden>
        <span class="section-label">Session tab</span>
        <strong id="tab-title">No tab armed</strong>
        <span id="tab-url"></span>
      </div>
      <div class="target-actions">
        <button id="arm-button" class="button primary"><span class="arm-icon" aria-hidden="true"></span>Arm Current Tab</button>
        <button id="detach-button" class="button secondary">Detach</button>
      </div>
      <div id="banner" class="banner hidden" role="alert"></div>
      <details id="origin-settings" class="disclosure origin-settings">
        <summary>Origin allowlist <span id="allowlist-count" class="origin-count">0 origins</span></summary>
        <div class="settings-fields">
          <label for="allowlist-input">Allowed origins</label>
          <textarea id="allowlist-input" aria-describedby="allowlist-help" rows="2" spellcheck="false"></textarea>
          <p id="allowlist-help" class="hint">Enter one origin per line. Include the API origin if it differs from the page.</p>
          <button id="save-allowlist-button" class="button secondary">Save Allowlist</button>
        </div>
      </details>
    </section>

    <main class="workspace">
      <section class="panel queue-panel" aria-labelledby="queue-heading">
        <div class="panel-head">
          <div class="heading-group">
            <h2 id="queue-heading">Queue</h2>
            <span id="paused-count" class="count">0</span>
          </div>
          <button id="play-all-button" class="button batch">Play All Originals</button>
        </div>
        <div class="phase">
          <span id="request-phase" class="phase-label">idle</span>
          <span id="phase-detail"></span>
        </div>
        <div id="queue-list" class="queue-list"></div>
        <p id="queue-hint" class="hint queue-hint" hidden>Play All sends originals in order and discards drafts.</p>
      </section>

      <section class="panel detail-panel" aria-label="Request detail" hidden>
        <div class="detail-head">
          <p class="section-label">Request detail</p>
          <h2 id="detail-title">Select a paused request</h2>
          <div id="detail-meta" class="detail-meta"></div>
        </div>
        <p id="preflight-hint" class="notice" hidden></p>
        <div class="editors">
          <div id="payload-field">
            <label class="editor-caption" for="body-editor">Body payload</label>
            <textarea id="body-editor" aria-describedby="body-hint" rows="3" spellcheck="false"></textarea>
          </div>
          <p id="body-hint" class="hint"></p>
          <details id="header-settings" class="disclosure header-settings">
            <summary>Raw headers</summary>
            <textarea id="headers-editor" aria-label="Raw headers" rows="4" spellcheck="false"></textarea>
          </details>
          <p id="diff-summary" class="diff-summary">No request selected.</p>
        </div>
        <div class="detail-actions">
          <button id="continue-unchanged-button" class="button secondary">Continue Unchanged</button>
          <button id="continue-edited-button" class="button primary">Continue Edited</button>
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
  sessionContext: query<HTMLElement>("#session-context"),
  detailPanel: query<HTMLElement>(".detail-panel"),
  queueHint: query<HTMLElement>("#queue-hint"),
  payloadField: query<HTMLElement>("#payload-field"),
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
  preflightHint: query<HTMLParagraphElement>("#preflight-hint"),
  diffSummary: query<HTMLParagraphElement>("#diff-summary"),
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
  renderRequestPhase();
});

refs.bodyEditor.addEventListener("input", () => {
  const request = getSelectedRequest();
  if (!request) {
    return;
  }
  ensureDraft(request).bodyText = refs.bodyEditor.value;
  renderDiff(request);
  renderRequestPhase();
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
  const sameTarget = state.tabId === state.armTarget.tabId && state.tabUrl === state.armTarget.tabUrl;
  const attachedHere = state.debuggerStatus === "attached" && sameTarget;
  refs.sessionContext.hidden = !state.tabId || sameTarget;
  refs.armButton.classList.toggle("primary", !attachedHere);
  refs.armButton.classList.toggle("secondary", attachedHere);
  refs.allowlistCount.textContent = `${state.originAllowlist.length} origin${state.originAllowlist.length === 1 ? "" : "s"}`;
  refs.statusPill.textContent = state.debuggerStatus;
  refs.statusPill.className = `status-pill ${state.debuggerStatus}`;

  refs.armButton.disabled = state.debuggerStatus === "arming" || state.armTarget.status !== "ready";
  refs.detachButton.disabled = !state.tabId;
  refs.playAllButton.disabled = state.queue.length === 0;

  if (document.activeElement !== refs.allowlistInput) {
    refs.allowlistInput.value = state.originAllowlist.join("\n");
  }

  const focusedId = document.activeElement instanceof HTMLButtonElement
    ? document.activeElement.dataset.requestId
    : undefined;
  refs.queueHint.hidden = state.queue.length === 0;
  refs.queueList.innerHTML = state.queue.length
    ? state.queue
        .map((request) => {
          const selected = request.id === selectedRequestId;
          const preflight = Boolean(corsPreflightMethod(request));
          const kind = request.body.kind === "empty" && request.body.captureStatus === "unavailable"
            ? "No preview"
            : request.body.kind;
          return `
            <button class="queue-item" aria-pressed="${selected}" data-request-id="${escapeHtml(request.id)}">
              <span class="method-pill">${escapeHtml(request.method)}</span>
              <span class="queue-description">
                <strong>${escapeHtml(requestPathLabel(request.url))}</strong>
                <span class="queue-origin">${escapeHtml(request.origin ?? "Unknown origin")}</span>
              </span>
              <span class="kind${preflight ? " preflight" : ""}">${preflight ? "CORS preflight" : escapeHtml(kind)}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state"><span class="empty-glyph" aria-hidden="true"></span><span>No paused requests</span></div>`;
  if (focusedId) {
    refs.queueList.querySelector<HTMLButtonElement>(`[data-request-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

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
  refs.requestPhase.className = `phase-label phase-${phase.tone}`;
  refs.phaseDetail.textContent = phase.detail;
}

function renderDetail(): void {
  const request = getSelectedRequest();
  refs.detailPanel.hidden = !request;
  const preflightMethod = request && corsPreflightMethod(request);
  refs.preflightHint.hidden = !preflightMethod;
  refs.preflightHint.textContent = preflightMethod
    ? `CORS preflight. Choose Continue Unchanged to check whether the server allows ${preflightMethod}. If it does, look for that request in the queue.`
    : "";
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
  const { body } = request;
  const unavailable = body.captureStatus === "unavailable";
  const unavailableEmpty = unavailable && body.kind === "empty";
  refs.detailMeta.innerHTML = `
    <span class="meta-pill">${escapeHtml(request.method)}</span>
    <span class="meta-pill">${escapeHtml(request.resourceType)}</span>
    ${unavailableEmpty ? "" : `<span class="meta-pill">${escapeHtml(body.kind)}</span>`}
    <span class="detail-origin">${escapeHtml(request.origin ?? "Unknown origin")}</span>
  `;
  refs.payloadField.hidden = !body.editable && !body.text && (unavailable || Boolean(preflightMethod));
  refs.headersEditor.disabled = !body.editable;
  refs.bodyEditor.disabled = !body.editable;
  refs.headersEditor.value = draft.headerText;
  refs.bodyEditor.value = draft.bodyText;
  refs.bodyHint.textContent = body.editable ? "" : body.reason ?? "This body can only continue unchanged.";
  if (unavailableEmpty) {
    refs.bodyHint.textContent = "Body preview unavailable. Continue Unchanged forwards the original request.";
  } else if (unavailable) {
    refs.bodyHint.textContent += " Body preview unavailable.";
  } else if (body.captureStatus === "truncated") {
    refs.bodyHint.textContent += " Body preview is truncated.";
  }
  refs.bodyHint.hidden = body.editable || (refs.payloadField.hidden && !unavailable);
  refs.continueUnchangedButton.disabled = false;
  refs.continueUnchangedButton.classList.toggle("primary", !body.editable);
  refs.continueUnchangedButton.classList.toggle("secondary", body.editable);
  refs.continueEditedButton.disabled = !body.editable;

  renderDiff(request);
}

function corsPreflightMethod(request: RequestRecord): string | null {
  if (request.method !== "OPTIONS") {
    return null;
  }
  const header = request.headers.find(({ name }) => name.toLowerCase() === "access-control-request-method");
  return header?.value.trim() || null;
}

function renderDiff(request: RequestRecord): void {
  const diff = computeDraftDiff(request);
  if (!wasmApi) {
    refs.diffSummary.textContent = "WASM core is still loading.";
    return;
  }

  refs.diffSummary.classList.toggle("changed", Boolean(diff?.hasChanges));
  refs.diffSummary.textContent = diff?.summary ?? "Could not compute the request diff.";
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
          "Your edits are still held. Continue Edited sends this draft.",
        tone: "warn",
      };
    }
  }

  if (state.queue.length > 0) {
    return {
      label: "held",
      detail:
        "Select a request to inspect or edit it before sending.",
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
        detail: "Trigger a Fetch or XHR request from the armed tab.",
        tone: "ok",
      };
    case "forwarded":
      return {
        label: "forwarded",
        detail:
          "Sent to the network. This does not prove remote receipt.",
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
