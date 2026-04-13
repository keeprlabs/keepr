# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Keepr, please report it responsibly. **Do not open a public GitHub issue.**

Email the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/keeprhq/keepr/security/advisories/new).

When reporting, please include:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact (what data could be exposed, what could be exploited)
- Suggested fix, if any

We will acknowledge your report within 48 hours and provide a detailed response within 7 days.

## Security Model

Keepr is a local-first desktop application. Its security posture is different from a SaaS product:

- **No Keepr-operated servers.** There is no backend to breach.
- **Secrets in OS keychain.** API keys and tokens are stored in macOS Keychain, not in config files or SQLite.
- **Data leaves your machine in two ways only:** to Slack/GitHub (the original sources) and to the LLM provider you configured. See [`PRIVACY.md`](./PRIVACY.md) for the full picture.
- **No telemetry in v1.** Nothing phones home.

### What we consider in scope

- Secrets leaking to disk outside the OS keychain
- SQLite data accessible to other apps without OS-level protection
- Prompt injection that causes the LLM to exfiltrate data from the evidence payload
- Memory file writes that could overwrite or read files outside the memory directory
- Dependencies with known CVEs

### What we consider out of scope

- Attacks requiring physical access to an unlocked machine (that's an OS-level concern)
- LLM provider data handling policies (you chose your provider; read their policy)
- Slack/GitHub API security (those are upstream concerns)

## Disclosure Policy

When we receive a security report, we will:

1. Confirm the problem and determine affected versions
2. Audit related code for similar issues
3. Prepare a fix and release it promptly
4. Credit the reporter in the release notes (unless they prefer anonymity)

Thank you for helping keep Keepr and its users safe.
