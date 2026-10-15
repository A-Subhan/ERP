# ERP

A small ERP (Finance, Inventory, Sales, Purchase) built with Node.js + Express + TypeScript on the backend, React + Vite on the frontend, and Microsoft SQL Server 2019+ as the database. Designed to look like a calm, professional accounting application — not an AI-generated template.

> ⚠️ **Honest scope note.** This commit contains the foundation of the ERP: the full SQL Server schema with all constraints and triggers required by the spec, the migration runner, the backend skeleton with session auth / CSRF / permissions / audit / hierarchical codes, and the frontend skeleton with the design system, sidebar layout, and CRUD screens for Branches, Users, Chart of Accounts and Units (plus Login + Setup). The remaining voucher, inventory, sales and purchase screens follow the same patterns established here. Do not assume the whole ERP is finished because of this commit. See **Roadmap** below.

---

## Folder layout

```
erp/
├── Backend/                 Node.js + Express + TypeScript
│   ├── src/
│   │   ├── config/          env-driven config
│   │   ├── db/              SQL Server pool + transaction helper
│   │   ├── middleware/      auth, CSRF, validate, error, session loader
│   │   ├── routes/          auth, branches, units, accounts, users
│   │   ├── services/        business logic (one file per domain)
│   │   ├── utils/           counter, doc numbering, hierarchy, audit, logger
│   │   └── index.ts         entry — express app
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── Frontend/                React 18 + Vite + TypeScript
│   ├── src/
│   │   ├── api/             fetch wrapper + types
│   │   ├── components/      Layout, Toast
│   │   ├── pages/           Login, Setup, Dashboard, Branches, Units,
│   │   │                    ChartOfAccounts, Users, DefaultPage, NotFound
│   │   └── styles/          global.css (design system)
│   ├── vite.config.ts
│   └── package.json
├── database/
│   ├── 001_schema.sql       full schema (tables, triggers, indexes)
│   ├── 002_seed_coa.sql     starter Chart of Accounts + mapped accounts
│   ├── 003_seed_units.sql   starter units (PCS, KG, BOX, METER)
│   └── migrate.js           Node migration runner (idempotent)
├── scripts/
│   └── install-service.ps1  install backend as a Windows service via nssm
├── web.config               IIS reverse-proxy config (URL Rewrite + ARR)
├── .gitignore
└── README.md                (this file)
```

## Prerequisites

- Node.js 20 LTS
- Microsoft SQL Server 2019 or later (Developer edition is fine)
- Windows + IIS for production deployment (optional)

## Database setup

1. Create an empty database on your SQL Server:
   ```sql
   CREATE DATABASE erp;
   ```
2. Copy `Backend/.env.example` to `Backend/.env` and set the SQL Server connection values:
   ```
   DB_SERVER=localhost
   DB_PORT=1433
   DB_DATABASE=erp
   DB_USER=sa
   DB_PASSWORD=YourStrong!Passw0rd
   ```
   Also set a strong `SESSION_SECRET` (32+ chars) and `CSRF_SECRET` (32+ chars).
3. From the repo root, apply migrations and seeds:
   ```
   cd database
   npm install
   npm run migrate
   ```
   This runs `001_schema.sql`, `002_seed_coa.sql` and `003_seed_units.sql` idempotently.
   Re-running `npm run migrate` will skip already-applied scripts.

## Backend

```
cd Backend
cp .env.example .env       # edit values
npm install
npm run build
npm start                  # http://127.0.0.1:4000
# or for development:
npm run dev                # tsx watch
```

The backend verifies SQL Server connectivity on startup. If the connection fails, the process exits with a clear message.

## Frontend

```
cd Frontend
npm install
npm run dev                # http://localhost:5173 (proxies /api to :4000)
# production build:
npm run build              # writes Frontend/dist
```

In production the Node backend serves `Frontend/dist` at the root path, so you do not need a separate static server. The Vite dev server is for development only.

## First-time setup

1. Open the app in the browser. If setup has not been completed, you will be redirected to `/setup`.
2. Enter:
   - Company name and company ID (these cannot be changed from the UI after this step)
   - First branch name and short name (used in voucher numbers, e.g. `HO/SI/27/000001`)
   - First fiscal year name, start and end date
   - First admin username, full name and password (8+ chars)
3. Submit. You will be signed in as the admin automatically.

After setup, the seeded Chart of Accounts (run earlier via `npm run migrate`) is available in **Finance → Chart of Accounts**.

## IIS deployment

1. Install IIS with **URL Rewrite 2.x** and **Application Request Routing (ARR) 3.0**.
2. Build the backend (`cd Backend && npm run build`) and the frontend (`cd Frontend && npm run build`).
3. Install the backend as a Windows service via nssm:
   ```powershell
   .\scripts\install-service.ps1 -BackendDir "C:\erp\Backend" -ServiceName "ERP"
   ```
4. Create an IIS site that points to the repo root, place `web.config` at the site root, and the URL Rewrite rule will proxy all non-file requests to the Node service on `127.0.0.1:4000`. IIS serves `Frontend/dist` static files directly.

## Default login

There is **no default login**. The first-time setup creates the first admin account with credentials you choose. No hard-coded passwords exist anywhere in the codebase.

## Tests

Run from `Backend/`:

```
npm test
```

