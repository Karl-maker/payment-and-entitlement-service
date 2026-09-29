const noop = (): void => undefined;

/** Set SHOW_TEST_CONSOLE=1 when running tests to print console output. */
if (process.env.SHOW_TEST_CONSOLE !== "1") {
  jest.spyOn(console, "log").mockImplementation(noop);
  jest.spyOn(console, "debug").mockImplementation(noop);
  jest.spyOn(console, "info").mockImplementation(noop);
  jest.spyOn(console, "warn").mockImplementation(noop);
  jest.spyOn(console, "error").mockImplementation(noop);
}
