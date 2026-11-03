# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub: go to the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an acknowledgement within 7 days. Once a fix is released, the report can be published with credit to you if you'd like.

Only the latest version on `main` is supported.

## ISO/IEC 27001:2022 alignment

ISO 27001 certifies an **organization's** information security management system (policies, risk assessment, audits and so on). A code repository can't be certified on its own. This project instead implements the **technological controls of Annex A** that apply to an application, and documents each one below so it can be reviewed.

**Status:** ✅ implemented · 🟡 partly implemented · ⬜ depends on where the app is deployed

### Access and authentication

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 5.15 Access control · 8.3 Information access restriction | Every `/groups` route requires a login **and** membership of that group. Outsiders get the same `404` as for a group that doesn't exist, so ids can't be probed. Deletes are scoped to the group in the URL. | `modules/groups/membership.ts`, `app.ts` | ✅ |
| 5.17 Authentication information | Passwords are 8–128 characters and stored only as argon2id hashes. Tokens hold only the user id. | `modules/auth/` | ✅ |
| 8.5 Secure authentication | argon2id with OWASP settings; short-lived signed JWTs with pinned algorithm and issuer (`alg: none` rejected); rate-limited login; the same response and timing for "wrong password" and "no such account". | `modules/auth/` | 🟡 no MFA or token revocation yet |
| 8.24 Use of cryptography | Node's built-in `crypto.argon2`, constant-time comparison, random salts; `JWT_SECRET` must be at least 32 characters. HTTPS is provided by the hosting platform; HSTS is sent. | `modules/auth/password.ts`, `config.ts` | ✅ / ⬜ TLS |

### Logging and monitoring

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.15 Logging | Structured security events: `auth.registered`, `auth.login_succeeded`, `auth.login_failed`, `auth.token_rejected`, `access.denied`, `rate_limit.exceeded`, `group.member_added`, `expense.deleted`. Each has the client IP and request id. | `security.ts` | ✅ |
| 8.16 Monitoring activities | Failures and denials are logged at `warn` for alerting. `GET /health` checks the database for uptime monitoring. Log retention and alerting rules belong to the log platform. | `security.ts`, `app.ts` | 🟡 / ⬜ retention |
| 8.11 Data masking · 8.12 Data leakage prevention · 5.34 Privacy and PII | Passwords, password hashes, tokens and auth headers are redacted from logs. Emails in logs are replaced by a one-way fingerprint. Responses never include password hashes. Unexpected errors return a generic message. | `security.ts`, `app.ts` | ✅ |

### Secure development

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.25 Secure development life cycle · 8.32 Change management | Work happens on feature branches and is merged through pull requests after CI passes. | GitHub | 🟡 branch protection to be enabled |
| 8.26 Application security requirements | All input is validated with Zod; request bodies are capped at 16 KB; requests time out after 30 s; every route is rate limited per IP, with stricter limits on login, register and adding members by email. | `app.ts`, route modules | ✅ |
| 8.28 Secure coding | TypeScript strict mode; parameterised queries through Prisma (no SQL built from strings); security headers via Helmet; one error format that never leaks internals. | `tsconfig.json`, `app.ts` | ✅ |
| 8.29 Security testing in development and acceptance | Tests cover forged, expired and `alg: none` tokens, access by non-members, rate limiting, log redaction and timing-safe login. CodeQL static analysis runs on every PR and weekly. | `tests/`, `.github/workflows/codeql.yml` | ✅ |
| 8.8 Management of technical vulnerabilities | CI fails on any high or critical `npm audit` finding. Dependabot opens weekly update PRs. Secret scanning and push protection are enabled. | `.github/` | ✅ |
| 5.21 ICT supply chain security | Exact versions in `package-lock.json`, installed with `npm ci`; package install scripts are blocked unless allowed (`allowScripts`); release candidates are avoided; dependencies are few and well maintained. | `server/package.json` | ✅ |
| 8.9 Configuration management | All settings come from environment variables and are validated at startup (the server refuses to start on bad config). `.env` files are never committed. | `config.ts`, `.gitignore` | ✅ |
| 8.31 Separation of development, test and production environments | Integration tests use their own `splitter_test` database. Each environment gets its own `.env`. | `tests/integration/` | ✅ |
| 8.20 Network security | The dev server listens on `127.0.0.1` only. `TRUST_PROXY` is off unless the app runs behind a proxy you control, so clients can't fake their IP to dodge rate limits. | `config.ts` | ✅ |
| 8.4 Access to source code | Public repository; only the owner can push. | GitHub | 🟡 branch protection to be enabled |

### Known gaps

These are tracked as future work rather than hidden:

- **Multi-factor authentication** is not available.
- **Logging out** doesn't revoke a token; it stays valid until it expires (1 day by default). Refresh tokens with revocation would fix this.
- **Login throttling is per IP**, not per account, so a distributed attack is only slowed by the dummy-hash cost.
- **Account deletion and data export** (PII rights) aren't implemented yet.
- **Backups, encryption at rest, TLS and log retention** depend on the hosting provider and aren't configured by this repository.

### Out of scope for a code repository

Organizational, people and physical controls (Annex A sections 5, 6 and 7), such as security policies, risk assessment, staff screening and training, supplier agreements and office security, belong to the organization running the service, not to the code.
