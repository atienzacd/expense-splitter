# Expense Splitter

Split shared expenses with friends, roommates or travel buddies, and see the fewest payments needed to settle up.

> 🚧 Work in progress. Milestone 1 (core split and settlement logic) is done.

## Highlights

- **Money is stored as whole centavos**, never floats, so rounding can't lose or create money. Every split adds up to the exact total.
- **Three ways to split**: equally, by exact amounts, or by percentage (up to 2 decimals). Leftover centavos are distributed with the largest remainder method.
- **Debt simplification**: if Ana owes Ben ₱500 and Ben owes Cara ₱500, the app just tells Ana to pay Cara. A greedy algorithm settles a group of _n_ people in at most _n − 1_ payments.
- **Runs anywhere**: CI tests every push on Linux, Windows and macOS.
- **Dependency security**: CI fails on any high or critical `npm audit` finding, and Dependabot opens weekly update PRs.

## Tech stack

Node.js 26 · TypeScript · Vitest · PostgreSQL (Docker) · GitHub Actions

## Getting started

Requirements: Node.js 26+ and Docker.

```bash
docker compose up -d db          # start PostgreSQL
cd server
cp .env.example .env             # local settings
npm ci
npm run db:migrate               # create the tables
npm run db:generate              # generate the typed database client
npm test
npm run dev                      # http://127.0.0.1:3000/health
```

`npm run dev` runs the TypeScript source directly with Node's built-in type stripping and restarts on save. Browse the data with `npm run db:studio`.

## Roadmap

- [x] Split and settlement logic with tests
- [ ] REST API (Fastify, Prisma, JWT auth)
- [ ] React frontend
- [ ] Docker image (amd64 + arm64), image scanning, live demo
