# Security Policy

## Supported Versions

The following versions of Stellar Stream are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Stellar Stream seriously. If you believe you have found a security vulnerability, please report it privately.

**Please do not open a public issue for security vulnerabilities.**

### Private Reporting Process

Please use the **[GitHub Security Advisory](https://github.com/stellar-stream/stellar-stream/security/advisories/new)** form to report vulnerabilities privately. 

This is the preferred method as it allows us to communicate with you privately and coordinate a fix before public disclosure.

### Our Commitment (SLA)

Once a report is received through the GitHub Security Advisory form, we commit to the following response timeline:

- **48 hours**: Acknowledgement of receipt of the report.
- **7 days**: Initial assessment and confirmation of the vulnerability.
- **30 days**: Target for providing a fix or public disclosure (depending on complexity).

## GitHub Security Advisories

Maintainers: Please ensure that **GitHub Security Advisories** are enabled for this repository to allow researchers to submit reports privately.
## Self-Audit Checklist

| Finding | Severity | Mitigation | Status |
| ------- | -------- | ---------- | ------ |
| Reentrancy | Medium | Ensure functions are non-reentrant or use mutexes. | Not started |
| Access Control | High | Review role-based access checks on all endpoints. | Completed |
| Integer Overflow | Medium | Use safe arithmetic libraries and input validation. | Completed |
| Front-Running | High | Implement commit-reveal schemes where applicable. | Completed |
| Replay Attacks | High | Use nonces/timestamps and enforce nonce uniqueness. | Completed |

### External Audit Firm Template

**Audit Firm:** [Name]

**Scope:** Review of smart contract code, API endpoints, and deployment scripts.

**Deliverables:**
- Security findings report
- Severity classification
- Recommended mitigations
- Final audit sign‑off

**Timeline:** ____________________

**Contact:** ____________________
