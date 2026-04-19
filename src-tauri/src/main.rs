// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // If the first real argument is "cli", dispatch to the CLI handler
    // instead of launching the full Tauri GUI runtime.
    if args.len() >= 2 && args[1] == "cli" {
        match cli::run(&args[1..]) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    // No CLI subcommand — launch the GUI as normal.
    keepr_lib::run()
}
