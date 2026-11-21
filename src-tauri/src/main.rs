#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod cleanup;
mod cli_guard;
mod db;
mod explain;
mod hook;
mod maintenance;
mod memory;
mod plans;
mod rollback;
mod sessions;
mod settings;
mod specs;
mod store;
mod watcher;

#[cfg(test)]
mod test_support;

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("hook") => {
            let _ = cli_guard::hook_noop(std::io::stdin());
            std::process::exit(0)
        }
        Some("uninstall") => std::process::exit(cli_guard::uninstall()),
        _ => app::run(),
    }
}
