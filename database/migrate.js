/* ============================================================================
 * ERP Migration Runner
 * Reads .sql files in lexical order from this directory and applies them
 * idempotently. Records applied scripts in dbo._migrations.
 *
 * Usage:
 *   node migrate.js            # apply migrations 001, 002, 003, ...
 *   node migrate.js --seed     # same, but also run 9xx_seed_*.sql scripts
 *                               (002 and 003 are seeds too — kept as 0xx
 *                                for legacy reasons; --seed runs any
 *                                9xx_seed scripts added later)
 *
 * Reads DB credentials from ../Backend/.env (or DATABASE_URL if set).
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
function loadEnv() {
    const envPath = process.env.ENV_FILE
        || path.join(__dirname, '..', 'Backend', '.env');
    if (fs.existsSync(envPath)) {
        const txt = fs.readFileSync(envPath, 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!m) continue;
            let v = m[2].replace(/^['"]|['"]$/g, '');
            if (!process.env[m[1]]) process.env[m[1]] = v;
        }
    }
}
loadEnv();

const config = {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_DATABASE || 'erp',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() === 'true',
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT || '60000', 10),
    },
    pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000,
    },
};

// ---------------------------------------------------------------------------
// Split a T-SQL script on GO boundaries (sqlcmd-style batch separator)
// Returns array of { sql: string } batches.
// ---------------------------------------------------------------------------
function splitBatches(scriptText) {
    const batches = [];
    const lines = scriptText.split(/\r?\n/);
    let current = [];
    for (const line of lines) {
        if (/^\s*GO\s*$/i.test(line)) {
            if (current.length > 0) {
                batches.push(current.join('\n'));
                current = [];
            }
            continue;
        }
        current.push(line);
    }
    if (current.length > 0) batches.push(current.join('\n'));
    return batches;
}

// ---------------------------------------------------------------------------
// Apply one .sql file (idempotently)
// ---------------------------------------------------------------------------
async function applyScript(pool, filePath, scriptName) {
    const txc = await pool.transaction();
    try {
        // Check if already applied
        const already = await txc.request()
            .input('name', sql.VarChar, scriptName)
            .query('SELECT 1 FROM dbo._migrations WHERE script_name = @name');
        if (already.recordset.length > 0) {
            console.log(`  [skip] ${scriptName} already applied`);
            await txc.rollback();
            return false;
        }

        const text = fs.readFileSync(filePath, 'utf8');
        const batches = splitBatches(text);

        for (let i = 0; i < batches.length; i++) {
            const b = batches[i].trim();
            if (!b) continue;
            try {
                await txc.request().batch(b);
            } catch (err) {
                // Re-raise with batch number for clarity
                const msg = `Batch ${i + 1} of ${scriptName} failed: ${err.message}`;
                throw new Error(msg);
            }
        }

        await txc.request()
            .input('name', sql.VarChar, scriptName)
            .query('INSERT INTO dbo._migrations (script_name) VALUES (@name)');
        await txc.commit();
        console.log(`  [ok]   ${scriptName} applied`);
        return true;
    } catch (err) {
        try { await txc.rollback(); } catch (_) {}
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
    const args = process.argv.slice(2);
    const includeSeeds = args.includes('--seed');

    console.log('ERP Migration Runner');
    console.log('Connecting to SQL Server at', config.server, ':', config.port, '/', config.database);

    let pool;
    try {
        pool = await sql.connect(config);
    } catch (err) {
        console.error('Cannot connect to SQL Server:', err.message);
        console.error('Check DB_SERVER, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD in Backend/.env');
        process.exit(1);
    }

    // Ensure _migrations table exists (so we can run on a fresh DB before 001)
    try {
        await pool.request().batch(`
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '_migrations')
            CREATE TABLE dbo._migrations (
                id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK__migrations PRIMARY KEY,
                script_name VARCHAR(200) NOT NULL,
                applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT UQ_migrations_script UNIQUE (script_name)
            );
        `);
    } catch (err) {
        console.error('Cannot create _migrations tracking table:', err.message);
        process.exit(1);
    }

    // List .sql files in lexical order
    const files = fs.readdirSync(__dirname)
        .filter(f => f.endsWith('.sql'))
        .filter(f => includeSeeds || !/^9\d\d_.*seed/i.test(f))
        .sort();

    if (files.length === 0) {
        console.log('No .sql files found in', __dirname);
        await pool.close();
        return;
    }

    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const f of files) {
        const filePath = path.join(__dirname, f);
        try {
            const did = await applyScript(pool, filePath, f);
            if (did) applied++; else skipped++;
        } catch (err) {
            console.error(`  [fail] ${f}:`, err.message);
            failed++;
            break;
        }
    }

    console.log('\nMigration summary:');
    console.log(`  applied: ${applied}`);
    console.log(`  skipped: ${skipped}`);
    console.log(`  failed:  ${failed}`);

    await pool.close();
    process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
    console.error('Migration runner crashed:', err);
    process.exit(1);
});
