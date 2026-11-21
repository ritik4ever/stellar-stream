use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=src/");

    // Only run wasm-opt for release builds
    let profile = env::var("PROFILE").unwrap_or_default();
    if profile != "release" {
        println!("cargo:warning=Skipping wasm-opt for non-release build");
        return;
    }

    // Check if wasm-opt is available
    let wasm_opt_available = Command::new("wasm-opt").arg("--version").output().is_ok();

    if !wasm_opt_available {
        println!("cargo:warning=wasm-opt not found in PATH. Install via: npm install -g wasm-opt or brew install binaryen");
        return;
    }

    // Get the target directory
    let target_dir = PathBuf::from(env::var("TARGET_DIR").unwrap_or_else(|_| "target".to_string()));
    let wasm_file = target_dir.join("wasm32-unknown-unknown/release/stellar_stream.wasm");

    if !wasm_file.exists() {
        println!("cargo:warning=WASM file not found at {:?}", wasm_file);
        return;
    }

    let original_size = std::fs::metadata(&wasm_file).map(|m| m.len()).unwrap_or(0);

    // Run wasm-opt with -O4 optimization level
    println!("cargo:warning=Running wasm-opt -O4 on WASM binary...");
    let output = Command::new("wasm-opt")
        .arg("-O4")
        .arg(&wasm_file)
        .arg("-o")
        .arg(&wasm_file)
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                println!("cargo:warning=wasm-opt failed: {}", stderr);
                return;
            }

            let optimized_size = std::fs::metadata(&wasm_file).map(|m| m.len()).unwrap_or(0);

            let reduction_percent = if original_size > 0 {
                ((original_size - optimized_size) as f64 / original_size as f64) * 100.0
            } else {
                0.0
            };

            println!(
                "cargo:warning=WASM optimization complete: {:.2}KB → {:.2}KB ({:.1}% reduction)",
                original_size as f64 / 1024.0,
                optimized_size as f64 / 1024.0,
                reduction_percent
            );
        }
        Err(e) => {
            println!("cargo:warning=Failed to run wasm-opt: {}", e);
        }
    }
}
