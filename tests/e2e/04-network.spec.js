// Suite 4 - Network failures (CSE731 brief: "network failures" negative cases)
//
// Each test drives the real create-link flow in the browser, injects a network
// fault with Playwright, and checks the outcome with the database oracle:
//   - a failed request must NOT create a link (no ghost/duplicate rows)
//   - a slow request must not let a double-click create two links
//   - the server/UI must stay usable after an error (no hang, no crash)
//
// Faults used:
//   abort            request never reaches the server   (page.route -> abort)
//   offline          browser has no network             (context.setOffline)
//   server 500       server returns an error            (route -> fulfill 500)
//   slow response    high latency                       (route -> delay, continue)

const { test, expect } = require("@playwright/test");
const db = require("../lib/db");
const api = require("../lib/api");
const accounts = require("../lib/accounts");

const RUN = Date.now();
let n = 0;
const nextTarget = () => `https://example.com/kutt-nf-${RUN}-${++n}`;

async function countLinks(target) {
  const rows = await db.query("select 1 from links where target = $1", [target]);
  return rows.length;
}

async function loginBrowser(context) {
  const token = await api.loginToken(accounts.user);
  await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
}

test.describe("Suite 4: network failures (create-link flow)", () => {
  test.beforeEach(async ({ context }) => {
    await loginBrowser(context);
  });

  test.afterAll(async () => {
    await db.query("delete from links where target like $1", [
      `https://example.com/kutt-nf-${RUN}-%`,
    ]);
    await db.close();
  });

  // NF-01 ------------------------------------------------------------------
  test("NF-01 aborted request creates no link and shows no success", async ({ page }) => {
    const target = nextTarget();
    await page.goto("/");
    await page.route("**/api/links", (route) => route.abort());

    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.waitForTimeout(1500);

    // DB oracle: nothing was saved
    expect(await countLinks(target)).toBe(0);
    // UI oracle: no short-url result appeared
    await expect(page.locator("#shorturl [data-url]")).toHaveCount(0);
  });

  // NF-02 ------------------------------------------------------------------
  test("NF-02 going offline during submit creates no link", async ({ page, context }) => {
    const target = nextTarget();
    await page.goto("/");
    await context.setOffline(true);

    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.waitForTimeout(1500);

    expect(await countLinks(target)).toBe(0);
    await context.setOffline(false);
  });

  // NF-03 ------------------------------------------------------------------
  test("NF-03 server 500 is handled, no link saved, app stays usable", async ({ page }) => {
    const target = nextTarget();
    await page.goto("/");
    await page.route("**/api/links", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "An error occurred." }),
      })
    );

    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.waitForTimeout(1200);

    expect(await countLinks(target)).toBe(0);

    // app still responds after the error (stop intercepting, reload)
    await page.unroute("**/api/links");
    await page.goto("/");
    await expect(page.locator("#target")).toBeVisible();
  });

  // NF-04 ------------------------------------------------------------------
  test("NF-04 slow response + double-click does not create duplicate links", async ({ page }) => {
    const target = nextTarget();
    await page.goto("/");

    // delay the create request so a second click could race it
    await page.route("**/api/links", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.click("#shortener-form button.submit").catch(() => {}); // rapid second click
    await page.waitForTimeout(3500);

    // exactly one link, not two (htmx queue:none should drop the duplicate)
    expect(await countLinks(target)).toBe(1);
  });

  // NF-05 ------------------------------------------------------------------
  test("NF-05 recovery: fails offline, succeeds once back online (no duplicate)", async ({ page, context }) => {
    const target = nextTarget();
    await page.goto("/");

    // first attempt offline -> fails
    await context.setOffline(true);
    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.waitForTimeout(1200);
    expect(await countLinks(target)).toBe(0);

    // back online -> retry succeeds
    await context.setOffline(false);
    await page.goto("/");
    await page.fill("#target", target);
    await page.click("#shortener-form button.submit");
    await page.waitForTimeout(1500);

    expect(await countLinks(target)).toBe(1);
  });

  // NF-06 ------------------------------------------------------------------
  test("NF-06 aborted login request does not log the user in", async ({ page, context }) => {
    await context.clearCookies(); // start logged out for this one
    await page.goto("/login");
    await page.route("**/api/auth/login", (route) => route.abort());

    await page.fill("#email", accounts.user.email);
    await page.fill("#password", accounts.user.password);
    await page.click('#login-signup button[type="submit"]');
    await page.waitForTimeout(1200);

    await page.unroute("**/api/auth/login");
    await page.goto("/");
    await expect(page.getByText("Log in / Sign up")).toBeVisible();
  });
});
