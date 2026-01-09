module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: ['./tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  forceExit: true,
};
