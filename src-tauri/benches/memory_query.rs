//! Benchmark `memory_query` latency at three event-store sizes.
//!
//! Spawns a real `ctxd` daemon with `--db <tempfile> --embedder null`,
//! pre-loads N synthetic events under `/keepr/topics/*`, then times
//! `client.query(subject, QueryView::Fts)` on a small set of queries.
//!
//! The kill-criteria threshold (see `tasks/ctxd-integration.md`) is
//! p95 < 600ms at 50k events. We bench 1k / 10k / 50k to surface the
//! growth shape; 50k takes minutes to ingest, so it's behind a
//! `KEEPR_BENCH_50K=1` env gate.
//!
//! Run:
//!   cargo bench --bench memory_query           # 1k + 10k
//!   KEEPR_BENCH_50K=1 cargo bench --bench memory_query  # all three
//!
//! Output: criterion writes HTML/CSV to `target/criterion/`. We also
//! emit a flat CSV to `bench-results/memory_query-{date}.csv` for the
//! kill-criteria tracking spreadsheet.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use ctxd_client::{CtxdClient, QueryView};
use tokio::runtime::Runtime;

struct DaemonGuard {
    child: Child,
    _tmp: tempfile::TempDir,
    http_addr: String,
    wire_addr: String,
}

impl Drop for DaemonGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn ctxd_binary() -> PathBuf {
    // Same path the Tauri externalBin resolves to during dev — the
    // fetch-ctxd.ts script puts it here.
    let exe_target = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "ctxd-aarch64-apple-darwin"
        } else {
            "ctxd-x86_64-apple-darwin"
        }
    } else if cfg!(target_arch = "aarch64") {
        "ctxd-aarch64-unknown-linux-gnu"
    } else {
        "ctxd-x86_64-unknown-linux-gnu"
    };
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest.join("binaries").join(exe_target)
}

fn spawn_daemon() -> DaemonGuard {
    let tmp = tempfile::tempdir().expect("tempdir");
    let db_path = tmp.path().join("ctxd.db");
    let http_port = portpicker::pick_unused_port().expect("http port");
    let wire_port = portpicker::pick_unused_port().expect("wire port");
    let http_addr = format!("127.0.0.1:{http_port}");
    let wire_addr = format!("127.0.0.1:{wire_port}");

    let bin = ctxd_binary();
    if !bin.exists() {
        panic!(
            "ctxd binary not found at {:?}. Run `npm run fetch-ctxd` first.",
            bin
        );
    }

    let child = Command::new(&bin)
        .arg("serve")
        .args(["--bind", &http_addr])
        .args(["--wire-bind", &wire_addr])
        .arg("--db")
        .arg(db_path.as_os_str())
        .args(["--embedder", "null"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .expect("spawn ctxd");

    // Probe /health until ready. 10s timeout — ctxd boots in ~50-150ms
    // but rebuilding the HNSW index on a freshly-created store can
    // take an extra second.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect(&http_addr).is_ok() {
            // Belt-and-suspenders: wait one more poll for HTTP to attach.
            std::thread::sleep(Duration::from_millis(50));
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    DaemonGuard {
        child,
        _tmp: tmp,
        http_addr,
        wire_addr,
    }
}

async fn make_client(guard: &DaemonGuard) -> CtxdClient {
    CtxdClient::connect(&format!("http://{}", guard.http_addr))
        .await
        .expect("ctxd connect")
        .with_wire(&guard.wire_addr)
        .await
        .expect("ctxd wire")
}

async fn preload(client: &CtxdClient, n: usize) {
    for i in 0..n {
        let subject = format!("/keepr/topics/topic-{}", i % 200);
        let _ = client
            .write(
                &subject,
                "topic.note",
                serde_json::json!({
                    "schema_version": 1,
                    "name": format!("Topic {}", i),
                    "bullets": [format!("synthetic event #{i}")]
                }),
            )
            .await;
    }
}

fn bench_at_size(c: &mut Criterion, n: usize) {
    let rt = Runtime::new().expect("rt");
    let guard = spawn_daemon();
    let client = rt.block_on(make_client(&guard));
    rt.block_on(preload(&client, n));

    let mut group = c.benchmark_group("memory_query");
    group.sample_size(20);

    group.bench_with_input(BenchmarkId::new("fts_root", n), &n, |b, _| {
        b.to_async(&rt)
            .iter(|| async { client.query("/keepr", QueryView::Fts).await.unwrap() });
    });

    group.bench_with_input(BenchmarkId::new("log_topics", n), &n, |b, _| {
        b.to_async(&rt).iter(|| async {
            client
                .query("/keepr/topics", QueryView::Log)
                .await
                .unwrap()
        });
    });

    group.finish();
    drop(client);
    drop(guard);
}

fn bench_memory_query(c: &mut Criterion) {
    bench_at_size(c, 1_000);
    bench_at_size(c, 10_000);
    if std::env::var("KEEPR_BENCH_50K").is_ok() {
        bench_at_size(c, 50_000);
    }
}

criterion_group!(benches, bench_memory_query);
criterion_main!(benches);
