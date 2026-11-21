use crate::db::Db;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub paused: bool,
    pub retention_days: i64,
    pub anthropic_api_key: String,
    /// Key for the read-only mem0 view, stored locally like the Anthropic key.
    /// `None` when empty.
    pub mem0_api_key: Option<String>,
    pub explain_model: String,
    pub autostart: bool,
    /// Learning mode (W6-T6a, ownership moved to the DB in the W6
    /// follow-up). Consumers outside the renderer read it from here:
    /// `explain::explain` adds a "Học được gì" section to the prompt.
    pub learning: bool,
}

/// True while recording is paused. A malformed stored value reads as not
/// paused and logs a warning, so a bad row never silences the watcher.
pub fn is_paused(db: &Db) -> bool {
    match db.get_setting("paused") {
        Ok(Some(raw)) => serde_json::from_str::<bool>(&raw).unwrap_or_else(|e| {
            tracing::warn!("malformed paused setting {raw:?}: {e}");
            false
        }),
        _ => false,
    }
}

/// What a missing or unusable stored `retention_days` reads as.
const RETENTION_DEFAULT: i64 = 30;
/// The cleanup cutoff is a SQLite date string; 100 years is far past any use and well inside its year range.
const RETENTION_MAX: i64 = 36_500;

/// The days kept: the stored JSON integer in `1..=RETENTION_MAX`; a missing value is the default, an unusable
/// one (not an integer, below 1) reads as the default, and a larger one as the maximum.
fn retention_from_stored(raw: Option<&str>) -> i64 {
    let Some(raw) = raw else {
        return RETENTION_DEFAULT;
    };
    match serde_json::from_str::<i64>(raw) {
        Ok(days) if days > RETENTION_MAX => {
            tracing::warn!("retention_days {days} above {RETENTION_MAX}, using {RETENTION_MAX}");
            RETENTION_MAX
        }
        Ok(days) if days >= 1 => days,
        _ => {
            tracing::warn!("unusable retention_days {raw:?}, using {RETENTION_DEFAULT}");
            RETENTION_DEFAULT
        }
    }
}

/// Rows of removed settings (`mode`, `hybrid_rules`, `interactive_timeout_sec`)
/// stay in the table, because migration 001 seeds them on every open; they are
/// simply not read.
pub fn get_all(db: &Db) -> Result<Settings> {
    let paused = is_paused(db);
    let retention_days = retention_from_stored(db.get_setting("retention_days")?.as_deref());
    let anthropic_api_key = read(db, "anthropic_api_key")?.unwrap_or_default();
    let mem0_api_key = read(db, "mem0_api_key")?.filter(|k| !k.is_empty());
    let explain_model = read(db, "explain_model")?.unwrap_or_else(|| "claude-opus-5-5".into());
    let autostart: bool = serde_json::from_str(
        &db.get_setting("autostart")?
            .unwrap_or_else(|| "false".into()),
    )?;
    let learning: bool = serde_json::from_str(
        &db.get_setting("learning")?
            .unwrap_or_else(|| "false".into()),
    )?;
    Ok(Settings {
        paused,
        retention_days,
        anthropic_api_key,
        mem0_api_key,
        explain_model,
        autostart,
        learning,
    })
}

/// Persist learning mode and return the stored value.
///
/// The DB is the source of truth (superseding W6-T6a, where the renderer
/// owned it): `explain` and the CLI live outside the renderer and cannot
/// read its localStorage. The Zustand store keeps a copy only as a
/// warm-start cache and re-syncs from `get_all` on load.
pub fn set_learning(db: &Db, enabled: bool) -> Result<bool> {
    db.set_setting("learning", &serde_json::to_string(&enabled)?)?;
    Ok(enabled)
}

pub fn update(db: &Db, patch: Value) -> Result<Settings> {
    if let Value::Object(map) = patch {
        if let Some(days) = map.get("retention_days") {
            if !days
                .as_i64()
                .is_some_and(|d| (1..=RETENTION_MAX).contains(&d))
            {
                return Err(anyhow!("số ngày phải là số nguyên từ 1 đến 36500"));
            }
        }
        for (k, v) in map {
            db.set_setting(&k, &serde_json::to_string(&v)?)?;
        }
    }
    get_all(db)
}

/// Event name broadcast when learning mode flips (W6-T6a). Consumers are
/// outside the renderer that toggled it (other windows, future hook-side
/// agents), which is why the renderer itself does NOT subscribe — a
/// listener that wrote back into the store would loop.
pub const LEARNING_EVENT: &str = "learning-changed";

/// Payload for [`LEARNING_EVENT`]. `ts` is RFC3339 UTC, matching every
/// other timestamp crossing the IPC boundary (RFC3339 UTC, as elsewhere).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LearningChanged {
    pub enabled: bool,
    pub ts: String,
}

