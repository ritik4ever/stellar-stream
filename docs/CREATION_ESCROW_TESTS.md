# Creation escrow regressions

Run the offline Soroban regressions for issue #1128 from `contracts/`:

```sh
cargo test --locked creation_escrow_ -- --test-threads=2
```

`src/test_creation_escrow.rs` supplements the existing amount-validation and
vesting tests in `src/test.rs`:

- For `1`, `2`, `i128::MAX - 1`, and `i128::MAX`, a funded sender still needs
  authorization for creation and the nested escrow transfer. The recipient
  separately authorizes payout. The tests check stored amounts, balances,
  midpoint rounding, and the `Created`, `Claimed`, and `Completed` event payloads.
- For `1` and `i128::MAX`, a test token debits the sender, credits escrow, and
  emits a transfer event before rejecting with contract error `77`. The test
  checks that token writes and events roll back, no stream or ID is allocated,
  and the identical request succeeds with ID `1` once the token recovers.

SDK 21's `Events::all()` also exposes failed-invocation events. The rollback
test uses snapshot `failed_call` flags to distinguish those diagnostics from
committed events, and confirms the rejected transfer leaves one failed event
but no committed event or balance change.

The token double is test-only. Real Stellar asset contracts cover successful
funding and payout. Explicit authorization mocks bind the signer, entry point,
arguments, and nested transfer; neither test uses unrestricted authorization
for the operation under test. No network, deployed contract, or wallet is needed.

These tests preserve the documented creation behavior; they introduce no
contract ABI or event-schema changes.
