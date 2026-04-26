export type DebuggerStatus = "idle" | "arming" | "attached" | "detached" | "error";

export type EditableBodyKind =
  | "empty"
  | "json"
  | "formUrlEncoded"
  | "text"
  | "xml"
  | "multipart"
  | "binary"
  | "unknown";

export interface HeaderDraft {
  name: string;
  value: string;
}

export interface EditableBody {
  kind: EditableBodyKind;
  text: string;
  editable: boolean;
  encoding: string | null;
  reason: string | null;
  contentType: string | null;
}

export interface RequestRecord {
  id: string;
  networkId: string | null;
  origin: string | null;
  url: string;
  method: string;
  resourceType: string;
  headers: HeaderDraft[];
  headerText: string;
  body: EditableBody;
  createdAtMs: number;
}

export interface ContinueBuildInput {
  requestId: string;
  headers: HeaderDraft[];
  body: EditableBody;
}

export interface ContinueCommand {
  requestId: string;
  headers: HeaderDraft[];
  postDataBase64: string | null;
}

export interface NormalizeRequestInput {
  id: string;
  networkId: string | null;
  url: string;
  method: string;
  resourceType: string;
  headers: HeaderDraft[];
  postData: string | null;
  timestampMs: number;
}

export interface DecodeBodyInput {
  contentType: string | null;
  postData: string | null;
}

export interface ComputeDiffInput {
  originalHeaders: HeaderDraft[];
  editedHeaders: HeaderDraft[];
  originalBody: EditableBody;
  editedBody: EditableBody;
}

export interface RequestDiff {
  hasChanges: boolean;
  headersChanged: boolean;
  bodyChanged: boolean;
  changedHeaders: string[];
  summary: string;
}

export interface SessionState {
  tabId: number | null;
  tabUrl: string | null;
  tabTitle: string | null;
  originAllowlist: string[];
  debuggerStatus: DebuggerStatus;
  queue: RequestRecord[];
  detachedReason: string | null;
  lastError: string | null;
  updatedAtMs: number;
}

export type SessionEvent =
  | {
      type: "beginArmSession";
      tabId: number;
      tabUrl: string | null;
      tabTitle: string | null;
      originAllowlist: string[];
      timestampMs: number;
    }
  | {
      type: "armSession";
      timestampMs: number;
    }
  | {
      type: "updateAllowlist";
      originAllowlist: string[];
      timestampMs: number;
    }
  | {
      type: "queueRequest";
      request: RequestRecord;
      timestampMs: number;
    }
  | {
      type: "continueRequest";
      requestId: string;
      timestampMs: number;
    }
  | {
      type: "continueAll";
      requestIds: string[];
      timestampMs: number;
    }
  | {
      type: "debuggerDetached";
      reason: string;
      timestampMs: number;
    }
  | {
      type: "debuggerError";
      message: string;
      timestampMs: number;
    }
  | {
      type: "reset";
      timestampMs: number;
    }
  | {
      type: "rehydrate";
      state: SessionState;
    };

export interface StoplightPreferences {
  allowlistsByOrigin: Record<string, string[]>;
}

export type PanelCommand =
  | { type: "requestState" }
  | { type: "armActiveTab" }
  | { type: "detach" }
  | { type: "continueUnchanged"; requestId: string }
  | {
      type: "continueRequest";
      requestId: string;
      headerText: string;
      bodyText: string;
    }
  | { type: "continueAll" }
  | { type: "updateAllowlist"; origins: string[] };

export type WorkerEvent =
  | { type: "state"; state: SessionState }
  | { type: "error"; message: string };

export const PORT_NAME = "stoplight-panel";
export const SESSION_STORAGE_KEY = "stoplight.sessionState";
export const PREFERENCES_STORAGE_KEY = "stoplight.preferences";

export const EMPTY_SESSION_STATE: SessionState = {
  tabId: null,
  tabUrl: null,
  tabTitle: null,
  originAllowlist: [],
  debuggerStatus: "idle",
  queue: [],
  detachedReason: null,
  lastError: null,
  updatedAtMs: 0,
};
