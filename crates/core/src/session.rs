use crate::model::{DebuggerStatus, RequestRecord, SessionState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionEvent {
    BeginArmSession {
        tab_id: i32,
        tab_url: Option<String>,
        tab_title: Option<String>,
        origin_allowlist: Vec<String>,
        timestamp_ms: i64,
    },
    ArmSession {
        timestamp_ms: i64,
    },
    UpdateAllowlist {
        origin_allowlist: Vec<String>,
        timestamp_ms: i64,
    },
    QueueRequest {
        request: RequestRecord,
        timestamp_ms: i64,
    },
    ContinueRequest {
        request_id: String,
        timestamp_ms: i64,
    },
    ContinueAll {
        request_ids: Vec<String>,
        timestamp_ms: i64,
    },
    DebuggerDetached {
        reason: String,
        timestamp_ms: i64,
    },
    DebuggerError {
        message: String,
        timestamp_ms: i64,
    },
    Reset {
        timestamp_ms: i64,
    },
    Rehydrate {
        state: SessionState,
    },
}

pub fn reduce_session_event(mut state: SessionState, event: SessionEvent) -> SessionState {
    match event {
        SessionEvent::BeginArmSession {
            tab_id,
            tab_url,
            tab_title,
            origin_allowlist,
            timestamp_ms,
        } => {
            state.tab_id = Some(tab_id);
            state.tab_url = tab_url;
            state.tab_title = tab_title;
            state.origin_allowlist = dedupe_allowlist(origin_allowlist);
            state.debugger_status = DebuggerStatus::Arming;
            state.queue.clear();
            state.detached_reason = None;
            state.last_error = None;
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::ArmSession { timestamp_ms } => {
            state.debugger_status = DebuggerStatus::Attached;
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::UpdateAllowlist {
            origin_allowlist,
            timestamp_ms,
        } => {
            state.origin_allowlist = dedupe_allowlist(origin_allowlist);
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::QueueRequest {
            request,
            timestamp_ms,
        } => {
            if let Some(existing) = state.queue.iter_mut().find(|item| item.id == request.id) {
                *existing = request;
            } else {
                state.queue.push(request);
            }
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::ContinueRequest {
            request_id,
            timestamp_ms,
        } => {
            state.queue.retain(|request| request.id != request_id);
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::ContinueAll {
            request_ids,
            timestamp_ms,
        } => {
            state
                .queue
                .retain(|request| !request_ids.contains(&request.id));
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::DebuggerDetached {
            reason,
            timestamp_ms,
        } => {
            state.debugger_status = DebuggerStatus::Detached;
            state.detached_reason = Some(reason);
            state.queue.clear();
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::DebuggerError {
            message,
            timestamp_ms,
        } => {
            state.debugger_status = DebuggerStatus::Error;
            state.last_error = Some(message);
            state.updated_at_ms = timestamp_ms;
            state
        }
        SessionEvent::Reset { timestamp_ms } => SessionState {
            updated_at_ms: timestamp_ms,
            ..SessionState::default()
        },
        SessionEvent::Rehydrate { state } => state,
    }
}

fn dedupe_allowlist(origin_allowlist: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for origin in origin_allowlist
        .into_iter()
        .map(|origin| origin.trim().to_string())
        .filter(|origin| !origin.is_empty())
    {
        if !deduped.contains(&origin) {
            deduped.push(origin);
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        body::{DecodeBodyInput, decode_body},
        model::{HeaderDraft, RequestRecord},
    };
    use serde_json::json;

    fn request(id: &str) -> RequestRecord {
        RequestRecord {
            id: id.into(),
            network_id: None,
            origin: Some("https://api.example.com".into()),
            url: format!("https://api.example.com/{id}"),
            method: "POST".into(),
            resource_type: "Fetch".into(),
            headers: vec![HeaderDraft {
                name: "content-type".into(),
                value: "application/json".into(),
            }],
            header_text: "content-type: application/json".into(),
            body: decode_body(DecodeBodyInput {
                content_type: Some("application/json".into()),
                post_data: Some("{\"ok\":true}".into()),
            }),
            created_at_ms: 1,
        }
    }

    #[test]
    fn tracks_queue_transitions() {
        let armed = reduce_session_event(
            SessionState::default(),
            SessionEvent::BeginArmSession {
                tab_id: 7,
                tab_url: Some("https://example.com".into()),
                tab_title: Some("Example".into()),
                origin_allowlist: vec!["https://api.example.com".into()],
                timestamp_ms: 10,
            },
        );
        let attached = reduce_session_event(armed, SessionEvent::ArmSession { timestamp_ms: 11 });
        let with_one = reduce_session_event(
            attached,
            SessionEvent::QueueRequest {
                request: request("first"),
                timestamp_ms: 12,
            },
        );
        let with_two = reduce_session_event(
            with_one,
            SessionEvent::QueueRequest {
                request: request("second"),
                timestamp_ms: 13,
            },
        );
        let drained = reduce_session_event(
            with_two,
            SessionEvent::ContinueAll {
                request_ids: vec!["first".into(), "second".into()],
                timestamp_ms: 14,
            },
        );

        assert_eq!(drained.debugger_status, DebuggerStatus::Attached);
        assert!(drained.queue.is_empty());
    }

    #[test]
    fn accepts_camel_case_event_fields_from_extension() {
        let event: SessionEvent = serde_json::from_value(json!({
            "type": "beginArmSession",
            "tabId": 7,
            "tabUrl": "https://example.com",
            "tabTitle": "Example",
            "originAllowlist": ["https://example.com"],
            "timestampMs": 10
        }))
        .unwrap();

        assert_eq!(
            event,
            SessionEvent::BeginArmSession {
                tab_id: 7,
                tab_url: Some("https://example.com".into()),
                tab_title: Some("Example".into()),
                origin_allowlist: vec!["https://example.com".into()],
                timestamp_ms: 10,
            }
        );
    }

    #[test]
    fn records_detach_state() {
        let state = reduce_session_event(
            SessionState::default(),
            SessionEvent::DebuggerDetached {
                reason: "canceled_by_user".into(),
                timestamp_ms: 20,
            },
        );

        assert_eq!(state.debugger_status, DebuggerStatus::Detached);
        assert_eq!(state.detached_reason, Some("canceled_by_user".into()));
    }
}
