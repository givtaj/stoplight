use crate::model::{EditableBody, EditableBodyKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DecodeBodyInput {
    pub content_type: Option<String>,
    pub post_data: Option<String>,
}

pub fn decode_body(input: DecodeBodyInput) -> EditableBody {
    let content_type = input
        .content_type
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_content_type = content_type
        .as_deref()
        .map(normalize_content_type)
        .unwrap_or_default();
    let text = input.post_data.unwrap_or_default();

    if text.is_empty() {
        return EditableBody {
            kind: EditableBodyKind::Empty,
            text,
            editable: true,
            encoding: Some("utf-8".to_string()),
            reason: None,
            content_type,
        };
    }

    let kind = classify_kind(&normalized_content_type, &text);
    let editable = !matches!(kind, EditableBodyKind::Multipart | EditableBodyKind::Binary);
    let reason = match kind {
        EditableBodyKind::Multipart => Some("Multipart payloads are inspect-only in v1.".into()),
        EditableBodyKind::Binary => Some("Binary payloads are inspect-only in v1.".into()),
        _ => None,
    };

    EditableBody {
        kind,
        text,
        editable,
        encoding: Some("utf-8".to_string()),
        reason,
        content_type,
    }
}

fn normalize_content_type(value: &str) -> String {
    value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn classify_kind(content_type: &str, text: &str) -> EditableBodyKind {
    if content_type.starts_with("multipart/") {
        return EditableBodyKind::Multipart;
    }
    if content_type == "application/octet-stream" {
        return EditableBodyKind::Binary;
    }
    if content_type == "application/json"
        || content_type.ends_with("+json")
        || looks_like_json(text)
    {
        return EditableBodyKind::Json;
    }
    if content_type == "application/x-www-form-urlencoded" || looks_like_form_data(text) {
        return EditableBodyKind::FormUrlEncoded;
    }
    if content_type == "application/xml"
        || content_type == "text/xml"
        || content_type.ends_with("+xml")
        || looks_like_xml(text)
    {
        return EditableBodyKind::Xml;
    }
    if content_type.starts_with("text/") || content_type.is_empty() {
        return EditableBodyKind::Text;
    }
    EditableBodyKind::Unknown
}

fn looks_like_json(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

fn looks_like_xml(text: &str) -> bool {
    text.trim_start().starts_with('<')
}

fn looks_like_form_data(text: &str) -> bool {
    text.contains('=') && (text.contains('&') || !text.contains(['{', '[', '<']))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_json_payloads() {
        let body = decode_body(DecodeBodyInput {
            content_type: Some("application/json; charset=utf-8".into()),
            post_data: Some("{\"hello\":\"world\"}".into()),
        });

        assert_eq!(body.kind, EditableBodyKind::Json);
        assert!(body.editable);
    }

    #[test]
    fn marks_multipart_payloads_as_non_editable() {
        let body = decode_body(DecodeBodyInput {
            content_type: Some("multipart/form-data; boundary=test".into()),
            post_data: Some("--test".into()),
        });

        assert_eq!(body.kind, EditableBodyKind::Multipart);
        assert!(!body.editable);
    }

    #[test]
    fn marks_binary_payloads_as_non_editable() {
        let body = decode_body(DecodeBodyInput {
            content_type: Some("application/octet-stream".into()),
            post_data: Some("raw-binary-ish".into()),
        });

        assert_eq!(body.kind, EditableBodyKind::Binary);
        assert!(!body.editable);
    }
}
