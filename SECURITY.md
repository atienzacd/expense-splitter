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
| 5.15 Access control · 8.3 Information access restriction | Every `/api/groups` route requires a login **and** membership of that group. Outsiders get the same `404` as for a group that doesn't exist, so ids can't be probed. Deletes are scoped to the group in the URL. A token for an account that no longer exists is rejected. Nobody joins a group without consent: members send an invitation by email, and the invited person accepts or declines it; others can't see, accept or decline it. Members can leave once their balance is zero. Members can also add **guests**: people added by name only, for friends who won't sign up. A guest has no email or password, so it can never log in; a database CHECK constraint (`users_account_or_guest`) makes it impossible to give one credentials. When the last member with an account leaves, the group and its guests are deleted. | `modules/groups/membership.ts`, `modules/auth/authenticate.ts` | ✅ (members share the group's records by design) |
| 5.17 Authentication information | Passwords are 8–128 characters and stored only as argon2id hashes. Access tokens hold only the user id. Refresh tokens are random 256-bit values, and only their SHA-256 hash is stored. Tokens are never in response bodies, only in httpOnly cookies. | `modules/auth/` | ✅ |
| 8.5 Secure authentication | argon2id with OWASP settings. Access tokens are signed JWTs with a pinned algorithm and issuer (`alg: none` rejected), last 15 minutes (at most 1 hour) and live in an httpOnly, Secure, SameSite=Strict cookie that page scripts can't read. A 14-day refresh token (at most 90) renews them and is rotated on every use; reusing an old one ends every session of that user. Logout revokes the session on the server, and because each access token names its session, it stops working at once rather than when it expires. Login and sign-up are rate limited, and login answers "wrong password" and "no such account" identically, in the same time. | `modules/auth/` | 🟡 no MFA; sign-up reveals whether an email is registered |
| 8.24 Use of cryptography | Node's built-in `crypto.argon2`, constant-time comparison, random salts. `JWT_SECRET` must be at least 32 characters and the server refuses to start with the example placeholder. HTTPS is provided by the hosting platform; HSTS is sent. | `modules/auth/password.ts`, `config.ts` | ✅ / ⬜ TLS |

### Logging and monitoring

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.15 Logging | Structured security events: `auth.registered`, `auth.login_succeeded`, `auth.login_failed`, `auth.token_rejected`, `auth.refresh_token_reused`, `auth.logged_out`, `request.cross_site_blocked`, `access.denied`, `rate_limit.exceeded`, `group.member_invited`, `group.member_joined`, `group.invitation_declined`, `group.invitation_cancelled`, `group.member_left`, `group.guest_added`, `group.guest_removed`, `expense.created`, `expense.deleted`, `settlement.created`. Each has the client IP and request id. | `security.ts` | ✅ |
| 8.16 Monitoring activities | Failures and denials are logged at `warn` for alerting. `GET /api/health` checks the database for uptime monitoring. Log retention and alerting rules belong to the log platform. | `security.ts`, `app.ts` | 🟡 / ⬜ retention |
| 8.11 Data masking · 8.12 Data leakage prevention · 5.34 Privacy and PII | Passwords, password hashes, tokens, auth and cookie headers are redacted from logs, up to three levels deep. Emails in logs are replaced by a fingerprint keyed with a server secret (HMAC), so someone holding only the logs can't confirm a guessed address. Responses never include password hashes. Unexpected errors return a generic message, and unknown URLs aren't echoed back. | `security.ts`, `app.ts` | ✅ |

### Secure development

| Control | How it is handled | Where | Status |
| --- | --- | --- | --- |
| 8.25 Secure development life cycle · 8.32 Change management | Work happens on feature branches and is merged through pull requests. Branch protection on `main` blocks direct pushes (including the owner's) and requires every CI check (tests on three OSes, integration tests, end-to-end tests, the Docker image build, scan and smoke test, audit, CodeQL) to pass on an up-to-date branch. No second-person approval is required: this is a one-person project. | GitHub | ✅ |
| 8.26 Application security requirements | Requests that change data are refused when the browser reports they came from another site (`Sec-Fetch-Site`) or from an origin not in `ALLOWED_ORIGINS`, on top of SameSite=Strict cookies (CSRF protection). All input is validated with Zod; request bodies are capped at 16 KB; requests time out after 30 s; every API route and unknown URL is rate limited per IP. The health check has its own higher limit and reuses its database result for 5 seconds. Login, sign-up and sending invitations have stricter limits. The database rejects non-positive amounts, zero shares and self-payments with CHECK constraints, as a backstop to the API's own checks. | `app.ts`, route modules, `prisma/migrations/` | 🟡 rate-limit counters are kept in memory per server process |
| 8.28 Secure coding | TypeScript strict mode; parameterised queries through Prisma (no SQL built from strings); security headers via Helmet; one error format that never leaks internals; corrupt stored data is reported as a logged server error, not blamed on the client. | `tsconfig.json`, `app.ts` | ✅ |
| 8.29 Security testing in development and acceptance | Tests cover forged, expired and `alg: none` tokens; cookie flags; refresh rotation, reuse detection and logout revocation (including that the old access token stops working immediately); cross-site requests; invitations that answer the same for registered and unregistered emails, and that only the invited person can accept; tokens of deleted users; access by non-members on every group route; rate limits on login, sign-up, invitations and unknown URLs; spoofed `X-Forwarded-For`; log redaction including nested fields; and that an unknown account takes as long to check as a wrong password. Playwright end-to-end tests drive two real browsers through sign-up, invitations, expenses and settling up, and check the cookie flags and that a copied cookie is useless after logout. CodeQL static analysis runs on every PR and weekly. | `server/tests/`, `e2e/`, `.github/workflows/codeql.yml` | ✅ |
| 8.8 Management of technical vulnerabilities | CI fails on any high or critical `npm audit` finding for the server and client, and on any fixable high or critical vulnerability Trivy finds in the Docker image (OS packages and Node packages). Dependabot opens weekly update PRs, including for the base image. Secret scanning and push protection are enabled. | `.github/` | ✅ |
| 5.21 ICT supply chain security | Exact versions in the root `package-lock.json`, installed with `npm ci`. `strict-allow-scripts` in `.npmrc` blocks every package install script not reviewed in `allowScripts` (currently all three are denied). GitHub Actions are pinned to commit SHAs. Release candidates are avoided; dependencies are few and well maintained. | `.npmrc`, `package.json`, `.github/workflows/` | ✅ |
| 8.9 Configuration management | All settings come from environment variables and are validated at startup (the server refuses to start on bad config). `.env` files are never committed or copied into the image. The Docker image holds only production dependencies and built files (no npm, compilers or source), runs as a non-root user, and Compose runs it with a read-only filesystem and `no-new-privileges`; migrations run in a separate one-off container. | `config.ts`, `.gitignore`, `.dockerignore`, `Dockerfile`, `docker-compose.yml` | ✅ |
| 8.31 Separation of development, test and production environments | Integration tests use their own `splitter_test` database. Each environment gets its own `.env`. | `server/tests/integration/` | ✅ |
| 8.20 Network security | The dev server and dev database listen on `127.0.0.1` only. `X-Forwarded-For` is ignored unless `TRUST_PROXY` lists the proxy's own addresses. `true`, invalid addresses and ranges wider than /8 (IPv4) or /16 (IPv6) such as `0.0.0.0/0` are refused, so clients can't pick their own IP to dodge rate limits. | `config.ts`, `docker-compose.yml` | ✅ |
| 8.4 Access to source code | Public repository; only the owner can write, and `main` only changes through a pull request with passing checks. | GitHub | ✅ |

### Known gaps

These are tracked as future work rather than hidden:

- **Account enumeration:** login and invitations hide whether an email is registered, but sign-up (`409 EmailTaken`) reveals it, which is common for sign-up forms. It is rate limited. Confirming emails before creating an account would remove it.
- **Multi-factor authentication** is not available.
- **Login throttling is per IP**, not per account, so a distributed attack is only slowed by the cost of hashing.
- **Rate-limit counters are in memory**, so they reset when the server restarts and aren't shared between several server instances. A shared store (e.g. Redis) would be needed to scale out.
- **Lists aren't paginated** yet; fine at the scale of a group of friends.
- **Account deletion and data export** (PII rights) aren't implemented yet.
- **Backups, encryption at rest, TLS and log retention** depend on the hosting provider and aren't configured by this repository.
- The **CI test database image** (`postgres:17` in `ci.yml`) isn't updated by Dependabot; it is kept in step with `docker-compose.yml` by hand.

### Design decisions

- **Group members trust each other with the group's records.** Any member can delete any expense in their group, and a payment counts as soon as the payer records it, without the recipient confirming. This keeps the app as simple as a shared notebook among friends. Every change is still in the security log with who made it (`expense.created`, `expense.deleted`, `settlement.created`), which serves as the audit trail. Membership requires consent (an accepted invitation), so only people who agreed to join share this trust.
- **Members record payments for guests.** Guests can't log in, so any member with an account can record a payment a guest made, including from one guest to another. Nobody can record a payment on behalf of someone who has an account (`403 NotYourPayment`); they record their own. Each such payment is logged with both the payer and the member who recorded it (`fromUserId`, `byUserId`).
- **A guest who signs up later stays a separate person.** Their guest entry keeps its history; it is not linked to the new account, since nothing proves the account belongs to the same person.

### Out of scope for a code repository

Organizational, people and physical controls (Annex A sections 5, 6 and 7), such as security policies, risk assessment, staff screening and training, supplier agreements and office security, belong to the organization running the service, not to the code.
