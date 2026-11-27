// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// --- Browser matrix -------------------------------------------------------
// Default: Microsoft Edge only. Edge is installed and digitally signed, so the
// lab laptop's Application Control policy allows it (it blocks Playwright's own
// unsigned browser builds, the same way it blocked the SQLite binary).
const projects = [
  { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
];

// Opt-in: also run on Google Chrome (installed + signed). Use on Windows when
// Chrome is present:   $env:CHROME=1 ; npx playwright test
if (process.env.CHROME) {
  projects.push({ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } });
}

// Opt-in: the full engine matrix with Playwright's bundled Chromium / Firefox /
// WebKit. These unsigned builds are blocked by Application Control on the lab
// laptop, so run this on a machine without that policy (e.g. WSL / Linux) after
//   npx playwright install
// then:   CROSS_BROWSER=1 npx playwright test
if (process.env.CROSS_BROWSER) {
  projects.push(
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  );
}

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 2,
  fullyParallel: false,   // shared DB -> avoid races between tests
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects,
});
