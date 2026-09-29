/** @type {import('jest').Config} */
module.exports = {
  displayName: "unit",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/unit"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/tests/setup/console.silence.setup.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.base.json" }],
  },
  moduleNameMapper: {
    "^@libs/domain$": "<rootDir>/libs/domain/src/index.ts",
    "^@libs/domain/(.*)$": "<rootDir>/libs/domain/src/$1",
  },
};
