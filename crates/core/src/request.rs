use crate::{
    body::{DecodeBodyInput, decode_body},
    model::{ContinueBuildInput, ContinueCommand, HeaderDraft, RequestRecord},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizeRequestInput {
    pub id: String,
    pub network_id: Option<String>,
    pub url: String,
    pub method: String,
    pub resource_type: String,
    pub headers: Vec<HeaderDraft>,
    pub post_data: Option<String>,
    pub timestamp_ms: i64,
}

pub fn normalize_request(input: NormalizeRequestInput) -> RequestRecord {
    let headers = normalize_headers(input.headers);
    let content_type = headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case("content-type"))
        .map(|header| header.value.clone());
    let header_text = headers
        .iter()
        .map(|header| format!("{}: {}", header.name, header.value))
        .collect::<Vec<_>>()
        .join("\n");

    RequestRecord {
        id: input.id,
        network_id: input.network_id,
        origin: derive_origin(&input.url),
        url: input.url,
        method: input.method.to_ascii_uppercase(),
        resource_type: input.resource_type,
        headers,
        header_text,
        body: decode_body(DecodeBodyInput {
            content_type,
            post_data: input.post_data,
        }),
        created_at_ms: input.timestamp_ms,
    }
}

pub fn build_continue_payload(input: ContinueBuildInput) -> Result<ContinueCommand, String> {
    let body = input.body;
    let mut headers = normalize_headers(input.headers);
    strip_unsafe_continue_headers(&mut headers);
    validate_headers(&headers)?;

    let post_data_base64 = if body.editable && !body.text.is_empty() {
        Some(base64::engine::general_purpose::STANDARD.encode(body.text.as_bytes()))
    } else {
        None
    };

    Ok(ContinueCommand {
        request_id: input.request_id,
        headers,
        post_data_base64,
    })
}

fn normalize_headers(headers: Vec<HeaderDraft>) -> Vec<HeaderDraft> {
    headers
        .into_iter()
        .map(|header| HeaderDraft {
            name: header.name.trim().to_string(),
            value: header.value.trim().to_string(),
        })
        .collect()
}

fn strip_unsafe_continue_headers(headers: &mut Vec<HeaderDraft>) {
    headers.retain(|header| !header.name.eq_ignore_ascii_case("content-length"));
}

fn validate_headers(headers: &[HeaderDraft]) -> Result<(), String> {
    for header in headers {
        if header.name.is_empty() {
            return Err("Header name cannot be empty.".into());
        }
        if !header
            .name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
        {
            return Err(format!(
                "Header `{}` contains invalid characters.",
                header.name
            ));
        }
        if header
            .value
            .bytes()
            .any(|byte| byte == 0x7f || (byte < 0x20 && byte != b'\t'))
        {
            return Err(format!(
                "Header `{}` contains invalid control characters in the value.",
                header.name
            ));
        }
    }
    Ok(())
}

