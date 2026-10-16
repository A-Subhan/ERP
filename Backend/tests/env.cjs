/* Runs inside each jest worker BEFORE test modules load, so the backend
 * config picks up the test database. dotenv does not override existing vars. */
process.env.DB_SERVER = 'localhost';
process.env.DB_PORT = '1433';
process.env.DB_DATABASE = 'erp_test';
process.env.DB_USER = 'sa';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || '';
process.env.DB_ENCRYPT = 'false';
process.env.DB_TRUST_SERVER_CERTIFICATE = 'true';
