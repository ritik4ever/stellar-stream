#![cfg(feature = "integration")]

use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn run_sh(dir: &str, cmd: &str) -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("sh")
        .arg("-c")
        .current_dir(dir)
        .arg(cmd)
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "command failed: {}\nstdout: {}\nstderr: {}",
            cmd,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[test]
fn integration_full_flow() -> Result<(), Box<dyn std::error::Error>> {
    // Require a funded testnet secret via env. If missing, skip the test.
    let secret = match env::var("TESTNET_SECRET") {
        Ok(s) => s,
        Err(_) => {
            eprintln!("TESTNET_SECRET not set; skipping integration test");
            return Ok(());
        }
    };

    // contracts crate directory at runtime
    let contracts_dir = env!("CARGO_MANIFEST_DIR");

    // Deploy contract using the existing script. The script writes contracts/contract_id.txt
    println!("Deploying contract to testnet using provided secret (this may take a minute)...");
    let deploy_cmd = format!("SECRET_KEY='{}' ../scripts/deploy.sh", secret);
    let deploy_out = run_sh(contracts_dir, &deploy_cmd)?;
    println!("deploy output:\n{}", deploy_out);

    // Read contract id
    let contract_id_path = Path::new(contracts_dir).join("contract_id.txt");
    let contract_id = fs::read_to_string(&contract_id_path)?.trim().to_string();
    println!("Contract ID: {}", contract_id);

    // Create a simple stream via soroban CLI (use the secret as source-account)
    // Build start/end times
    let start_time = chrono::Utc::now().timestamp() + 60;
    let end_time = start_time + 3600;

    let create_cmd = format!("soroban contract invoke --id {id} --source-account '{secret}' --network testnet -- create_stream --sender '{secret}' --recipient '{secret}' --token native --total_amount 1000000 --start_time {start} --end_time {end}", id=contract_id, secret=secret, start=start_time, end=end_time);
    let create_out = run_sh(contracts_dir, &create_cmd)?;
    println!("create_stream output:\n{}", create_out);

    // Pause the stream (assume stream id 1)
    let pause_cmd = format!("soroban contract invoke --id {id} --source-account '{secret}' --network testnet -- pause_stream --stream_id 1 --sender '{secret}'", id=contract_id, secret=secret);
    let pause_out = run_sh(contracts_dir, &pause_cmd)?;
    println!("pause_stream output:\n{}", pause_out);

    // Resume the stream
    let resume_cmd = format!("soroban contract invoke --id {id} --source-account '{secret}' --network testnet -- resume_stream --stream_id 1 --sender '{secret}'", id=contract_id, secret=secret);
    let resume_out = run_sh(contracts_dir, &resume_cmd)?;
    println!("resume_stream output:\n{}", resume_out);

    // Claim some amount
    let claim_cmd = format!("soroban contract invoke --id {id} --source-account '{secret}' --network testnet -- claim --stream_id 1 --recipient '{secret}' --amount 100000", id=contract_id, secret=secret);
    let claim_out = run_sh(contracts_dir, &claim_cmd)?;
    println!("claim output:\n{}", claim_out);

    // Check events to assert Stream events exist and to surface tx hashes
    let events_cmd = format!("soroban contract events --id {id} --network testnet", id=contract_id);
    let events_out = run_sh(contracts_dir, &events_cmd)?;
    println!("events:\n{}", events_out);

    // Basic assertions: contract_id present and events output non-empty
    assert!(!contract_id.is_empty());
    assert!(events_out.len() > 0);

    Ok(())
}