Tests use Jest + supertest against a real SQL Server test database (use the Docker image `mcr.microsoft.com/mssql/server:2022-latest` if you don't have one). The current commit includes the test runner configuration; additional integration tests are being added as each module is wired.

## Decisions

This section records choices made when the spec left a detail open, per the brief's instruction to "choose the simpler and safer option and record it".

1. **SQL Server has no DEFERRED constraints.** Voucher-line balancing and per-voucher GL balancing are enforced via `AFTER INSERT/UPDATE/DELETE` triggers that `RAISERROR` and `ROLLBACK` the statement, rather than at-commit-time deferred checks. This guarantees a transaction can never be committed with an unbalanced voucher.

2. **`_migrations` table is created by the migration runner before `001_schema.sql` runs.** This avoids a chicken-and-egg failure when running migrations on a fresh database. The `001_schema.sql` script itself also contains a `IF NOT EXISTS` guard for the same table, so the two paths are compatible.

3. **`voucher_lines.bill_id` references `bills`, which is defined *after* `voucher_lines` in `001_schema.sql`.** SQL Server requires the referenced object to exist at `CREATE TABLE` time, so the FK is created without the reference first, then dropped and recreated with the proper reference after `bills` exists.

4. **Master ID counter and document numbering counter are stored in separate tables** (`master_counter` and `doc_number_counter`) because they have different shapes and lock patterns. Both are incremented inside the parent transaction with `UPDLOCK, HOLDLOCK` to prevent two concurrent writers from receiving the same number.

5. **CSRF token is double-submit (header + HMAC bound to session id).** Simpler than synchroniser-token for an SPA, still safe under HTTPS + `SameSite=Lax` cookies, and the failure mode (token rejected with a clear "refresh the page" message) is user-friendly.

6. **Setup endpoint opts out of CSRF** via the `skipCsrf` middleware, because no session exists yet at first-run. After setup, every mutating endpoint requires a valid CSRF token.

7. **Branch / Store / Product / Chart of Accounts codes are stored as `VARCHAR`** so leading zeros are preserved exactly as the user-level digit settings dictate. The hierarchy code generator reads the per-hierarchy digit-per-level settings from the `settings` row, computes the next serial under `UPDLOCK, HOLDLOCK` on the relevant table, and pads with zeros to the configured width.

8. **No external CSS framework is used.** A single `global.css` defines the design tokens and component classes. This matches the spec's "do not use a component kit that gives a generic look" rule and keeps the bundle small.

9. **`argon2` (argon2id) for password hashing**, configurable rounds via `BCRYPT_ROUNDS` env var (kept the env name for compatibility — it's actually the argon2 memory/time cost).

10. **The Default Page tabs are scaffolded** with the three required tab headings (General, Finance & Account Mapping, Print). The full form fields for each tab — editable hierarchy digits, mapped account pickers, fiscal years list, aging buckets, print layout preview — are wired next, after the voucher and stock modules, so the form is exercised against real data rather than mocked.

11. **Login throttling: 5 consecutive failures locks the account for 15 minutes**, tracked in the `users` table. The spec asked for "rate limit on login"; this gives account-level throttling, while a request-level rate limiter (configured in `src/index.ts`) protects the endpoint itself from brute-force storms.

12. **`sys.triggers` `IF NOT EXISTS` guards** make every script idempotent so the migration runner can be safely re-run. Re-running `npm run migrate` will report `[skip]` for already-applied scripts and `[ok]` only for new ones.

13. **Audit log is append-only.** An `INSTEAD OF UPDATE, DELETE` trigger rejects mutations. To satisfy the spec's "restricted DB role if possible" recommendation, also grant the application a role that has `INSERT` on `audit_log` but no `UPDATE`/`DELETE`; the trigger is the belt-and-braces backstop.

## Roadmap (in progress)

Already done in this commit:

- ✅ SQL Server schema: 30+ tables, 8 enforced-invariant triggers, ~25 indexes
- ✅ Migration runner with idempotent applies and `_migrations` tracking
- ✅ Backend: layered routes/controllers/services, session auth, CSRF, permissions, audit, hierarchical code generator, master ID counter, document numbering
- ✅ Frontend: Vite + React + TypeScript, design system (Inter, slate, muted-blue accent, tabular numerals), sidebar + topbar layout, Login, Setup, Dashboard, Branches, Units, Chart of Accounts, Users, Default Page stub
- ✅ IIS `web.config` + nssm install script
- ✅ README with setup, deployment and decisions list

In progress (same patterns as above, same code shape):

- ⏳ Vouchers: CRV, CPV, BRV, BPV, JV — including tax rule, knock-off panel, cheque status flow, bank reconciliation
- ⏳ Sales: SO → DC → SI → CN with cost-of-goods and revenue postings
- ⏳ Purchase: PR → PO → RC → PI → DN with GRN clearing and PPV
- ⏳ Inventory: Product tree, opening stock, move stock, adjust stock, stock ledger, inventory report, movement report
- ⏳ Reports: General Ledger, Trial Balance, Income Statement, Balance Sheet, Aging, plus PDF / Excel / CSV / Word export
- ⏳ Dashboards: Sales, Purchase, Receivables/Payables, Stock
- ⏳ Default Page form fields (mapped account pickers, fiscal years list, aging buckets, print layout preview)
- ⏳ Audit Log viewer
- ⏳ Full integration test suite covering all 12 test categories in spec section 13

## Contributing

Internal project. Make logical commits with plain human commit messages (for example "Add chart of accounts API", "Add branch screens"). No force push to `main`.
