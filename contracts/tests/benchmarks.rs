#![cfg(test)]
extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use stellar_stream::{StellarStreamContract, StellarStreamContractClient};

fn measure_cost<F>(env: &Env, name: &str, mut f: F)
where
    F: FnMut(),
{
    env.budget().reset_unlimited();

    let cpu_start = env.budget().cpu_instruction_cost();
    let mem_start = env.budget().memory_bytes_cost();

    f();

    let cpu_end = env.budget().cpu_instruction_cost();
    let mem_end = env.budget().memory_bytes_cost();

    let cpu_cost = cpu_end - cpu_start;
    let mem_cost = mem_end - mem_start;

    std::println!("BENCHMARK|{}|{}|{}", name, cpu_cost, mem_cost);
}

#[test]
fn run_all_benchmarks() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let contract_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let _token = TokenClient::new(&env, &token_address);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let sender = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let initial_balance = 1_000_000_000_000;
    token_admin_client.mint(&sender, &initial_balance);

    client.initialize(
        &contract_admin,
        &token_address,
        &soroban_sdk::vec![&env, token_address.clone()],
    );

    env.ledger().set_timestamp(100_000);

    let amount = 10_000_000;
    let start_time = 150_000;
    let end_time = 250_000;
    let cliff_seconds = 0;

    measure_cost(&env, "create_stream", || {
        client.create_stream(
            &sender,
            &recipient1,
            &token_address,
            &amount,
            &start_time,
            &end_time,
            &cliff_seconds,
            &None,
        );
    });

    let stream_id_for_claim = client.create_stream(
        &sender,
        &recipient1,
        &token_address,
        &amount,
        &start_time,
        &end_time,
        &cliff_seconds,
        &None,
    );

    let stream_id_for_pause = client.create_stream(
        &sender,
        &recipient1,
        &token_address,
        &amount,
        &start_time,
        &end_time,
        &cliff_seconds,
        &None,
    );

    let stream_id_for_cancel = client.create_stream(
        &sender,
        &recipient1,
        &token_address,
        &amount,
        &start_time,
        &end_time,
        &cliff_seconds,
        &None,
    );

    env.ledger().set_timestamp(200_000);

    measure_cost(&env, "claim", || {
        client.claim(&stream_id_for_claim, &recipient1, &5_000_000);
    });

    measure_cost(&env, "pause_stream", || {
        client.pause_stream(&stream_id_for_pause, &sender);
    });

    measure_cost(&env, "resume_stream", || {
        client.resume_stream(&stream_id_for_pause, &sender);
    });

    measure_cost(&env, "cancel", || {
        client.cancel(&stream_id_for_cancel, &sender);
    });

    let mut split_recipients = Vec::new(&env);
    split_recipients.push_back((recipient1.clone(), 5_000_000_i128));
    split_recipients.push_back((recipient2.clone(), 5_000_000_i128));

    measure_cost(&env, "create_split_stream", || {
        client.create_split_stream(
            &sender,
            &token_address,
            &amount,
            &start_time,
            &end_time,
            &split_recipients,
        );
    });
}
