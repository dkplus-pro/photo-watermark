/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  collectCoverageFrom: [
    "scripts/**/*.sh",
    "packages/**/*.{js,cjs,mjs,ts,tsx}",
    "!**/node_modules/**"
  ],
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/jest/**/*.test.cjs"],
  verbose: true,
  watchPathIgnorePatterns: ["<rootDir>/.omx/"]
};
