/** @type {import('jest').Config} */
module.exports = {
  displayName: "integration",
  preset: "ts-jest",
  testEnvironment: "node",
  /** Single worker: shared LocalStack DynamoDB + table state would otherwise race across files. */
  maxWorkers: 1,
  roots: ["<rootDir>/tests/integration"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  setupFiles: ["<rootDir>/tests/setup/test.env.setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup/console.silence.setup.ts"],
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.base.json" }],
  },
  moduleNameMapper: {
    "^@libs/domain$": "<rootDir>/libs/domain/src/index.ts",
    "^@libs/domain/(.*)$": "<rootDir>/libs/domain/src/$1",
  },
};
