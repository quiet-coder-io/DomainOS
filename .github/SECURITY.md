# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` branch | Yes |

Only the latest code on `main` receives security fixes. There are no versioned releases yet.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Open a private security advisory** via [GitHub's security advisories](https://github.com/quiet-coder-io/DomainOS/security/advisories/new).
2. Include a clear description of the vulnerability and steps to reproduce.
3. **Do not disclose publicly** until a fix has been released.

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days.

## Scope

The following are in scope for security reports:

- **Authentication flaws** — credential leakage, keychain bypass, token exposure
- **Data leakage** — KB content, API keys, or user data leaving the local machine unexpectedly
- **Remote code execution** — code injection via KB files, intake pipeline, or LLM responses
- **Privilege escalation** — renderer process gaining main process capabilities outside the IPC contract

Out of scope:

- Vulnerabilities in upstream dependencies (report those to the upstream project)
- Denial of service against the local desktop app
- Social engineering attacks
