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

    let mut changes = Vec::new();
    if headers_changed {
        changes.push(match changed_headers.len() {
            0 => "Header order changed".into(),
            1 => "1 header changed".into(),
            count => format!("{count} headers changed"),
        });
    }
    if body_changed {
        changes.push(body_change_summary(
            &input.original_body.text,
            &input.edited_body.text,
        ));
    }
    let summary = if changes.is_empty() {
        "No changes".into()
    } else {
        changes.join(" · ")
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

fn body_change_summary(original: &str, edited: &str) -> String {
    let delta = edited.chars().count() as isize - original.chars().count() as isize;
    if delta == 0 {
        return "Body edited".into();
    }
    let unit = if delta.unsigned_abs() == 1 {
        "character"
    } else {
        "characters"
    };
    format!("Body edited ({delta:+} {unit})")
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
            capture_status: Default::default(),
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
        assert_eq!(diff.summary, "1 header changed · Body edited");
    }

    #[test]
    fn describes_body_edits_using_unicode_character_counts() {
        for (before, after, summary) in [
            ("a", "🟢", "Body edited"),
            ("é", "é🟢", "Body edited (+1 character)"),
            ("🟢東京", "🟢", "Body edited (-2 characters)"),
            ("same", "same", "No changes"),
        ] {
            let diff = compute_diff(ComputeDiffInput {
                original_headers: Vec::new(),
                edited_headers: Vec::new(),
                original_body: body(before),
                edited_body: body(after),
            });
            assert_eq!(diff.summary, summary);
        }
    }
}
