# Expense Splitter

Split shared expenses with friends, roommates or travel buddies, and see the fewest payments needed to settle up.

> 🚧 Work in progress. The backend API is complete; the React frontend is being built.

## Highlights

- **Money is stored as whole centavos**, never floats, so rounding can't lose or create money. Every split adds up to the exact total.
- **Three ways to split**: equally, by exact amounts, or by percentage (up to 2 decimals). Leftover centavos are distributed with the largest remainder method.
- **Debt simplification**: if Ana owes Ben ₱500 and Ben owes Cara ₱500, the app just tells Ana to pay Cara. A greedy algorithm settles a group of _n_ people in at most _n − 1_ payments.
- **Secure authentication**: argon2id password hashing (Node's built-in implementation, OWASP settings); 15-minute access tokens and rotating 14-day refresh tokens in httpOnly, SameSite=Strict cookies that page scripts can't read; real server-side logout; reuse of a stolen refresh token ends every session; cross-site request blocking; rate-limited login and sign-up; and login answers "wrong password" and "no such account" identically, in the same time.
- **ISO 27001-aligned**: the applicable Annex A technological controls (access control, secure authentication, security event logging with secret redaction, input and rate limits, vulnerability management, CodeQL scanning) are implemented and mapped in [SECURITY.md](SECURITY.md), including the known gaps.
- **Tested at two levels**: fast unit tests on Linux, Windows and macOS, plus integration tests against a real PostgreSQL database in CI.
- **Supply-chain care**: CI fails on any high or critical `npm audit` finding, Dependabot opens weekly update PRs, unreviewed package install scripts are blocked (`strict-allow-scripts`), and GitHub Actions are pinned to commit SHAs.

## Tech stack

**Server:** Node.js 26 · TypeScript · Fastify · Prisma · PostgreSQL · Zod

**Client:** React · TypeScript · Vite · React Router · TanStack Query · Zod · Tailwind CSS

**Tooling:** npm workspaces · Oxlint · Vitest · Testing Library · Docker · GitHub Actions · CodeQL

## Getting started

Requirements: Node.js 26+ and Docker.

```bash
docker compose up -d db                  # start PostgreSQL
cp server/.env.example server/.env       # local settings; set your own JWT_SECRET
npm ci                                   # installs server and client (npm workspaces)
npm run db:migrate -w server             # create the tables
npm run db:generate -w server            # generate the typed database client
npm run lint                             # Oxlint, including type-aware rules
npm test                                 # unit tests for server and client
npm run test:integration                 # API tests against a separate splitter_test database
```

Then run the API and the web app in two terminals:

```bash
npm run dev:server                       # API on http://127.0.0.1:3000/api
npm run dev:client                       # app on http://localhost:5173
```

In development the web app forwards `/api` requests to the API, so the browser talks to a single origin. (Serving the built app from the API server in production comes with the Docker milestone.) `npm run dev:server` runs the TypeScript source directly with Node's built-in type stripping and restarts on save. Browse the data with `npm run db:studio -w server`.

```
expense-splitter/
├── server/   Fastify API, Prisma schema, unit and integration tests
└── client/   React app (Vite, Tailwind), component tests
```

## API

| Method | Path                                  | Auth | Description                                       |
| ------ | ------------------------------------- | ---- | ------------------------------------------------- |
| GET    | `/api/health`                             | –    | Server and database status                        |
| POST   | `/api/auth/register`                      | –    | Create an account and log in                      |
| POST   | `/api/auth/login`                         | –    | Log in                                            |
| POST   | `/api/auth/refresh`                       | 🍪   | Renew the login (new tokens)                      |
| POST   | `/api/auth/logout`                        | 🍪   | End this device's session                          |
| GET    | `/api/auth/me`                            | ✔    | The logged-in user                                |
| GET    | `/api/groups`                             | ✔    | Groups you belong to                              |
| POST   | `/api/groups`                             | ✔    | Create a group (you become its first member)      |
| GET    | `/api/groups/:groupId`                    | ✔    | Group details and members                         |
| POST   | `/api/groups/:groupId/members`            | ✔    | Add someone by email                              |
| GET    | `/api/groups/:groupId/expenses`           | ✔    | Expenses, newest first                            |
| POST   | `/api/groups/:groupId/expenses`           | ✔    | Add an expense (equal, exact or percentage split) |
| DELETE | `/api/groups/:groupId/expenses/:expenseId`| ✔    | Delete an expense                                 |
| GET    | `/api/groups/:groupId/balances`           | ✔    | Each member's balance and the fewest payments     |
| GET    | `/api/groups/:groupId/settlements`        | ✔    | Recorded payments, newest first                   |
| POST   | `/api/groups/:groupId/settlements`        | ✔    | Record a payment you made to a member             |

Logging in sets two httpOnly cookies: a 15-minute access token sent with every API request, and a refresh token (🍪) that `/api/auth/refresh` exchanges for new ones. Tokens never appear in response bodies. Requests that change data from other websites are refused. All amounts are **whole centavos** (₱150.75 → `15075`). Errors always look like `{ "error": "EmailTaken", "message": "..." }`. Only members can see or change a group; to anyone else it returns the same 404 as a group that doesn't exist.

Adding an expense:

```json
{
  "description": "Dinner",
  "amount": 300000,
  "paidById": "optional, defaults to you",
  "split": { "type": "EQUAL" }
}
```

`split` can also be `{ "type": "EQUAL", "userIds": [...] }`, `{ "type": "EXACT", "shares": [{ "userId": "...", "amount": 1000 }] }` or `{ "type": "PERCENTAGE", "shares": [{ "userId": "...", "percent": 33.33 }] }`.

## Roadmap

- [x] Split and settlement logic with tests
- [x] Database schema (Prisma) and Fastify server
- [x] Authentication (register, login, JWT)
- [x] Groups, expenses and balances API
- [ ] React frontend (in progress: app shell, theme switch, log in / sign up with automatic session renewal done)
- [ ] Docker image (amd64 + arm64), image scanning, live demo

## License

[MIT](LICENSE)
