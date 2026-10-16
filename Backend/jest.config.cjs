/** Jest runs against a real SQL Server test database (erp_test),
 *  created and dropped by the global setup/teardown. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true, target: 'ES2022', module: 'commonjs', resolveJsonModule: true } }],
  },
  testTimeout: 120000,
  maxWorkers: 1,
  forceExit: true,
  setupFiles: ['<rootDir>/tests/env.cjs'],
  globalSetup: '<rootDir>/tests/global-setup.cjs',
  globalTeardown: '<rootDir>/tests/global-teardown.cjs',
};
