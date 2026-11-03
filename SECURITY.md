# Security

## Reporting a vulnerability

Please **don't post details of a security problem publicly**. Instead, open a GitHub issue titled **"Security contact request"** with no details, and the maintainer will reply with a private way to send the report.

Then include what you found, how to reproduce it, and the impact you expect. You'll get an acknowledgement within 7 days. Once a fix is released, the report can be published with credit to you if you'd like.

Only the latest version on `main` is supported.

## ISO/IEC 27001:2022 alignment

ISO 27001 certifies an **organization's** information security management system (policies, risk assessment, audits and so on). A code repository can't be certified on its own. This project instead implements the **technological controls of Annex A** that apply to an application, and documents each one below so it can be reviewed. Where a control is only partly met, the table says so and the gap is listed under [Known gaps](#known-gaps).

**Status:** ✅ implemented · 🟡 partly implemented · ⬜ depends on where the app is deployed

### Access and authentication

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 5.15 Access control · 8.3 Information access restriction | Every `/api/groups` route requires a login **and** membership of that group. Outsiders get the same `404` as for a group that doesn't exist, so ids can't be probed. Deletes are scoped to the group in the URL. A token for an account that no longer exists is rejected. | `modules/groups/membership.ts`, `modules/auth/authenticate.ts` | 🟡 any member can add people and delete expenses (see gaps) |
| 5.17 Authentication information | Passwords are 8–128 characters and stored only as argon2id hashes. Tokens hold only the user id. | `modules/auth/` | ✅ |
| 8.5 Secure authentication | argon2id with OWASP settings; signed JWTs with a pinned algorithm and issuer (`alg: none` rejected), lasting 1 day by default and at most 7; rate-limited login and sign-up. Login gives the same response and takes the same time for "wrong password" and "no such account". | `modules/auth/` | 🟡 no MFA, no revocation; sign-up and add-member reveal whether an email is registered |
| 8.24 Use of cryptography | Node's built-in `crypto.argon2`, constant-time comparison, random salts. `JWT_SECRET` must be at least 32 characters and the server refuses to start with the example placeholder. HTTPS is provided by the hosting platform; HSTS is sent. | `modules/auth/password.ts`, `config.ts` | ✅ / ⬜ TLS |

### Logging and monitoring

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.15 Logging | Structured security events: `auth.registered`, `auth.login_succeeded`, `auth.login_failed`, `auth.token_rejected`, `access.denied`, `rate_limit.exceeded`, `group.member_added`, `expense.created`, `expense.deleted`, `settlement.created`. Each has the client IP and request id. | `security.ts` | ✅ |
| 8.16 Monitoring activities | Failures and denials are logged at `warn` for alerting. `GET /api/health` checks the database for uptime monitoring. Log retention and alerting rules belong to the log platform. | `security.ts`, `app.ts` | 🟡 / ⬜ retention |
| 8.11 Data masking · 8.12 Data leakage prevention · 5.34 Privacy and PII | Passwords, password hashes, tokens, auth and cookie headers are redacted from logs, up to three levels deep. Emails in logs are replaced by a fingerprint keyed with a server secret (HMAC), so someone holding only the logs can't confirm a guessed address. Responses never include password hashes. Unexpected errors return a generic message, and unknown URLs aren't echoed back. | `security.ts`, `app.ts` | ✅ |

### Secure development

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.25 Secure development life cycle · 8.32 Change management | Work happens on feature branches and is merged through pull requests. Branch protection on `main` blocks direct pushes (including the owner's) and requires every CI check (tests on three OSes, integration tests, audit, CodeQL) to pass on an up-to-date branch. No second-person approval is required: this is a one-person project. | GitHub | ✅ |
| 8.26 Application security requirements | All input is validated with Zod; request bodies are capped at 16 KB; requests time out after 30 s; every API route and unknown URL is rate limited per IP (except the health check), with stricter limits on login, sign-up and adding members by email. The database rejects non-positive amounts, zero shares and self-payments with CHECK constraints, as a backstop to the API's own checks. | `app.ts`, route modules, `prisma/migrations/` | 🟡 rate-limit counters are kept in memory per server process |
| 8.28 Secure coding | TypeScript strict mode; parameterised queries through Prisma (no SQL built from strings); security headers via Helmet; one error format that never leaks internals; corrupt stored data is reported as a logged server error, not blamed on the client. | `tsconfig.json`, `app.ts` | ✅ |
| 8.29 Security testing in development and acceptance | Tests cover forged, expired and `alg: none` tokens; tokens of deleted users; access by non-members on every group route; rate limits on login, sign-up, add-member and unknown URLs; spoofed `X-Forwarded-For`; log redaction including nested fields; and that an unknown account takes as long to check as a wrong password. CodeQL static analysis runs on every PR and weekly. | `server/tests/`, `.github/workflows/codeql.yml` | ✅ |
| 8.8 Management of technical vulnerabilities | CI fails on any high or critical `npm audit` finding for the server and client. Dependabot opens weekly update PRs. Secret scanning and push protection are enabled. | `.github/` | ✅ |
| 5.21 ICT supply chain security | Exact versions in the root `package-lock.json`, installed with `npm ci`. `strict-allow-scripts` in `.npmrc` blocks every package install script not reviewed in `allowScripts` (currently all three are denied). GitHub Actions are pinned to commit SHAs. Release candidates are avoided; dependencies are few and well maintained. | `.npmrc`, `package.json`, `.github/workflows/` | ✅ |
| 8.9 Configuration management | All settings come from environment variables and are validated at startup (the server refuses to start on bad config). `.env` files are never committed. | `config.ts`, `.gitignore` | ✅ |
| 8.31 Separation of development, test and production environments | Integration tests use their own `splitter_test` database. Each environment gets its own `.env`. | `server/tests/integration/` | ✅ |
| 8.20 Network security | The dev server and dev database listen on `127.0.0.1` only. `X-Forwarded-For` is ignored unless `TRUST_PROXY` lists the proxy's own addresses; `true` is refused, so clients can't pick their own IP to dodge rate limits. | `config.ts`, `docker-compose.yml` | ✅ |
| 8.4 Access to source code | Public repository; only the owner can write, and `main` only changes through a pull request with passing checks. | GitHub | ✅ |

### Known gaps

These are tracked as future work rather than hidden:

- **Group consent:** any member can add any registered user to a group by email, and there's no way to leave a group yet. Invitations that must be accepted, and a "leave group" action, are planned.
- **Trust in records:** any member can delete any expense in their group, and a payment is recorded by the payer without the recipient confirming it. Both are logged (`expense.deleted`, `settlement.created`). Creator-only deletes or soft deletes, and confirmed settlements, are planned.
- **Account enumeration:** login hides whether an email is registered, but sign-up (`409 EmailTaken`) and adding a member (`404 UserNotFound`) reveal it. Both are rate limited. Invitations would remove the add-member case.
- **Token lifetime and logout:** tokens last 1 day by default and can't be revoked before they expire. Short-lived tokens with a revocable refresh token, kept in an httpOnly cookie, are the next planned change.
- **Multi-factor authentication** is not available.
- **Login throttling is per IP**, not per account, so a distributed attack is only slowed by the cost of hashing.
- **Rate-limit counters are in memory**, so they reset when the server restarts and aren't shared between several server instances. A shared store (e.g. Redis) would be needed to scale out.
- **Lists aren't paginated** yet; fine at the scale of a group of friends.
- **Account deletion and data export** (PII rights) aren't implemented yet.
- **Backups, encryption at rest, TLS and log retention** depend on the hosting provider and aren't configured by this repository.
- The **CI test database image** (`postgres:17` in `ci.yml`) isn't updated by Dependabot; it is kept in step with `docker-compose.yml` by hand.

### Out of scope for a code repository

Organizational, people and physical controls (Annex A sections 5, 6 and 7), such as security policies, risk assessment, staff screening and training, supplier agreements and office security, belong to the organization running the service, not to the code.
