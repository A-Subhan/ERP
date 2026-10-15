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

> **Read this carefully.** The scripts must be run in the order below. Skipping the database-creation script is the most common cause of "invalid object name" errors.

1. **Create the database.** Open SQL Server Management Studio (or Azure Data Studio), connect to your SQL Server, and run:
   ```
   database/000_create_db.sql
   ```
   This creates the `erp` database if it doesn't already exist and switches the session into it. If you connect to SQL Server with a default database other than `master`, prepend `USE master; GO` before running.

2. **Apply the schema.** Run:
   ```
   database/001_schema.sql
   ```
   This creates 30+ tables, 9 invariant-enforcing triggers, ~25 indexes, and the `_migrations` tracking table. All object-creation statements are guarded with `IF NOT EXISTS`, so re-running is safe.

3. Copy `Backend/.env.example` to `Backend/.env` and set the SQL Server connection values:
   ```
   DB_SERVER=localhost
   DB_PORT=1433
   DB_DATABASE=erp
   DB_USER=sa
   DB_PASSWORD=YourStrong!Passw0rd
   ```
   Also set a strong `SESSION_SECRET` (32+ chars) and `CSRF_SECRET` (32+ chars).

4. **Run first-time setup.** From the `Backend/` directory:
   ```
   npm install
   npm run build
   npm run setup      # interactive — enters company, first branch, first fiscal year, first admin
   ```
   This inserts the singleton `settings` row, the first fiscal year, the first branch, and the first admin account. The `settings` row is required before the Chart of Accounts seed can map accounts.

5. **Seed the Chart of Accounts and units.** Back in your SQL client, run:
   ```
   database/002_seed_coa.sql
   database/003_seed_units.sql
   ```
   `002_seed_coa.sql` creates the 25+ starter accounts under the five natures and pre-maps all the required accounts (default cash, default bank, sales, sales returns, output/input sales tax, inventory, COGS, GRN clearing, purchase price variance, stock adjustment). `003_seed_units.sql` creates PCS, KG, BOX, METER.

   **If you run `002_seed_coa.sql` before first-time setup**, it will print a clear "skipping" message and exit without raising an error. Run the Node setup, then re-run `002_seed_coa.sql`.

6. **(Optional) Re-run via the Node migration runner.** Once `.env` is in place, from the `database/` directory:
   ```
   npm install
   npm run migrate        # idempotent — skips already-applied scripts
   npm run migrate -- --seed
   ```
   The Node runner wraps each `.sql` file in a transaction, so a failure rolls the whole script back without leaving half-applied schema. The `_migrations` table tracks which scripts have been applied.

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

14. **Triggers use `CREATE OR ALTER TRIGGER`** (not `IF NOT EXISTS ... BEGIN CREATE TRIGGER ... END`). SQL Server requires `CREATE TRIGGER` to be the only statement in its batch — wrapping it in an `IF` block produces "Incorrect syntax near the keyword 'TRIGGER'". `CREATE OR ALTER` (SQL Server 2016 SP1+) is idempotent and is the only statement in its GO batch.

15. **`ROWVERSION` (one word) is the correct SQL Server type** for optimistic-concurrency row version columns, not `ROW_VERSION`. The schema originally had `ROW_VERSION` which produced "Cannot find data type ROW_VERSION" errors and cascaded into "invalid table" errors on every foreign key that referenced those tables. The migration runner now uses the correct `ROWVERSION` everywhere.

16. **`000_create_db.sql` creates the database itself.** The spec didn't ask for this, but running `001_schema.sql` directly against the SQL Server without first creating the database produces "invalid object name" errors on every table. Run `000_create_db.sql` first; it `USE`s the new database and subsequent scripts run against it.

17. **`002_seed_coa.sql` skips gracefully if the `settings` row doesn't exist** (prints a clear message and `RETURN`s without raising an error), instead of using `RAISERROR` severity 16. This is because the settings row is created by the Node first-time setup, not by the SQL scripts — so the user is expected to run `001` → `npm run setup` → `002` → `003`. An error-level raise would have made the Node migration runner report failure on `002` and roll back even though nothing was actually wrong.

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
