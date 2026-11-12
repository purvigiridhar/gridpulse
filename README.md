# GridPulse: Smart Micro-Grid & P2P Energy Trading Hub

Next.js 14 (App Router) + NextAuth + MySQL 8 (trades, wallets, pricing) + MongoDB 6 (meter telemetry).

## Prerequisites
- Node.js 18.17+ (20 LTS recommended)
- MySQL 8.0.16+ running locally (CHECK constraints are enforced from 8.0.16)
- MongoDB 6.0+ running locally

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment: open .env.local and set MYSQL_PASSWORD
#    (a fresh copy of the template is in .env.example)

# 3. Create and seed the MySQL database (use the mysql CLI; the files use DELIMITER)
mysql -u root -p < schema.sql
mysql -u root -p < seed.sql

# 4. Seed MongoDB telemetry (creates indexes + one batch of pings)
npm run seed:telemetry:once
#    Optional, in a second terminal: continuous pings every 10 s
npm run seed:telemetry

# 5. Run the app
npm run dev        # http://localhost:3000
```

## Demo accounts (password: `password123`)
| Role | Email | Meter |
|------|-------|-------|
| ADMIN | admin@gridpulse.io | n/a |
| PROSUMER | rajesh@gmail.com | MTR-IND-001 (Indiranagar) |
| PROSUMER | ananya@gmail.com | MTR-IND-002 (Indiranagar) |
| PROSUMER | vikram@gmail.com | MTR-KOR-003 (Koramangala) |

## Things to try
- **Prosumer:** log in as Rajesh, buy energy from MTR-IND-002 or MTR-KOR-003, watch the wallet, ledger and live chart update.
- **Admin:** log in as admin, set the Surge Simulator above 80% for a node and record a snapshot. The tariff goes ₹5.00 → ₹6.25. Below 50% it resets; 50-80% leaves it unchanged. Then buy from a seller on that node as a prosumer and see the surge rate applied.

## Troubleshooting
- **`ER_ACCESS_DENIED_ERROR`**: wrong `MYSQL_USER` / `MYSQL_PASSWORD` in `.env.local`.
- **"Telemetry store temporarily unavailable"**: MongoDB isn't running or `MONGODB_URI` is wrong.
- **Empty chart**: run `npm run seed:telemetry` so pings exist for the meter (the chart shows the latest 30).
- **Re-running `schema.sql`**: it's not fully idempotent (indexes). To reset: `DROP DATABASE gridpulse_db;` then run both SQL files again.
- **Changed `.env.local`?** Restart `npm run dev`.
- **`next build` / `next start`** need all env vars present at build time too (the DB libs validate them on load).

## Project layout
`app/` pages and API routes · `components/` shared UI · `lib/` DB pools, auth, helpers · `scripts/` telemetry simulator · `schema.sql`, `seed.sql` database.