/// Build the event payload. Split from the Tauri command so it can be
/// tested without a runtime — the command itself is a one-line `emit`.
pub fn learning_payload(enabled: bool) -> LearningChanged {
    LearningChanged {
        enabled,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn toggle_pause(db: &Db) -> Result<bool> {
    let cur = db.get_setting("paused")?.unwrap_or_else(|| "false".into());
    let next = cur != "true";
    db.set_setting("paused", &serde_json::to_string(&next)?)?;
    Ok(next)
}

fn read(db: &Db, key: &str) -> Result<Option<String>> {
    let raw = db.get_setting(key)?;
    Ok(raw.and_then(|s| serde_json::from_str::<String>(&s).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TC-W6-T6a-3 (payload half): the emitted body carries the new state
    /// and a parseable RFC3339 timestamp. The `emit` itself needs a live
    /// Tauri runtime — same constraint as `hook.rs:45`.
    #[test]
    fn learning_toggle_payload() {
        let p = learning_payload(true);
        assert!(p.enabled);
        assert!(
            chrono::DateTime::parse_from_rfc3339(&p.ts).is_ok(),
            "ts must be RFC3339, got {}",
            p.ts
        );
        assert!(!learning_payload(false).enabled);
        assert_eq!(LEARNING_EVENT, "learning-changed");
    }

    #[test]
    fn rows_of_the_removed_gate_settings_do_not_break_get_all() {
        let fx = crate::test_support::test_state();
        fx.state.db.set_setting("mode", "\"interactive\"").unwrap();
        fx.state
            .db
            .set_setting("interactive_timeout_sec", "30")
            .unwrap();
        fx.state.db.set_setting("hybrid_rules", "not json").unwrap();
        let s = get_all(&fx.state.db).unwrap();
        assert!(!s.paused);
        assert_eq!(s.retention_days, 30);
        let v = serde_json::to_value(&s).unwrap();
        for k in ["mode", "interactive_timeout_sec", "hybrid_rules"] {
            assert!(v.get(k).is_none(), "{k} must not be in Settings");
        }
        assert!(v.get("mem0_api_key").is_some());
    }

    #[test]
    fn the_mem0_key_is_stored_and_an_empty_key_means_none() {
        let fx = crate::test_support::test_state();
        assert_eq!(get_all(&fx.state.db).unwrap().mem0_api_key, None);
        let s = update(
            &fx.state.db,
            serde_json::json!({ "mem0_api_key": "m0-abc" }),
        )
        .unwrap();
        assert_eq!(s.mem0_api_key.as_deref(), Some("m0-abc"));
        let s = update(&fx.state.db, serde_json::json!({ "mem0_api_key": "" })).unwrap();
        assert_eq!(s.mem0_api_key, None);
    }

    #[test]
    fn a_malformed_paused_value_reads_as_not_paused() {
        let fx = crate::test_support::test_state();
        fx.state.db.set_setting("paused", "maybe").unwrap();
        assert!(!is_paused(&fx.state.db));
        fx.state.db.set_setting("paused", "true").unwrap();
        assert!(is_paused(&fx.state.db));
        assert!(get_all(&fx.state.db).unwrap().paused);
    }

    #[test]
    fn update_refuses_a_retention_outside_whole_1_to_36500_and_keeps_the_stored_one() {
        let fx = crate::test_support::test_state();
        let bad = [
            serde_json::json!(0),
            serde_json::json!(-5),
            serde_json::json!(1.5),
            serde_json::json!("30"),
            serde_json::Value::Null,
            serde_json::json!(true),
            serde_json::json!(36501),
        ];
        for v in bad {
            let err = update(
                &fx.state.db,
                serde_json::json!({ "retention_days": v.clone() }),
            )
            .unwrap_err();
            assert!(err.to_string().contains("từ 1 đến 36500"), "{v}: {err}");
            assert_eq!(get_all(&fx.state.db).unwrap().retention_days, 30, "{v}");
        }
        assert_eq!(
            update(&fx.state.db, serde_json::json!({ "retention_days": 1 }))
                .unwrap()
                .retention_days,
            1
        );
        assert_eq!(
            update(&fx.state.db, serde_json::json!({ "retention_days": 36500 }))
                .unwrap()
                .retention_days,
            36500
        );
    }

    #[test]
    fn a_patch_with_a_bad_retention_writes_no_key() {
        let fx = crate::test_support::test_state();
        let before = get_all(&fx.state.db).unwrap().explain_model;
        assert!(update(
            &fx.state.db,
            serde_json::json!({ "explain_model": "x", "retention_days": 0 })
        )
        .is_err());
        assert_eq!(get_all(&fx.state.db).unwrap().explain_model, before);
    }

    #[test]
    fn a_bad_stored_retention_reads_as_30_and_a_huge_one_as_36500() {
        let fx = crate::test_support::test_state();
        for (raw, want) in [
            ("\"abc\"", 30),
            ("1.5", 30),
            ("0", 30),
            ("-3", 30),
            ("not json", 30),
            ("99999999", 36500),
            ("45", 45),
        ] {
            fx.state.db.set_setting("retention_days", raw).unwrap();
            assert_eq!(get_all(&fx.state.db).unwrap().retention_days, want, "{raw}");
        }
    }
}
