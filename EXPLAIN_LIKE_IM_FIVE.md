# EXPLAIN LIKE I'M FIVE

## What problem does this repo solve?

Want to pay someone continuously over time? Like a salary by the second? **StellarStream** lets you stream Stellar payments — money flows from sender to recipient in real time, and the recipient can claim only what they've earned so far.

## How does it work in 3 bullet points?

1. **A sender creates a stream** — they deposit a total amount of Stellar and set a duration (e.g. "1,000 XLM over 30 days"). The money goes into a smart contract vault.
2. **Value vests continuously** — every second, a tiny fraction unlocks for the recipient. After 15 days of a 30-day stream, exactly half is claimable.
3. **Claim anytime, cancel anytime** — the recipient can claim their vested balance. The sender can cancel early; unvested funds go back. No lump-sum surprises.

```
    Stream timeline (30-day, 1000 XLM)
    
    Deposit ─────────────────────────────────► Deadline
       │                                        │
       │    ▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░     │
       │    ^ 250 vested   ^ 500 vested         │
       │     (day 7)       (day 15)             │
       │                                        │
       ▼                                        ▼
    ┌──────┐                             ┌──────────┐
    │Sender│                             │Recipient │
    │  💰  │ ────── stream ────────────▶ │   💰     │
    └──────┘                             └──────────┘
```

## Who should use this?

- **Freelancers & contractors** who want to be paid by the hour/day instead of waiting for invoices
- **Employers & DAOs** that want to stream salaries on-chain in real time
- **Developers** learning Soroban vesting and time-based smart contract patterns
- **Anyone exploring Stellar** payment streaming as an alternative to traditional payroll