fn derive_origin(url: &str) -> Option<String> {
    Url::parse(url).ok().map(|parsed| {
        let mut origin = format!(
            "{}://{}",
            parsed.scheme(),
            parsed.host_str().unwrap_or_default()
        );
        if let Some(port) = parsed.port() {
            origin.push(':');
            origin.push_str(&port.to_string());
        }
        origin
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EditableBody, EditableBodyKind, EditableBodyKind::Text};

    fn editable_body(text: &str) -> EditableBody {
        EditableBody {
            kind: Text,
            text: text.into(),
            editable: true,
            capture_status: Default::default(),
            encoding: Some("utf-8".into()),
            reason: None,
            content_type: Some("text/plain".into()),
        }
    }

    fn inspect_only_body(text: &str) -> EditableBody {
        EditableBody {
            kind: EditableBodyKind::Binary,
            text: text.into(),
            editable: false,
            capture_status: Default::default(),
            encoding: Some("utf-8".into()),
            reason: Some("Binary payloads are inspect-only in v1.".into()),
            content_type: Some("application/octet-stream".into()),
        }
    }

    #[test]
    fn normalizes_request_shape() {
        let request = normalize_request(NormalizeRequestInput {
            id: "fetch-1".into(),
            network_id: Some("network-1".into()),
            url: "https://api.example.com/v1/items".into(),
            method: "post".into(),
            resource_type: "Fetch".into(),
            headers: vec![
                HeaderDraft {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                HeaderDraft {
                    name: "x-test".into(),
                    value: " 1 ".into(),
                },
            ],
            post_data: Some("{\"hello\":\"world\"}".into()),
            timestamp_ms: 42,
        });

        assert_eq!(request.origin, Some("https://api.example.com".into()));
        assert_eq!(request.method, "POST");
        assert_eq!(request.body.kind, EditableBodyKind::Json);
        assert_eq!(
            request.header_text,
            "content-type: application/json\nx-test: 1"
        );
    }

    #[test]
    fn validates_header_names() {
        let error = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![HeaderDraft {
                name: "".into(),
                value: "value".into(),
            }],
            body: decode_body(DecodeBodyInput {
                content_type: None,
                post_data: Some("{}".into()),
            }),
        })
        .unwrap_err();

        assert!(error.contains("cannot be empty"));
    }

    #[test]
    fn rejects_invalid_header_tokens_and_control_characters() {
        for (name, value) in [
            ("bad name", "value"),
            ("x-test", "safe\nunsafe"),
            ("x-test", "nul\0byte"),
        ] {
            let result = build_continue_payload(ContinueBuildInput {
                request_id: "request-1".into(),
                headers: vec![HeaderDraft {
                    name: name.into(),
                    value: value.into(),
                }],
                body: editable_body("body"),
            });
            assert!(result.is_err(), "{name}: {value:?}");
        }
    }

    #[test]
    fn strips_content_length_for_edited_bodies() {
        let payload = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![
                HeaderDraft {
                    name: "content-type".into(),
                    value: "text/plain".into(),
                },
                HeaderDraft {
                    name: "Content-Length".into(),
                    value: "999".into(),
                },
            ],
            body: editable_body("hé"),
        })
        .unwrap();

        assert_eq!(
            payload.headers,
            vec![HeaderDraft {
                name: "content-type".into(),
                value: "text/plain".into(),
            }]
        );
        assert_eq!(payload.post_data_base64.as_deref(), Some("aMOp"));
    }

    #[test]
    fn leaves_non_empty_body_headers_without_inventing_content_length() {
        let payload = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![HeaderDraft {
                name: "content-type".into(),
                value: "text/plain".into(),
            }],
            body: editable_body("hello"),
        })
        .unwrap();

        assert_eq!(
            payload.headers,
            vec![HeaderDraft {
                name: "content-type".into(),
                value: "text/plain".into(),
            }]
        );
        assert_eq!(payload.post_data_base64.as_deref(), Some("aGVsbG8="));
    }

    #[test]
    fn preserves_empty_bodies_without_inventing_content_length() {
        let payload = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![HeaderDraft {
                name: "content-type".into(),
                value: "text/plain".into(),
            }],
            body: editable_body(""),
        })
        .unwrap();

        assert_eq!(
            payload.headers,
            vec![HeaderDraft {
                name: "content-type".into(),
                value: "text/plain".into(),
            }]
        );
        assert_eq!(payload.post_data_base64, None);
    }

    #[test]
    fn strips_existing_content_length_for_empty_bodies() {
        let payload = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![HeaderDraft {
                name: "content-length".into(),
                value: "15".into(),
            }],
            body: editable_body(""),
        })
        .unwrap();

        assert_eq!(payload.headers, Vec::<HeaderDraft>::new());
        assert_eq!(payload.post_data_base64, None);
    }

    #[test]
    fn leaves_inspect_only_bodies_unchanged() {
        let payload = build_continue_payload(ContinueBuildInput {
            request_id: "request-1".into(),
            headers: vec![HeaderDraft {
                name: "content-length".into(),
                value: "13".into(),
            }],
            body: inspect_only_body("raw-binary-ish"),
        })
        .unwrap();

        assert_eq!(payload.headers, Vec::<HeaderDraft>::new());
        assert_eq!(payload.post_data_base64, None);
    }
}
