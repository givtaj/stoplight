use crate::model::{EditableBody, HeaderDraft};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComputeDiffInput {
    pub original_headers: Vec<HeaderDraft>,
    pub edited_headers: Vec<HeaderDraft>,
    pub original_body: EditableBody,
    pub edited_body: EditableBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestDiff {
    pub has_changes: bool,
    pub headers_changed: bool,
    pub body_changed: bool,
    pub changed_headers: Vec<String>,
    pub summary: String,
}

pub fn compute_diff(input: ComputeDiffInput) -> RequestDiff {
    let original_headers = normalize_headers(&input.original_headers);
    let edited_headers = normalize_headers(&input.edited_headers);
    let headers_changed = original_headers != edited_headers;
    let body_changed = input.original_body.text != input.edited_body.text;

    let changed_headers = if headers_changed {
        let original_names = original_headers.iter().map(|header| header.name.clone());
        let edited_names = edited_headers.iter().map(|header| header.name.clone());
        let names = original_names.chain(edited_names).collect::<BTreeSet<_>>();
        names
            .into_iter()
            .filter(|name| {
                let original_values: Vec<_> = original_headers
                    .iter()
                    .filter(|header| &header.name == name)
                    .map(|header| header.value.clone())
                    .collect();
                let edited_values: Vec<_> = edited_headers
                    .iter()
                    .filter(|header| &header.name == name)
                    .map(|header| header.value.clone())
                    .collect();
                original_values != edited_values
            })
            .collect()
    } else {
        Vec::new()
    };

    let summary = if headers_changed && body_changed {
        format!(
            "{} header changes, body {} chars",
            changed_headers.len(),
            body_delta(input.original_body.text.len(), input.edited_body.text.len())
        )
    } else if headers_changed {
        format!("{} header changes", changed_headers.len())
    } else if body_changed {
        format!(
            "body {} chars",
            body_delta(input.original_body.text.len(), input.edited_body.text.len())
        )
    } else {
        "No changes".into()
    };

    RequestDiff {
        has_changes: headers_changed || body_changed,
        headers_changed,
        body_changed,
        changed_headers,
        summary,
    }
}

fn normalize_headers(headers: &[HeaderDraft]) -> Vec<HeaderDraft> {
    headers
        .iter()
        .map(|header| HeaderDraft {
            name: header.name.trim().to_ascii_lowercase(),
            value: header.value.trim().to_string(),
        })
        .collect()
}

fn body_delta(original: usize, edited: usize) -> String {
    match edited.cmp(&original) {
        std::cmp::Ordering::Greater => format!("+{}", edited - original),
        std::cmp::Ordering::Less => format!("-{}", original - edited),
        std::cmp::Ordering::Equal => "0".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{EditableBody, EditableBodyKind};

    fn body(text: &str) -> EditableBody {
        EditableBody {
            kind: EditableBodyKind::Json,
            text: text.into(),
            editable: true,
            encoding: Some("utf-8".into()),
            reason: None,
            content_type: Some("application/json".into()),
        }
    }

    #[test]
    fn reports_body_and_header_changes() {
        let diff = compute_diff(ComputeDiffInput {
            original_headers: vec![HeaderDraft {
                name: "Content-Type".into(),
                value: "application/json".into(),
            }],
            edited_headers: vec![
                HeaderDraft {
                    name: "Content-Type".into(),
                    value: "application/json".into(),
                },
                HeaderDraft {
                    name: "X-Debug".into(),
                    value: "1".into(),
                },
            ],
            original_body: body("{\"a\":1}"),
            edited_body: body("{\"a\":2}"),
        });

        assert!(diff.has_changes);
        assert!(diff.headers_changed);
        assert!(diff.body_changed);
        assert_eq!(diff.changed_headers, vec!["x-debug".to_string()]);
    }
}
