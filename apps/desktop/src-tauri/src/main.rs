// Prevents a console window appearing alongside the app on Windows release
// builds. Harmless on macOS, and kept so the target stays buildable.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    friday_desktop_lib::run()
}
