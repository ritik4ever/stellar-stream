# StellarStream Maintainer Guide

A lightweight playbook for maintainers covering issue triage, label hygiene, release preparation, and local verification. Keep this document up to date as the project evolves.

## Table of Contents
1. [Who This Guide Is For](#who-this-guide-is-for)
2. [Repository At a Glance](#repository-at-a-glance)
3. [Issue Triage](#issue-triage)
4. [Label System](#label-system)
5. [PR Review Process](#pr-review-process)
6. [Local Verification Steps](#local-verification-steps)
7. [Release Checklist](#release-checklist)
8. [Contract Readiness](#contract-readiness)
9. [Known Limitations & Watchlist](#known-limitations--watchlist)
10. [Conflict Resolution](#conflict-resolution)
11. [Deployment & Monitoring](#deployment--monitoring)
12. [Security & Maintenance](#security--maintenance)
13. [Maintainer Handoff](#maintainer-handoff)

---

## Who This Guide Is For

This guide is for anyone with merge access to the StellarStream repository. It assumes you are already familiar with the project's README and can run the app locally. It is not a contributor onboarding guide — direct new contributors to CONTRIBUTING.md and the project README instead.

---

## Repository At a Glance

| Layer | Location | Port | Tech |
|-------|----------|------|------|
| Frontend | `frontend/` | 3000 | React + Vite + Tailwind |
| Backend | `backend/` | 3001 | Node.js + Express + SQLite |
| Contract | `contracts/` | — | Rust + Soroban |
| Backlog | `backlog/` | — | Markdown task drafts |

**Key entry points:**
- Backend API server: `backend/src/index.ts`
- Stream logic & math: `backend/src/services/streamStore.ts`
- Database schema: `backend/src/services/db.ts`
- React root: `frontend/src/App.tsx`
- Contract: `contracts/src/lib.rs`

---

## Issue Triage

### Triage Cadence
Aim to triage new issues within 48 hours of opening.

A triaged issue has:
- A label (type + area)
- An assignee or `help wanted` tag
- A brief maintainer comment if clarification is needed

### Triage Decision Tree

```
New issue opened
│
├── Is it a duplicate?
│   └── Yes → Close with link to original. Add label: duplicate
│
├── Is the report unclear / missing reproduction steps?
│   └── Yes → Comment requesting info. Add label: needs-info
│       └── No response in 7 days → Close with note. Label: stale
│
├── Is it a bug?
│   ├── Affects backend API or DB? → Label: bug, backend
│   ├── Affects frontend UI or polling? → Label: bug, frontend
│   ├── Affects contract logic? → Label: bug, contract
│   └── Assign to yourself or a known contributor
│
├── Is it a feature request / enhancement?
│   └── Label: enhancement + relevant area label
│       └── Add to backlog/ if approved but not immediately prioritized
│
└── Is it a maintenance/chore task?
    └── Label: chore, and link to related area
```

### Grooming Backlog Issues
During each release cycle, review open issues with `backlog` or `help wanted` labels:
- Close any issues that are superseded by merged PRs or architecture changes
- Move implementation task drafts from `backlog/` folder into real GitHub Issues when they are ready to be worked on
- Update milestone assignments

---

## Label System

### Recommended Label Set

| Label | Color | Purpose |
|-------|-------|---------|
| `bug` | #d73a4a | Something isn't working correctly |
| `enhancement` | #a2eeef | New feature or improvement request |
| `chore` | #e4e669 | Maintenance, config, CI, docs |
| `frontend` | #0075ca | Scoped to `frontend/` |
| `backend` | #e99695 | Scoped to `backend/` |
| `contract` | #f9d0c4 | Scoped to `contracts/` |
| `needs-info` | #d876e3 | Waiting on reporter to clarify |
| `duplicate` | #cfd3d7 | Already reported elsewhere |
| `stale` | #cfd3d7 | Inactive and pending closure |
| `good first issue` | #7057ff | Suitable for new contributors |
| `help wanted` | #008672 | Open for community pick-up |
| `breaking` | #b60205 | Introduces a breaking API or schema change |
| `blocked` | #e11d48 | Waiting on another issue or external dependency |

**Best Practice:** Always apply at least one area label (`frontend`, `backend`, `contract`) alongside a type label (`bug`, `enhancement`, `chore`) so issues are filterable by component.

---

## PR Review Process

### Pre-Review Checklist
Before reviewing any PR, verify:
- [ ] CI/CD pipeline passes (GitHub Actions)
- [ ] No merge conflicts with main
- [ ] PR description is clear and references an issue
- [ ] Branch is based on recent main (< 3 days old)

### Review Checklist

#### Code Quality
- [ ] Code follows project style (ESLint, Prettier)
- [ ] No console.log or debug statements left behind
- [ ] Error handling is appropriate
- [ ] No hardcoded secrets or sensitive data
- [ ] Comments explain "why", not "what"

#### Testing
- [ ] Tests are included for new features
- [ ] Existing tests still pass
- [ ] Test coverage hasn't decreased
- [ ] Edge cases are covered

#### Documentation
- [ ] README updated if needed
- [ ] API changes documented
- [ ] Complex logic has comments
- [ ] CHANGELOG entry added (if applicable)

#### Architecture
- [ ] Changes align with project architecture
- [ ] No unnecessary dependencies added
- [ ] Performance impact considered
- [ ] Backwards compatibility maintained

### Review Comments Template

**For Approval:**
```
✅ Looks good! This PR:
- Fixes [issue #X]
- Follows our code standards
- Has good test coverage
- Ready to merge!
```

**For Changes Requested:**
```
Thanks for the PR! I have a few suggestions:

1. **[File or Function]**: [Specific feedback]
   - Why: [Explanation]
   - Suggestion: [How to fix]

2. **[File/Function]**: [Specific feedback]

Please address these and let me know when ready for re-review.
```

### Merge Strategy
- Use **"Squash and merge"** for small PRs (< 5 commits)
- Use **"Create a merge commit"** for larger features (preserves history)
- Use **"Rebase and merge"** for hotfixes (clean linear history)
- Always delete the branch after merging

---

## Local Verification Steps

Run these checks before approving any PR that touches shared infrastructure.

### Full Stack Startup

```bash
# From repo root
npm run install:all
npm run dev:backend   # Terminal 1 — starts backend on :3001
npm run dev:frontend  # Terminal 2 — starts frontend on :3000
```

**Expected output (backend):**
```
Server running on port 3001
Database initialized
Event indexer started
```

**Expected output (frontend):**
```
VITE ready in Xms
➜  Local: http://localhost:3000/
```

### Backend API Smoke Tests

```bash
# Health check
curl http://localhost:3001/api/health

# List streams (empty is fine on fresh DB)
curl http://localhost:3001/api/streams

# Create a test stream
curl -X POST http://localhost:3001/api/streams \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "GABC1234",
    "recipient": "GXYZ5678",
    "assetCode": "USDC",
    "totalAmount": 100,
    "durationSeconds": 120
  }'

# Note the returned stream ID, then fetch it
curl http://localhost:3001/api/streams/<id>

# Fetch event history
curl http://localhost:3001/api/streams/<id>/history

# Cancel the stream
curl -X POST http://localhost:3001/api/streams/<id>/cancel
```

### Stream Math Verification

Given a stream with `totalAmount=100`, `durationSeconds=120`, `startAt=T`:

| Time | Expected | Actual |
|------|----------|--------|
| At T (just started) | vested ≈ 0, status = active | ✓ |
| At T + 60s (halfway) | vested ≈ 50, remaining ≈ 50 | ✓ |
| At T + 120s (done) | vested = 100, status = completed | ✓ |
| Before T | status = scheduled | ✓ |
| After cancel | status = canceled | ✓ |

Verify these values appear correctly in the frontend stream table and via `GET /api/streams/:id`.

### Frontend Checks

- [ ] Dashboard loads at http://localhost:3000 with no console errors
- [ ] Stream list auto-refreshes every ~5 seconds (observe network tab)
- [ ] Creating a stream via the form adds it to the list immediately
- [ ] Canceling a stream updates its status in the table
- [ ] Stream timeline (StreamTimeline component) shows created event after creation
- [ ] Metrics panel (active / completed / vested totals) updates after changes

### Database Inspection (Optional)

```bash
# SQLite CLI — inspect streams table directly
sqlite3 backend/data/streams.db

sqlite> .tables
sqlite> SELECT id, sender, recipient, status FROM streams ORDER BY createdAt DESC LIMIT 5;
sqlite> SELECT * FROM stream_events ORDER BY timestamp DESC LIMIT 10;
sqlite> .quit
```

---

## Release Checklist

StellarStream does not yet have a formal versioning pipeline. Use this checklist before tagging any release or deploying changes to a shared environment.

### Pre-Release: Code Review
- [ ] All PRs intended for this release are merged and CI is green
- [ ] No open PRs with the `breaking` label are unresolved
- [ ] CHANGELOG.md (or release notes draft) is updated with user-facing changes
- [ ] Known limitations section in README.md is current

### Pre-Release: Backend Checks
- [ ] `backend/src/services/db.ts` — confirm schema migrations are non-destructive (SQLite does not support column drops; verify ALTER TABLE usage)
- [ ] `backend/src/services/streamStore.ts` — confirm stream math (elapsed, ratio, vested) has not regressed; spot-check against the formulas in the README
- [ ] Event indexer (`backend/src/services/indexer.ts`) poll interval is intentional (default 10 seconds)
- [ ] All required environment variables are documented (see README): `CONTRACT_ID`, `SERVER_PRIVATE_KEY`, `RPC_URL`
- [ ] `.env.example` is up to date if one exists

### Pre-Release: Frontend Checks
- [ ] `frontend/vite.config.ts` proxy target still points to correct backend port (3001)
- [ ] Polling interval in `frontend/src/App.tsx` is intentional (default 5 seconds)
- [ ] `VITE_API_URL` override is documented for non-default deployments
- [ ] UI renders correctly for all four stream statuses: scheduled, active, completed, canceled

### Pre-Release: Contract Checks
- [ ] Contract compiles cleanly: `cd contracts && cargo build --target wasm32-unknown-unknown --release`
- [ ] Any changes to `create_stream`, `claimable`, `claim`, or `cancel` ABI are reflected in `backend/src/services/streamStore.ts`
- [ ] `contracts/contract_id.txt` is not committed with a production secret key

### Release Tagging

```bash
git tag -a v0.x.0 -m "Release v0.x.0 — <one-line summary>"
git push origin v0.x.0
```

### Post-Release
- [ ] Verify health endpoint responds on deployed instance: `GET /api/health`
- [ ] Create a new stream via the frontend and confirm it appears in the stream list
- [ ] Cancel the test stream and confirm status updates to canceled
- [ ] Close the GitHub milestone (if used) and open the next one

---

## Contract Readiness

The Soroban contract in `contracts/src/lib.rs` is a scaffold — it is not yet wired into the backend runtime in this MVP. Use the following checks when evaluating contract-related PRs or preparing for the integration milestone.

### Build Check

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

A clean build produces a `.wasm` file in `target/wasm32-unknown-unknown/release/`. No warnings about unused methods is a good sign.

### Supported Contract Methods

| Method | Status |
|--------|--------|
| `create_stream(...)` | Implemented |
| `get_stream(stream_id)` | Implemented |
| `claimable(stream_id, at_time)` | Implemented |
| `claim(stream_id, recipient, amount)` | Accounting only — token transfer not wired |
| `cancel(stream_id, sender)` | Implemented |

### Testnet Deployment

```bash
SECRET_KEY="S..." npm run deploy:contract
```

After deployment:
- Copy the contract ID from the output or `contracts/contract_id.txt`
- Set `CONTRACT_ID=<id>` in `backend/.env`
- Set `SERVER_PRIVATE_KEY=<key>` in `backend/.env`
- Restart the backend

⚠️ **Never commit** `contracts/contract_id.txt` or `.env` files containing secret keys to version control.

### Contract ↔ Backend Interface

When contract methods change, update `backend/src/services/streamStore.ts` to match. The backend currently uses SQLite as the source of truth; Soroban state is supplementary until full integration is complete.

---

## Known Limitations & Watchlist

Keep these on your radar when reviewing PRs or triaging issues. They are not bugs — they are known gaps in the current MVP.

| Area | Limitation | Risk if Unaddressed |
|------|-----------|-------------------|
| **Contract** | Not connected to backend runtime | On-chain state diverges from SQLite |
| **Auth** | No authentication on write endpoints (`POST /api/streams`, `POST /api/streams/:id/cancel`) | Any caller can create or cancel streams |
| **Wallet** | No wallet sign/transaction flow in UI | Users cannot sign transactions |
| **Token Transfer** | `claim` updates accounting only — no actual token movement | Misleading balance displays |
| **Event Indexer** | Polls every 10 seconds — configurable but hardcoded | May miss rapid contract events |
| **Test Coverage** | Minimal — CI can be expanded | Regressions may go undetected |

**When a PR claims to fix one of these, verify end-to-end, not just the unit level.**

---

## Conflict Resolution

### Merge Conflict Prevention
- Enforce the Git Workflow Guide (see GIT_WORKFLOW_GUIDE.md)
- Require branch updates before PR merge
- Communicate about shared files (package.json, routes)
- Keep PRs small and focused

### Handling Conflicts

**If conflicts occur during review:**
1. Comment on PR: "Please rebase with latest main to resolve conflicts"
2. Provide command:
   ```bash
   git fetch origin
   git rebase origin/main
   git push --force-with-lease
   ```

**If conflicts are complex:**
1. Schedule a sync with the contributor
2. Pair program to resolve
3. Document the resolution for future reference

**Package.json Conflicts:**
- Manually merge dependency versions
- Run `npm install` to verify
- Test that both features still work
- Commit the resolved package-lock.json

---

## Deployment & Monitoring

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] Code review approved
- [ ] No security vulnerabilities (run `npm audit`)
- [ ] Performance benchmarks acceptable
- [ ] Documentation updated
- [ ] Staging environment tested

### Deployment Steps
1. **Build Docker images** (if applicable)
   ```bash
   docker build -t stellar-stream:v0.x.x .
   ```

2. **Deploy to staging** first
   - Verify all features work
   - Check logs for errors
   - Run smoke tests

3. **Deploy to production**
   - Use blue-green deployment if possible
   - Monitor error rates and performance
   - Have rollback plan ready

### Monitoring & Alerts
- Monitor error logs for exceptions
- Track API response times
- Alert on failed deployments
- Monitor Stellar Testnet connectivity
- Track stream creation/cancellation success rates

### Rollback Procedure
If critical issues occur post-deployment:
```bash
# Revert to previous version
git revert <commit-hash>
git push origin main

# Or redeploy previous tag
docker pull stellar-stream:v0.x.(x-1)
docker run ... stellar-stream:v0.x.(x-1)
```

---

## Security & Maintenance

### Dependency Management

**Monthly Security Audit:**
```bash
npm audit
npm audit fix  # Auto-fix if safe
npm update     # Update to latest compatible versions
```

**Quarterly Major Updates:**
- Review breaking changes
- Test thoroughly
- Update documentation
- Create PR for review

### Security Reporting
- Do NOT create public issues for security vulnerabilities
- Email security concerns to maintainers privately
- Follow responsible disclosure (30-day window)
- Credit reporters in release notes

### Code Security Review
- Check for SQL injection (SQLite queries in `backend/src/services/db.ts`)
- Verify no hardcoded secrets
- Validate user inputs (stream amounts, durations)
- Check for XSS vulnerabilities in frontend
- Verify authentication/authorization on API endpoints

### Dependency Vulnerabilities
- Use `npm audit` regularly
- Subscribe to security advisories
- Update critical dependencies immediately
- Document why non-critical updates are deferred

---

## Communication

### Channels
- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Design decisions, questions
- **GitHub PRs**: Code review, implementation
- **Email**: Security reports (private)
- **Team Chat**: Real-time coordination (if applicable)

### Response Time SLAs
- **Critical bugs**: 4 hours
- **High priority**: 24 hours
- **Medium priority**: 48 hours
- **Low priority**: 1 week
- **Questions**: 48 hours

### Announcement Template
For major changes or releases:

```markdown
## 📢 Announcement: [Title]

**What's changing**: [Brief description]

**Why**: [Motivation]

**Timeline**: [When it happens]

**Action needed**: [What users should do]

**Questions?** Comment below or open a Discussion.
```

### Contributor Recognition
- Thank contributors in release notes
- Highlight major contributions in README
- Celebrate milestones (100 stars, 1st PR, etc.)
- Invite active contributors to become maintainers

---

## Maintainer Handoff

When handing off maintainer responsibilities:

**Access** — Transfer or add the new maintainer as a repository collaborator with Write or Maintain access.

**Secrets** — Share any deployment keys, testnet account credentials, or environment secrets through a secure channel (not GitHub issues or PR comments).

**Open issues** — Walk through the open issue list together and transfer assignees where needed.

**Pending PRs** — Ensure no PR is left in an ambiguous state (re-request review or close with a note).

**This document** — Update the "Who This Guide Is For" section and commit the change in the handoff PR.

---

## Useful Commands

```bash
# View recent commits
git log --oneline -10

# Check branch status
git branch -vv

# Find who changed a line
git blame <file>

# View PR diff
git diff main..feature-branch

# Squash commits before merge
git rebase -i HEAD~3

# Stash work in progress
git stash
git stash pop

# Cherry-pick a commit
git cherry-pick <commit-hash>
```

---

## Escalation & Help

**Stuck on a decision?**
- Create a GitHub Discussion
- Tag relevant maintainers
- Wait for consensus

**Contributor being difficult?**
- Stay professional and kind
- Reference CODE_OF_CONDUCT.md
- Escalate to senior maintainers if needed

**Burnout?**
- It's okay to step back
- Communicate with team
- Share responsibilities
- Take breaks

---

## Resources

- [README](./README.md) — Project overview and setup
- [PR_DESCRIPTION](./PR_DESCRIPTION.md) — Example PR workflow and testing
- [STREAM_EVENTS_IMPLEMENTATION](./STREAM_EVENTS_IMPLEMENTATION.md) — Event history implementation details

---

**Last Updated**: March 2026
**Maintained By**: StellarStream Core Team
