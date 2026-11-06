use crate::model::{BodyCaptureStatus, EditableBody, EditableBodyKind};
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
    let capture_status = if input.post_data.is_some() {
        BodyCaptureStatus::Complete
    } else {
        BodyCaptureStatus::Unavailable
    };
    let text = input.post_data.unwrap_or_default();

    let kind = classify_kind(&normalized_content_type, &text);
    // CDP can omit a multipart or binary body. Its absence must not make an
    // inspect-only request editable or permit replacing its original bytes.
    let kind = if text.is_empty()
        && !matches!(kind, EditableBodyKind::Multipart | EditableBodyKind::Binary)
    {
        EditableBodyKind::Empty
    } else {
        kind
    };
    let editable = capture_status == BodyCaptureStatus::Complete
        && !matches!(kind, EditableBodyKind::Multipart | EditableBodyKind::Binary);
    let reason = match kind {
        EditableBodyKind::Multipart => Some("Multipart payloads are inspect-only in v1.".into()),
        EditableBodyKind::Binary => Some("Binary payloads are inspect-only in v1.".into()),
        _ if capture_status == BodyCaptureStatus::Unavailable => {
            Some("Body capture is unavailable. This request can only continue unchanged.".into())
        }
        _ => None,
    };

    EditableBody {
        kind,
        text,
        editable,
        capture_status,
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
    // An explicit media type is authoritative. Content sniffing must not turn
    // a PDF, image, or unknown vendor payload into an editable textual body.
    if !content_type.is_empty() {
        if content_type.starts_with("multipart/") {
            return EditableBodyKind::Multipart;
        }
        if content_type == "application/json" || content_type.ends_with("+json") {
            return EditableBodyKind::Json;
        }
        if content_type == "application/x-www-form-urlencoded" {
            return EditableBodyKind::FormUrlEncoded;
        }
        if content_type == "application/xml"
            || content_type == "text/xml"
            || content_type.ends_with("+xml")
        {
            return EditableBodyKind::Xml;
        }
        if content_type.starts_with("text/") || content_type == "application/javascript" {
            return EditableBodyKind::Text;
        }
        return EditableBodyKind::Binary;
    }

    if looks_like_json(text) {
        return EditableBodyKind::Json;
    }
    if looks_like_form_data(text) {
        return EditableBodyKind::FormUrlEncoded;
    }
    if looks_like_xml(text) {
        return EditableBodyKind::Xml;
    }
    EditableBodyKind::Text
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

    #[test]
    fn keeps_missing_or_empty_multipart_payloads_inspect_only() {
        for post_data in [None, Some(String::new())] {
            let body = decode_body(DecodeBodyInput {
                content_type: Some("Multipart/Form-Data; boundary=test".into()),
                post_data,
            });

            assert_eq!(body.kind, EditableBodyKind::Multipart);
            assert!(!body.editable);
            assert_eq!(
                body.reason.as_deref(),
                Some("Multipart payloads are inspect-only in v1.")
            );
        }
    }

    #[test]
    fn keeps_missing_or_empty_binary_payloads_inspect_only() {
        for post_data in [None, Some(String::new())] {
            let body = decode_body(DecodeBodyInput {
                content_type: Some("Application/Octet-Stream".into()),
                post_data,
            });

            assert_eq!(body.kind, EditableBodyKind::Binary);
            assert!(!body.editable);
            assert_eq!(
                body.reason.as_deref(),
                Some("Binary payloads are inspect-only in v1.")
            );
        }
    }

    #[test]
    fn keeps_empty_textual_requests_editable() {
        for content_type in [
            None,
            Some("application/json".into()),
            Some("text/plain".into()),
        ] {
            let body = decode_body(DecodeBodyInput {
                content_type,
                post_data: Some(String::new()),
            });

            assert_eq!(body.kind, EditableBodyKind::Empty);
            assert!(body.editable);
            assert_eq!(body.reason, None);
        }
    }

    #[test]
    fn does_not_confuse_unavailable_textual_capture_with_an_empty_body() {
        let body = decode_body(DecodeBodyInput {
            content_type: Some("application/json".into()),
            post_data: None,
        });
        assert_eq!(body.capture_status, BodyCaptureStatus::Unavailable);
        assert!(!body.editable);
        assert!(body.reason.unwrap().contains("unavailable"));
    }

    #[test]
    fn explicit_binary_media_types_remain_inspect_only_regardless_of_visible_body() {
        for content_type in [
            "Image/PNG; version=1",
            "application/pdf",
            "application/vnd.stoplight.raw",
        ] {
            for post_data in [
                None,
                Some(""),
                Some("raw bytes"),
                Some("{\"looks\":\"json\"}"),
                Some("<looks-like-xml/>"),
                Some("looks=like&form=data"),
            ] {
                let body = decode_body(DecodeBodyInput {
                    content_type: Some(content_type.into()),
                    post_data: post_data.map(String::from),
                });

                assert_eq!(
                    body.kind,
                    EditableBodyKind::Binary,
                    "{content_type}: {post_data:?}"
                );
                assert!(!body.editable, "{content_type}: {post_data:?}");
                assert_eq!(
                    body.reason.as_deref(),
                    Some("Binary payloads are inspect-only in v1.")
                );
            }
        }
    }

    #[test]
    fn explicit_textual_media_types_take_precedence_over_content_sniffing() {
        for (content_type, text, kind) in [
            ("text/plain", "{\"looks\":\"json\"}", EditableBodyKind::Text),
            ("application/javascript", "[1, 2]", EditableBodyKind::Text),
            ("application/json", "a=b", EditableBodyKind::Json),
            ("application/problem+json", "a=b", EditableBodyKind::Json),
            (
                "application/xml",
                "{\"looks\":\"json\"}",
                EditableBodyKind::Xml,
            ),
            ("text/xml", "a=b", EditableBodyKind::Xml),
            ("image/svg+xml", "a=b", EditableBodyKind::Xml),
            (
                "application/x-www-form-urlencoded",
                "{\"looks\":\"json\"}",
                EditableBodyKind::FormUrlEncoded,
            ),
        ] {
            let body = decode_body(DecodeBodyInput {
                content_type: Some(content_type.into()),
                post_data: Some(text.into()),
            });

            assert_eq!(body.kind, kind, "{content_type}");
            assert!(body.editable, "{content_type}");
        }
    }

    #[test]
    fn infers_textual_kind_only_when_media_type_is_absent() {
        for (text, kind) in [
            ("{\"value\":1}", EditableBodyKind::Json),
            ("alpha=bravo", EditableBodyKind::FormUrlEncoded),
            ("<value/>", EditableBodyKind::Xml),
            ("plain text", EditableBodyKind::Text),
        ] {
            let body = decode_body(DecodeBodyInput {
                content_type: None,
                post_data: Some(text.into()),
            });

            assert_eq!(body.kind, kind);
            assert!(body.editable);
        }
    }
}
