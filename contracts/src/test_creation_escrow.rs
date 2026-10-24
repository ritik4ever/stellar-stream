//! Issue #1128: creation escrow boundaries, exact authorization and rollback.
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    token, IntoVal,
};

fn committed_events(env: &Env) -> std::vec::Vec<soroban_sdk::xdr::ContractEvent> {
    // SDK 21 Events::all includes events from failed invocations. The snapshot
    // retains failed_call, which distinguishes diagnostics from committed events.
    env.to_snapshot()
        .events
        .0
        .into_iter()
        .filter(|event| {
            !event.failed_call && event.event.type_ == soroban_sdk::xdr::ContractEventType::Contract
        })
        .map(|event| event.event)
        .collect()
}

fn authorize_creation(
    env: &Env,
    contract: &Address,
    token: &Address,
    sender: &Address,
    recipient: &Address,
    amount: i128,
) {
    env.mock_auths(&[MockAuth {
        address: sender,
        invoke: &MockAuthInvoke {
            contract,
            fn_name: "create_stream",
            args: (
                sender.clone(),
                recipient.clone(),
                token.clone(),
                amount,
                100_u64,
                1100_u64,
                0_u64,
                None::<Map<String, String>>,
            )
                .into_val(env),
            sub_invokes: &[MockAuthInvoke {
                contract: token,
                fn_name: "transfer",
                args: (sender.clone(), contract.clone(), amount).into_val(env),
                sub_invokes: &[],
            }],
        },
    }]);
}

