# Expense Splitter

Split shared expenses with friends, roommates or travel buddies, and see the fewest payments needed to settle up.

> 🚧 Work in progress. The core logic, database and authentication are done; the groups and expenses API is next.

## Highlights

- **Money is stored as whole centavos**, never floats, so rounding can't lose or create money. Every split adds up to the exact total.
- **Three ways to split**: equally, by exact amounts, or by percentage (up to 2 decimals). Leftover centavos are distributed with the largest remainder method.
- **Debt simplification**: if Ana owes Ben ₱500 and Ben owes Cara ₱500, the app just tells Ana to pay Cara. A greedy algorithm settles a group of _n_ people in at most _n − 1_ payments.
- **Secure authentication**: argon2id password hashing (Node's built-in implementation, OWASP settings), short-lived JWTs, rate-limited login, and identical responses and timing for "wrong password" and "no such account".
- **Tested at two levels**: fast unit tests on Linux, Windows and macOS, plus integration tests against a real PostgreSQL database in CI.
- **Dependency security**: CI fails on any high or critical `npm audit` finding, Dependabot opens weekly update PRs, and package install scripts are blocked unless explicitly allowed.

## Tech stack

Node.js 26 · TypeScript · Fastify · Prisma · PostgreSQL · Zod · Vitest · Docker · GitHub Actions

## Getting started

Requirements: Node.js 26+ and Docker.

```bash
docker compose up -d db          # start PostgreSQL
cd server
cp .env.example .env             # local settings; set your own JWT_SECRET
npm ci
npm run db:migrate               # create the tables
npm run db:generate              # generate the typed database client
npm test                         # unit tests
npm run test:integration         # tests against a separate splitter_test database
npm run dev                      # http://127.0.0.1:3000/health
```

`npm run dev` runs the TypeScript source directly with Node's built-in type stripping and restarts on save. Browse the data with `npm run db:studio`.

## API

| Method | Path             | Auth | Description                          |
| ------ | ---------------- | ---- | ------------------------------------ |
| GET    | `/health`        | –    | Server and database status           |
| POST   | `/auth/register` | –    | Create an account, returns a token   |
| POST   | `/auth/login`    | –    | Log in, returns a token              |
| GET    | `/auth/me`       | ✔    | The logged-in user                   |

Send the token as `Authorization: Bearer <token>`. Errors always look like `{ "error": "EmailTaken", "message": "..." }`.

## Roadmap

- [x] Split and settlement logic with tests
- [x] Database schema (Prisma) and Fastify server
- [x] Authentication (register, login, JWT)
- [ ] Groups, expenses and balances API
- [ ] React frontend
- [ ] Docker image (amd64 + arm64), image scanning, live demo
