#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_get_next_stream_id() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    assert_eq!(client.get_next_stream_id(), 0);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    assert_eq!(client.get_next_stream_id(), 1);

    client.create_stream(&sender, &recipient, &token, &1000, &1000, &2000);
    assert_eq!(client.get_next_stream_id(), 2);
}
