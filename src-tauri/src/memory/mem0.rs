//! Read-only mem0 client. Only GET /v1/entities/ and POST /v3/memories/ (a
//! read, filtered by entity) are called; nothing is created, changed or
//! deleted, and the key is only ever sent as the Authorization header.

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

pub const BASE_URL: &str = "https://api.mem0.ai";
pub const TIMEOUT: Duration = Duration::from_secs(15);
const PAGE_SIZE: u32 = 200;
const MAX_PAGES: u32 = 50;

/// Why mem0 is unavailable; one value per approved sentence.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum ReasonKind {
    #[serde(rename = "no_key")]
    NoKey,
    #[serde(rename = "connection")]
    Connection,
    #[serde(rename = "timeout")]
    Timeout,
    #[serde(rename = "auth_401_403")]
    Auth,
    #[serde(rename = "http_other")]
    HttpOther,
    #[serde(rename = "bad_reply")]
    BadReply,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mem0Error {
    pub kind: ReasonKind,
    pub status: Option<u16>,
}

impl Mem0Error {
    fn of(kind: ReasonKind) -> Self {
        Self { kind, status: None }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memory {
    pub id: String,
    pub entity_type: String,
    pub entity_name: String,
    pub text: String,
}

fn transport(e: reqwest::Error) -> Mem0Error {
    if e.is_timeout() {
        Mem0Error::of(ReasonKind::Timeout)
    } else if e.is_decode() {
        Mem0Error::of(ReasonKind::BadReply)
    } else {
        Mem0Error::of(ReasonKind::Connection)
    }
}

async fn read_json(resp: reqwest::Response) -> Result<Value, Mem0Error> {
    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let kind = if code == 401 || code == 403 {
            ReasonKind::Auth
        } else {
            ReasonKind::HttpOther
        };
        return Err(Mem0Error {
            kind,
            status: Some(code),
        });
    }
    let bytes = resp.bytes().await.map_err(transport)?;
    serde_json::from_slice(&bytes).map_err(|_| Mem0Error::of(ReasonKind::BadReply))
}

/// True when `url` parses and shares scheme, host and port with `base`.
fn same_origin(base: &str, url: &str) -> bool {
    let (Ok(b), Ok(u)) = (reqwest::Url::parse(base), reqwest::Url::parse(url)) else {
        return false;
    };
    b.scheme() == u.scheme()
        && b.host_str() == u.host_str()
        && b.port_or_known_default() == u.port_or_known_default()
        && u.username().is_empty()
        && u.password().is_none()
}

/// Every memory of every entity of the account, sequentially. A missing key
/// returns `NoKey` without sending a request.
pub async fn fetch(
    base_url: &str,
    key: Option<&str>,
    timeout: Duration,
) -> Result<Vec<Memory>, Mem0Error> {
    let key = match key {
        Some(k) if !k.trim().is_empty() => k.trim(),
        _ => return Err(Mem0Error::of(ReasonKind::NoKey)),
    };
    let base = base_url.trim_end_matches('/');
    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| Mem0Error::of(ReasonKind::Connection))?;
    let auth = format!("Token {key}");

