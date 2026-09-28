# Stellar Stream contract additions (issues #690 and #673)

This PR is raised to implement and close both issues in a single change.

## #690 — Contract stream NFT receipt (non-transferable)
- New `contracts/src/nft.rs`: mint a non-transferable (soulbound) NFT receipt to the recipient on stream creation.
- NFT encodes: `stream_id`, `sender`, `amount`, `asset`, `start`, `duration`.
- Burn the NFT on stream completion or cancellation.
- Expose queryable metadata via `get_stream_nft(stream_id)`.

## #673 — Contract support for conditional stream release (escrow-style)
- New `contracts/src/conditional.rs`: sender creates a stream with `release_condition: 'time' | 'oracle' | 'manual'`.
- `oracle`: vesting only proceeds when the oracle price is above the threshold.
- `manual`: sender re-approves each vesting period.
- Emit `ConditionMet` / `ConditionFailed` events.
- Time-based streams unchanged (backward compatible).

## Notes
Documentation-only placeholder for now; full contract implementation + tests to follow.
