# Contributing to StellarStream

Thank you for your interest in contributing to StellarStream! This guide will help you get started with our development process.

Check out the [FAQ.md](FAQ.md) for common contributor questions and troubleshooting tips.



## Development Setup

1. Clone the repository
2. Install dependencies: `npm run install:all`


## Testing

### Backend Tests



### Contract Tests

Run `cargo test` in the `contracts/` directory.

#### Snapshot Testing

We use `insta` for snapshot testing of contract events.  
Snapshot files are located in `contracts/test_snapshots/`.

**To update snapshots:**
If you change event structures and need to update the snapshots, run:

```bash
cargo insta review

## Commits

Use Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`
