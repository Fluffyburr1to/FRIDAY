//! FRIDAY.app — the shell.
//!
//! ★ **This is a window. It is not FRIDAY.**
//!
//! The core runs as a separate process under `launchd`, started at login and
//! restarted if it dies. Closing this window, quitting this app, or crashing
//! it must leave that process alone — Article III requires an approval to
//! survive waiting days, and a window that took the core down with it would
//! silently decline every approval waiting in it.
//!
//! ★★ **It is also deliberately unprivileged.**
//! [ADR-0052](../../../../docs/adr/0052-a-native-shell-is-not-evidence-of-a-human.md)
//! §10: this shell has exactly the authority the browser has, and that is
//! structural rather than promised — it loads the same bytes from the same
//! origin the browser does, because `apps/core` serves the dashboard itself.
//!
//! There is no Rust here that talks to the API, no command exposed to the
//! webview, and nothing that could manufacture `authenticatedAt`. A native
//! shell is not evidence of a human, and until core can cryptographically
//! verify this process, the page it loads reports itself as `web` exactly as
//! the browser does.
//!
//! What this file must NOT grow without ADR-0052 §4 and §5 landing first:
//! an IPC command that asserts the owner is present.

/// Starts the shell.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("FRIDAY.app could not start its window");
}