#[test]
fn creation_escrow_boundaries_require_sender_and_pay_recipient_exactly() {
    for amount in [1_i128, 2, i128::MAX - 1, i128::MAX] {
        let env = Env::default();
        let contract = env.register_contract(None, StellarStreamContract);
        let client = StellarStreamContractClient::new(&env, &contract);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let admin = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        env.mock_all_auths();
        token::StellarAssetClient::new(&env, &asset).mint(&sender, &amount);
        let token = token::Client::new(&env, &asset);
        let before = env.events().all();

        // Funding is not authorization: creation with no sender signature fails.
        env.mock_auths(&[]);
        assert!(client
            .try_create_stream(&sender, &recipient, &asset, &amount, &100, &1100, &0, &None)
            .is_err());
        assert_eq!(env.events().all(), before);
        assert_eq!(client.get_next_stream_id(), 0);
        assert!(client.try_get_stream(&1).is_err());
        assert_eq!(token.balance(&sender), amount);
        assert_eq!(token.balance(&contract), 0);
        assert_eq!(token.balance(&recipient), 0);

        authorize_creation(&env, &contract, &asset, &sender, &recipient, amount);
        let id = client.create_stream(&sender, &recipient, &asset, &amount, &100, &1100, &0, &None);
        let created = env
            .events()
            .all()
            .iter()
            .filter(|event| event.0 == contract)
            .collect::<std::vec::Vec<_>>();
        assert_eq!(created.len(), 1);
        assert_eq!(
            created[0].1,
            (symbol_short!("Stream"), symbol_short!("Created")).into_val(&env)
        );
        let payload: StreamCreated = created[0].2.into_val(&env);
        assert_eq!(payload.stream_id, id);
        assert_eq!(payload.actor, sender);
        assert_eq!(payload.sender, sender);
        assert_eq!(payload.recipient, recipient);
        assert_eq!(payload.token, asset);
        assert_eq!(payload.total_amount, amount);
        assert_eq!(payload.start_time, 100);
        assert_eq!(payload.end_time, 1100);
        assert_eq!(id, 1);
        let stream = client.get_stream(&id);
        assert_eq!(stream.total_amount, amount);
        assert_eq!(stream.claimed_amount, 0);
        assert_eq!(stream.sender, sender);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(token.balance(&sender), 0);
        assert_eq!(token.balance(&contract), amount);
        assert_eq!(client.claimable(&id, &600), amount / 2);

        env.ledger().with_mut(|ledger| ledger.timestamp = 1100);
        let before = env.events().all();
        env.mock_auths(&[]);
        assert!(client.try_claim(&id, &recipient, &amount).is_err());
        assert_eq!(env.events().all(), before);
        assert_eq!(client.get_stream(&id).claimed_amount, 0);
        assert_eq!(token.balance(&contract), amount);
        env.mock_auths(&[MockAuth {
            address: &recipient,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "claim",
                args: (id, recipient.clone(), amount).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert_eq!(client.claim(&id, &recipient, &amount), amount);
        let events = env
            .events()
            .all()
            .iter()
            .filter(|event| event.0 == contract)
            .collect::<std::vec::Vec<_>>();
        assert_eq!(events.len(), 3); // Created, Claimed, Completed, exactly once.
        assert_eq!(
            events[1].1,
            (symbol_short!("Stream"), symbol_short!("Claimed")).into_val(&env)
        );
        let claimed: StreamClaimed = events[1].2.into_val(&env);
        assert_eq!(claimed.stream_id, id);
        assert_eq!(claimed.actor, recipient);
        assert_eq!(claimed.amount, amount);
        assert_eq!(claimed.claimed_amount, amount);
        assert_eq!(
            events[2].1,
            (symbol_short!("Stream"), symbol_short!("Completed")).into_val(&env)
        );
        let completed: StreamCompleted = events[2].2.into_val(&env);
        assert_eq!(completed.stream_id, id);
        assert_eq!(completed.actor, recipient);
        assert_eq!(completed.timestamp, 1100);
        assert_eq!(completed.total_amount, amount);
        assert_eq!(client.get_stream(&id).claimed_amount, amount);
        assert_eq!(token.balance(&sender), 0);
        assert_eq!(token.balance(&contract), 0);
        assert_eq!(token.balance(&recipient), amount);
    }
}

// Unlike a token that immediately panics, this double writes both balances
// and publishes a transfer event before rejecting. All effects must roll back.
mod failing_token {
    use super::*;
    #[soroban_sdk::contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum TransferError {
        Rejected = 77,
    }
    #[contract]
    pub struct FailingToken;
    #[contractimpl]
    impl FailingToken {
        pub fn seed(env: Env, owner: Address, amount: i128) {
            env.storage().persistent().set(&owner, &amount);
        }
        pub fn reject(env: Env, reject: bool) {
            env.storage()
                .instance()
                .set(&symbol_short!("reject"), &reject);
        }
        pub fn balance(env: Env, owner: Address) -> i128 {
            env.storage().persistent().get(&owner).unwrap_or(0)
        }
        pub fn symbol(env: Env) -> String {
            String::from_str(&env, "FAIL")
        }
        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            from.require_auth();
            let debit = Self::balance(env.clone(), from.clone())
                .checked_sub(amount)
                .unwrap();
            assert!(debit >= 0);
            let credit = Self::balance(env.clone(), to.clone())
                .checked_add(amount)
                .unwrap();
            env.storage().persistent().set(&from, &debit);
            env.storage().persistent().set(&to, &credit);
            env.events()
                .publish((symbol_short!("transfer"), from, to), amount);
            if env
                .storage()
                .instance()
                .get(&symbol_short!("reject"))
                .unwrap_or(false)
            {
                soroban_sdk::panic_with_error!(&env, TransferError::Rejected);
            }
        }
    }
}

#[test]
fn creation_escrow_transfer_failure_rolls_back_token_state_events_and_id() {
    for amount in [1_i128, i128::MAX] {
        let env = Env::default();
        let contract = env.register_contract(None, StellarStreamContract);
        let client = StellarStreamContractClient::new(&env, &contract);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let asset = env.register_contract(None, failing_token::FailingToken);
        let token = failing_token::FailingTokenClient::new(&env, &asset);
        token.seed(&sender, &amount);
        token.reject(&true);
        let before = committed_events(&env);
        authorize_creation(&env, &contract, &asset, &sender, &recipient, amount);
        assert_eq!(
            client.try_create_stream(&sender, &recipient, &asset, &amount, &100, &1100, &0, &None),
            Err(Ok(soroban_sdk::Error::from_contract_error(77)))
        );
        assert_eq!(committed_events(&env), before);
        // The failed diagnostic proves transfer ran past its writes/event;
        // it must not be mistaken for a committed token transfer.
        assert_eq!(
            env.to_snapshot()
                .events
                .0
                .iter()
                .filter(|event| event.failed_call
                    && event.event.type_ == soroban_sdk::xdr::ContractEventType::Contract)
                .count(),
            1
        );
        assert_eq!(client.get_next_stream_id(), 0);
        assert!(client.try_get_stream(&1).is_err());
        assert_eq!(token.balance(&sender), amount);
        assert_eq!(token.balance(&contract), 0);
        assert_eq!(token.balance(&recipient), 0);

        // Retry the identical request after the token recovers: no ID was lost.
        token.reject(&false);
        authorize_creation(&env, &contract, &asset, &sender, &recipient, amount);
        assert_eq!(
            client.create_stream(&sender, &recipient, &asset, &amount, &100, &1100, &0, &None),
            1
        );
        let events = env.events().all();
        assert_eq!(events.iter().filter(|event| event.0 == contract).count(), 1);
        assert_eq!(committed_events(&env).len(), 2); // transfer + Created
        assert_eq!(token.balance(&sender), 0);
        assert_eq!(token.balance(&contract), amount);
        assert_eq!(client.get_stream(&1).total_amount, amount);
    }
}
