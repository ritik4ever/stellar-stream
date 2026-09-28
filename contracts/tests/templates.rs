use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use stellar_stream::{StellarStreamContract, StellarStreamContractClient};

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_contract_id.address()
}

#[test]
fn template_creation_query_and_stream_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = create_token(&env, &admin);
    client.initialize(&admin, &token, &soroban_sdk::vec![&env, token.clone()]);
    let token_admin = token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1000);

    env.ledger().set_timestamp(500);
    let template_id = client.create_template(
        &sender,
        &String::from_str(&env, "monthly"),
        &token,
        &3600,
        &600,
        &String::from_str(&env, "linear"),
    );

    let template = client.get_template(&template_id);
    assert_eq!(template.sender, sender);
    assert_eq!(template.token, token);
    assert_eq!(template.duration_seconds, 3600);
    assert_eq!(template.cliff_seconds, 600);
    assert_eq!(template.vesting_type, String::from_str(&env, "linear"));

    let sender_templates = client.get_templates_by_sender(&template.sender);
    assert_eq!(sender_templates.len(), 1);
    assert_eq!(sender_templates.get(0).unwrap().id, template_id);

    let stream_id = client.create_stream_from_template(&template_id, &recipient, &700);
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.sender, template.sender);
    assert_eq!(stream.recipient, recipient);
    assert_eq!(stream.token, template.token);
    assert_eq!(stream.total_amount, 700);
    assert_eq!(stream.start_time, 500);
    assert_eq!(stream.end_time, 4100);
    assert_eq!(stream.cliff_seconds, template.cliff_seconds);
    assert_eq!(stream.vesting_type, template.vesting_type);
}

#[test]
#[should_panic(expected = "template limit exceeded")]
fn create_template_enforces_sender_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, StellarStreamContract);
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let token = Address::generate(&env);

    for i in 0..11 {
        client.create_template(
            &sender,
            &String::from_str(&env, "template"),
            &token,
            &(100 + i),
            &0,
            &String::from_str(&env, "linear"),
        );
    }
}
