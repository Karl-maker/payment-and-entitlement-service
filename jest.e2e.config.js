/** @type {import('jest').Config} */
module.exports = {
  displayName: "e2e",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/e2e"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  setupFiles: ["<rootDir>/tests/setup/test.env.setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup/console.silence.setup.ts"],
  testTimeout: 60000,
  /** Run e2e test files serially so shared LocalStack resources are not torn down mid-run. */
  maxWorkers: 1,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.base.json" }],
  },
  moduleNameMapper: {
    "^@libs/domain$": "<rootDir>/libs/domain/src/index.ts",
    "^@libs/domain/(.*)$": "<rootDir>/libs/domain/src/$1",
  },
};
