use crate::app::AppState;
use crate::settings;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::time::Duration;

/// A slower answer fails with the reqwest timeout error instead of hanging the command.
const EXPLAIN_TIMEOUT: Duration = Duration::from_secs(60);

fn http_client(timeout: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder().timeout(timeout).build()
}

pub async fn explain(state: &AppState, edit_id: &str) -> Result<String> {
    let edit = state.db.get_edit(edit_id)?;
    if let Some(md) = usable_cache(edit.explanation_md.clone()) {
        return Ok(md);
    }
    let s = settings::get_all(&state.db)?;
    if s.anthropic_api_key.is_empty() {
        return Err(anyhow!(
            "Anthropic API key chưa cấu hình. Vào Cài đặt nhập key."
        ));
    }
    let before = if let Some(sha) = &edit.before_blob_sha {
        state.blobs.read_string(sha).unwrap_or_default()
    } else {
        String::new()
    };
    let after = state.blobs.read_string(&edit.after_blob_sha)?;
    let prompt = format!(
        "{}\n\nFile: {}\n\nBefore:\n```\n{}\n```\n\nAfter:\n```\n{}\n```",
        instructions(s.learning),
        edit.path,
        truncate(&before, 6000),
        truncate(&after, 6000)
    );
    let body = build_body(&s.explain_model, &prompt);
    let client = http_client(EXPLAIN_TIMEOUT)?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &s.anthropic_api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Anthropic API {}: {}", status, txt));
    }
    let v: serde_json::Value = resp.json().await?;
    // `?` returns before save_explanation: an answer with no text is never cached.
    let text = extract_text(&v)?;
    state.db.save_explanation(edit_id, &text)?;
    Ok(text)
}

/// A stored explanation is served only when it is non-empty.
fn usable_cache(md: Option<String>) -> Option<String> {
    md.filter(|m| !m.is_empty())
}

/// Request body. `max_tokens` stays at 1024 (the cost ceiling the user
/// accepted); effort `low` keeps a thinking model from spending that budget
/// before it writes the text block.
fn build_body(model: &str, prompt: &str) -> Value {
    json!({
        "model": model,
        "max_tokens": 1024,
        "output_config": {"effort": "low"},
        "messages": [{"role": "user", "content": prompt}]
    })
}

/// The first content block of type `text` with non-empty text. A thinking
/// model returns a thinking block first, so `content[0]` is not the answer.
/// No such block (max_tokens spent on thinking, a refusal, an empty reply)
/// is an error naming `stop_reason`; the caller then saves nothing.
fn extract_text(v: &Value) -> Result<String> {
    let text = v
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|blocks| {
            blocks.iter().find_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) != Some("text") {
                    return None;
                }
                b.get("text")
                    .and_then(|t| t.as_str())
                    .filter(|t| !t.trim().is_empty())
            })
        });
    match text {
        Some(t) => Ok(t.to_string()),
        None => {
            let stop = v
                .get("stop_reason")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown");
            Err(anyhow!(
                "Anthropic trả về không có nội dung văn bản (stop_reason: {stop})"
            ))
        }
    }
}

