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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditableBody {
    pub kind: EditableBodyKind,
    pub text: String,
    pub editable: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub tab_id: Option<i32>,
    pub tab_url: Option<String>,
    pub tab_title: Option<String>,
    pub origin_allowlist: Vec<String>,
    pub debugger_status: DebuggerStatus,
    pub queue: Vec<RequestRecord>,
    pub detached_reason: Option<String>,
    pub last_error: Option<String>,
    pub updated_at_ms: i64,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            tab_id: None,
            tab_url: None,
            tab_title: None,
            origin_allowlist: Vec::new(),
            debugger_status: DebuggerStatus::Idle,
            queue: Vec::new(),
            detached_reason: None,
            last_error: None,
            updated_at_ms: 0,
        }
    }
}
