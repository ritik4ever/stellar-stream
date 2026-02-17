# Implement Token Transfer On Claim

- Complexity: High
- Points: 200
- Labels: `stellar-wave`, `smart-contract`, `enhancement`

## Problem
`claim` currently updates internal accounting but does not transfer tokens to recipient.

## Scope
- Integrate Soroban token client in contract.
- Transfer claimable amount on successful `claim`.
- Add checks for insufficient sender balance or allowance.

## Acceptance Criteria
- Claim transaction transfers token amount to recipient.
- Claimed amount cannot exceed vested amount.
- Add contract tests for successful and failed claim flows.