    let mut entities: Vec<(String, String)> = Vec::new();
    let mut next = Some(format!("{base}/v1/entities/"));
    let mut pages = 0;
    while let Some(url) = next.take() {
        pages += 1;
        if pages > MAX_PAGES {
            break;
        }
        let resp = client
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(transport)?;
        let v = read_json(resp).await?;
        let results = v
            .get("results")
            .and_then(|r| r.as_array())
            .ok_or(Mem0Error::of(ReasonKind::BadReply))?;
        for r in results {
            if let (Some(t), Some(n)) = (
                r.get("type").and_then(|x| x.as_str()),
                r.get("name").and_then(|x| x.as_str()),
            ) {
                entities.push((t.to_string(), n.to_string()));
            }
        }
        // Follow `next` only to the same scheme, host and port as the base, so
        // the key never leaves it. A prefix test is not enough: a URL such as
        // `<base>@other-host/` starts with the base but points elsewhere.
        next = v
            .get("next")
            .and_then(|n| n.as_str())
            .filter(|n| same_origin(base, n))
            .map(String::from);
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (etype, ename) in &entities {
        let mut filters = serde_json::Map::new();
        filters.insert(format!("{etype}_id"), Value::String(ename.clone()));
        let body = json!({ "filters": filters });
        let mut page = 1;
        loop {
            let url = format!("{base}/v3/memories/?page={page}&page_size={PAGE_SIZE}");
            let resp = client
                .post(&url)
                .header("Authorization", &auth)
                .json(&body)
                .send()
                .await
                .map_err(transport)?;
            let v = read_json(resp).await?;
            let results = v
                .get("results")
                .and_then(|r| r.as_array())
                .ok_or(Mem0Error::of(ReasonKind::BadReply))?;
            for r in results {
                let Some(id) = r.get("id").and_then(|x| x.as_str()) else {
                    continue;
                };
                if !seen.insert(id.to_string()) {
                    continue;
                }
                out.push(Memory {
                    id: id.to_string(),
                    entity_type: etype.clone(),
                    entity_name: ename.clone(),
                    text: r
                        .get("memory")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                });
            }
            let more = v.get("next").is_some_and(|n| n.is_string());
            if !more || page >= MAX_PAGES {
                break;
            }
            page += 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    enum Reply {
        Json(u16, &'static str),
        Hang,
    }

    fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
        hay.windows(needle.len()).position(|w| w == needle)
    }

    fn read_request(s: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 1024];
        loop {
            let n = s.read(&mut tmp).unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = find(&buf, b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..pos]).to_lowercase();
                let len = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if buf.len() >= pos + 4 + len {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    /// Serve the replies in order, one connection each; `{BASE}` in a body is
    /// replaced by the server address. Returns the requests seen.
    fn serve(replies: Vec<Reply>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let b = base.clone();
        let h = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for reply in replies {
                let (mut s, _) = listener.accept().unwrap();
                seen.push(read_request(&mut s));
                match reply {
                    Reply::Json(code, body) => {
                        let body = body.replace("{BASE}", &b);
                        let _ = write!(
                            s,
                            "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                    }
                    Reply::Hang => std::thread::sleep(Duration::from_millis(1500)),
                }
            }
            seen
        });
        (base, h)
    }

    const ONE_ENTITY: &str = r#"{"results":[{"id":"e1","name":"u1","type":"user"}],"next":null}"#;

    #[tokio::test]
    async fn no_key_sends_no_request() {
        let r = fetch("http://127.0.0.1:1", None, Duration::from_millis(200)).await;
        assert_eq!(r, Err(Mem0Error::of(ReasonKind::NoKey)));
        let r = fetch("http://127.0.0.1:1", Some("  "), Duration::from_millis(200)).await;
        assert_eq!(r, Err(Mem0Error::of(ReasonKind::NoKey)));
    }

    #[tokio::test]
    async fn entities_then_memories_are_read_with_the_token_header() {
        let (base, h) = serve(vec![
            Reply::Json(200, ONE_ENTITY),
            Reply::Json(
                200,
                r#"{"results":[{"id":"m1","memory":"remember X","user_id":"u1"}],"next":null}"#,
            ),
        ]);
        let got = fetch(&base, Some("k-123"), Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(
            got,
            vec![Memory {
                id: "m1".into(),
                entity_type: "user".into(),
                entity_name: "u1".into(),
                text: "remember X".into()
            }]
        );
        let seen = h.join().unwrap();
        assert!(seen[0].starts_with("GET /v1/entities/ "));
        assert!(seen[0]
            .to_lowercase()
            .contains("authorization: token k-123"));
        assert!(seen[1].starts_with("POST /v3/memories/?page=1&page_size=200 "));
        assert!(seen[1].contains(r#"{"filters":{"user_id":"u1"}}"#));
    }

    #[tokio::test]
    async fn the_next_entity_page_is_followed_and_duplicate_memories_collapse() {
        let (base, h) = serve(vec![
            Reply::Json(
                200,
                r#"{"results":[{"id":"e1","name":"u1","type":"user"}],"next":"{BASE}/v1/entities/?page=2"}"#,
            ),
            Reply::Json(
                200,
                r#"{"results":[{"id":"e2","name":"a1","type":"agent"}],"next":null}"#,
            ),
            Reply::Json(200, r#"{"results":[{"id":"m1","memory":"A"}],"next":null}"#),
            Reply::Json(
                200,
                r#"{"results":[{"id":"m1","memory":"A"},{"id":"m2","memory":"B"}],"next":null}"#,
            ),
        ]);
        let got = fetch(&base, Some("k"), Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(
            got.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["m1", "m2"]
        );
        let seen = h.join().unwrap();
        assert!(seen[1].starts_with("GET /v1/entities/?page=2 "));
        assert!(seen[3].contains(r#"{"filters":{"agent_id":"a1"}}"#));
    }

    #[tokio::test]
    async fn a_next_url_on_another_host_is_not_followed_and_carries_no_key() {
        // `{BASE}@127.0.0.2:9/...` starts with the base but its host is 127.0.0.2.
        let (base, h) = serve(vec![
            Reply::Json(
                200,
                r#"{"results":[{"id":"e1","name":"u1","type":"user"}],"next":"{BASE}@127.0.0.2:9/v1/entities/?page=2"}"#,
            ),
            Reply::Json(200, r#"{"results":[{"id":"m1","memory":"A"}],"next":null}"#),
        ]);
        let got = fetch(&base, Some("k-secret"), Duration::from_secs(2))
            .await
            .unwrap();
        assert_eq!(got.len(), 1);
        let seen = h.join().unwrap();
        assert_eq!(
            seen.len(),
            2,
            "no third request: the foreign next is not followed"
        );
        assert!(seen[1].starts_with("POST /v3/memories/"));
        assert!(same_origin("http://a.test", "http://a.test/x"));
        assert!(!same_origin("http://a.test", "https://a.test/x"));
        assert!(!same_origin("http://a.test", "http://a.test:81/x"));
        assert!(!same_origin("http://a.test", "http://a.test.evil/x"));
    }

    #[tokio::test]
    async fn each_failure_has_its_own_reason_kind() {
        for (code, want) in [
            (401u16, ReasonKind::Auth),
            (403, ReasonKind::Auth),
            (500, ReasonKind::HttpOther),
            (404, ReasonKind::HttpOther),
        ] {
            let (base, h) = serve(vec![Reply::Json(code, "{}")]);
            let r = fetch(&base, Some("k"), Duration::from_secs(2)).await;
            assert_eq!(
                r,
                Err(Mem0Error {
                    kind: want,
                    status: Some(code)
                })
            );
            h.join().unwrap();
        }
        let (base, h) = serve(vec![Reply::Json(200, "not json at all")]);
        assert_eq!(
            fetch(&base, Some("k"), Duration::from_secs(2)).await,
            Err(Mem0Error::of(ReasonKind::BadReply))
        );
        h.join().unwrap();
    }

    #[tokio::test]
    async fn a_server_that_never_answers_times_out() {
        let (base, h) = serve(vec![Reply::Hang]);
        let r = fetch(&base, Some("k"), Duration::from_millis(300)).await;
        assert_eq!(r, Err(Mem0Error::of(ReasonKind::Timeout)));
        h.join().unwrap();
    }

    #[tokio::test]
    async fn a_refused_connection_is_a_connection_error() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let r = fetch(
            &format!("http://127.0.0.1:{port}"),
            Some("k"),
            Duration::from_secs(2),
        )
        .await;
        assert_eq!(r, Err(Mem0Error::of(ReasonKind::Connection)));
    }
}