/// Prompt header. Learning mode (see `settings::set_learning`) adds a
/// fifth section — the same "## Học được gì" contract the agent fleet
/// uses (global AGENTS.md §16.3), so the toggle changes something the
/// user can actually see rather than only remembering itself.
///
/// `max_tokens` stays at 1024: the extra section is capped at 3 bullets
/// precisely so the four core sections are not squeezed out.
fn instructions(learning: bool) -> String {
    let base = "Phân tích diff Claude Code vừa tạo. Trả lời TIẾNG VIỆT, ngắn gọn, 4 phần:\n\
         1. Thay đổi gì (what)\n\
         2. Lý do (why)\n\
         3. Tác động (impact)\n\
         4. Rủi ro / điểm cần review kỹ";
    if !learning {
        return base.to_string();
    }
    format!(
        "{base}\n\
         5. Học được gì — 1-3 gạch đầu dòng giải thích khái niệm / pattern / \
         API mới xuất hiện trong diff này, kèm link tài liệu chính chủ nếu có. \
         Người đọc là dev mid-level: đừng quá cơ bản, đừng hàn lâm."
    )
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.into();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n... [truncated]", &s[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Learning mode is only useful if it changes what the model is asked
    /// for. This is the consumer that makes the W6 toggle observable.
    #[test]
    fn learning_mode_adds_the_hoc_duoc_gi_section() {
        let off = instructions(false);
        assert!(off.contains("4. Rủi ro"));
        assert!(
            !off.contains("Học được gì"),
            "learning section must not leak into the default prompt"
        );

        let on = instructions(true);
        assert!(on.contains("4. Rủi ro"), "core sections must survive");
        assert!(on.contains("5. Học được gì"));
    }

    #[test]
    fn thinking_first_response_yields_the_text_block() {
        let v = json!({
            "content": [
                {"type": "thinking", "thinking": "hm"},
                {"type": "text", "text": "X"}
            ],
            "stop_reason": "end_turn"
        });
        assert_eq!(extract_text(&v).unwrap(), "X");
    }

    #[test]
    fn text_only_response_yields_the_text() {
        let v = json!({"content": [{"type": "text", "text": "only"}], "stop_reason": "end_turn"});
        assert_eq!(extract_text(&v).unwrap(), "only");
    }

    #[test]
    fn thinking_only_response_is_an_error_naming_the_stop_reason() {
        let v = json!({
            "content": [{"type": "thinking", "thinking": "still thinking"}],
            "stop_reason": "max_tokens"
        });
        let err = extract_text(&v).unwrap_err().to_string();
        assert_eq!(
            err,
            "Anthropic trả về không có nội dung văn bản (stop_reason: max_tokens)"
        );
    }

    #[test]
    fn refusal_without_content_is_an_error_and_a_missing_stop_reason_says_unknown() {
        let refusal = json!({"content": [], "stop_reason": "refusal"});
        assert!(extract_text(&refusal)
            .unwrap_err()
            .to_string()
            .contains("refusal"));
        let bare = json!({});
        assert!(extract_text(&bare)
            .unwrap_err()
            .to_string()
            .contains("unknown"));
    }

    #[test]
    fn an_empty_text_block_is_not_an_answer() {
        let v = json!({"content": [{"type": "text", "text": "  "}], "stop_reason": "end_turn"});
        assert!(extract_text(&v).is_err());
    }

    #[test]
    fn request_body_carries_model_max_tokens_and_low_effort() {
        let body = build_body("claude-opus-5-5", "PROMPT");
        assert_eq!(body["model"], "claude-opus-5-5");
        assert_eq!(body["max_tokens"], 1024);
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "PROMPT");
    }

    #[tokio::test]
    async fn a_server_that_never_answers_times_out() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            // accept and hold the socket, never write
            let _held = listener.accept().await;
            std::future::pending::<()>().await;
        });

        let client = http_client(std::time::Duration::from_millis(200)).unwrap();
        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            client.get(format!("http://{addr}/")).send(),
        )
        .await
        .expect("the request timeout must fire before the outer 5 seconds");

        assert!(outcome.unwrap_err().is_timeout());
    }

    #[test]
    fn truncate_never_splits_a_multibyte_character() {
        // byte 6000 falls inside "ệ" (3 bytes)
        let s = "a".repeat(5999) + "ệ" + "b";
        assert_eq!(truncate(&s, 6000), "a".repeat(5999) + "\n... [truncated]");
        assert_eq!(truncate("ệệ", 4), "ệ\n... [truncated]");
    }

    #[test]
    fn an_empty_stored_explanation_is_not_a_cache_hit() {
        assert_eq!(usable_cache(None), None);
        assert_eq!(usable_cache(Some(String::new())), None);
        assert_eq!(
            usable_cache(Some("done".to_string())),
            Some("done".to_string())
        );
    }
}
