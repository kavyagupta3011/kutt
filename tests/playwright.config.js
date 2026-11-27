// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 2,              // auto-recover from one-off blips (server restart, Neon latency)
  fullyParallel: false,          // shared DB -> avoid races for now
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Microsoft Edge is already installed and signed, so Application Control
    // won't block it the way it blocked the SQLite binary.
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
});
