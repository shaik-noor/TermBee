//! Live end-to-end check of the SSH core against a real server. Skipped unless configured:
//!
//!   TERMBEE_TEST_HOST=127.0.0.1 TERMBEE_TEST_PORT=2222 \
//!   TERMBEE_TEST_USER=bee TERMBEE_TEST_PASSWORD=secret \
//!   cargo test --test ssh_live -- --nocapture
//!
//! (e.g. `docker run -d -p 2222:2222 -e PASSWORD_ACCESS=true -e USER_NAME=bee \
//!        -e USER_PASSWORD=secret lscr.io/linuxserver/openssh-server`)

use std::sync::{Arc, Mutex};
use std::time::Duration;
use termbee_lib::testing::{run_session, ConnectRequest, SessionMode, SessionTestRig};

#[tokio::test(flavor = "multi_thread")]
async fn connects_runs_a_command_and_closes() {
    let Ok(host) = std::env::var("TERMBEE_TEST_HOST") else {
        eprintln!("skipped: set TERMBEE_TEST_HOST (+ PORT, USER, PASSWORD) to run");
        return;
    };
    let port: u16 = std::env::var("TERMBEE_TEST_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(22);
    let user = std::env::var("TERMBEE_TEST_USER").expect("TERMBEE_TEST_USER");
    let password = std::env::var("TERMBEE_TEST_PASSWORD").expect("TERMBEE_TEST_PASSWORD");

    let dir = std::env::temp_dir().join(format!("termbee-test-{}", std::process::id()));
    let output = Arc::new(Mutex::new(String::new()));
    let rig = SessionTestRig::new(&dir, output.clone()).expect("rig");

    let request = ConnectRequest {
        mode: SessionMode::Shell,
        host_id: None,
        hostname: host,
        port,
        username: user,
        auth: termbee_lib::testing::AuthMethod::Password,
        password: Some(password),
        passphrase: None,
        remember: false,
        cols: 100,
        rows: 30,
    };
    let session = tokio::spawn(run_session(rig.context(request)));

    // Wait for the shell, then run a command and look for its output.
    assert!(
        rig.wait_for(
            |events| events.iter().any(|e| e.contains("\"phase\":\"connected\"")),
            Duration::from_secs(20),
        )
        .await,
        "never connected"
    );
    rig.write("echo termbee-$((6*7))\n");
    let seen = rig
        .wait_until(
            || output.lock().unwrap().contains("termbee-42"),
            Duration::from_secs(10),
        )
        .await;
    rig.close();
    let _ = tokio::time::timeout(Duration::from_secs(10), session).await;
    let _ = std::fs::remove_dir_all(&dir);

    assert!(
        seen,
        "command output never arrived; got:\n{}",
        output.lock().unwrap()
    );
    assert!(
        rig.events()
            .iter()
            .any(|e| e.contains("\"type\":\"closed\"")),
        "no closed event"
    );
}

/// Always runs: a closed local port must produce a friendly error and a `closed` event.
#[tokio::test(flavor = "multi_thread")]
async fn refused_port_reports_a_friendly_error() {
    let dir = std::env::temp_dir().join(format!("termbee-refused-{}", std::process::id()));
    let rig = SessionTestRig::new(&dir, Arc::new(Mutex::new(String::new()))).expect("rig");
    let request = ConnectRequest {
        mode: SessionMode::Shell,
        host_id: None,
        hostname: "127.0.0.1".into(),
        port: 1,
        username: "nobody".into(),
        auth: termbee_lib::testing::AuthMethod::Password,
        password: Some("x".into()),
        passphrase: None,
        remember: false,
        cols: 80,
        rows: 24,
    };
    tokio::time::timeout(Duration::from_secs(20), run_session(rig.context(request)))
        .await
        .expect("session hung");
    let _ = std::fs::remove_dir_all(&dir);
    let events = rig.events().join("\n");
    assert!(
        events.contains("\"type\":\"error\""),
        "no error event:\n{events}"
    );
    assert!(
        events.contains("refused the connection") || events.contains("didn't answer"),
        "unfriendly error:\n{events}"
    );
    assert!(
        events.contains("\"type\":\"closed\""),
        "no closed event:\n{events}"
    );
}
