use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderDraft {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditableBodyKind {
    Empty,
    Json,
    FormUrlEncoded,
    Text,
    Xml,
    Multipart,
    Binary,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum BodyCaptureStatus {
    #[default]
    Complete,
    Unavailable,
    Truncated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditableBody {
    pub kind: EditableBodyKind,
    pub text: String,
    pub editable: bool,
    #[serde(default)]
    pub capture_status: BodyCaptureStatus,
    pub encoding: Option<String>,
    pub reason: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    pub id: String,
    pub network_id: Option<String>,
    pub origin: Option<String>,
    pub url: String,
    pub method: String,
    pub resource_type: String,
    pub headers: Vec<HeaderDraft>,
    pub header_text: String,
    pub body: EditableBody,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinueBuildInput {
    pub request_id: String,
    pub headers: Vec<HeaderDraft>,
    pub body: EditableBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinueCommand {
    pub request_id: String,
    pub headers: Vec<HeaderDraft>,
    pub post_data_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DebuggerStatus {
    #[default]
    Idle,
    Arming,
    Attached,
    Detached,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RequestPhase {
    #[default]
    Idle,
    Arming,
    Waiting,
    Held,
    Forwarded,
    Detached,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ArmTargetStatus {
    #[default]
    None,
    Ready,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArmTargetSource {
    ActiveTab,
    RetainedTab,
    OnlyWebsiteTab,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArmTargetSnapshot {
    pub tab_id: Option<i32>,
    pub tab_url: Option<String>,
    pub tab_title: Option<String>,
    pub origin: Option<String>,
    pub status: ArmTargetStatus,
    pub reason: Option<String>,
    pub source: Option<ArmTargetSource>,
    pub updated_at_ms: i64,
}

impl Default for ArmTargetSnapshot {
    fn default() -> Self {
        Self {
            tab_id: None,
            tab_url: None,
            tab_title: None,
            origin: None,
            status: ArmTargetStatus::None,
            reason: Some("Open an http:// or https:// tab before arming Stoplight.".into()),
            source: None,
            updated_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub tab_id: Option<i32>,
    pub tab_url: Option<String>,
    pub tab_title: Option<String>,
    #[serde(default)]
    pub arm_target: ArmTargetSnapshot,
    pub origin_allowlist: Vec<String>,
    pub debugger_status: DebuggerStatus,
    #[serde(default)]
    pub request_phase: RequestPhase,
    pub queue: Vec<RequestRecord>,
    pub detached_reason: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_forwarded_at_ms: Option<i64>,
    #[serde(default)]
    pub forwarded_request_count: usize,
    pub updated_at_ms: i64,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            tab_id: None,
            tab_url: None,
            tab_title: None,
            arm_target: ArmTargetSnapshot::default(),
            origin_allowlist: Vec::new(),
            debugger_status: DebuggerStatus::Idle,
            request_phase: RequestPhase::Idle,
            queue: Vec::new(),
            detached_reason: None,
            last_error: None,
            last_forwarded_at_ms: None,
            forwarded_request_count: 0,
            updated_at_ms: 0,
        }
    }
}
