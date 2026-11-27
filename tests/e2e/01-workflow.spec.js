// Suite 1 - Positive end-to-end workflow (the core "DB updates" requirement)
// login -> create link -> visit -> visit_count++ -> edit -> delete -> logout
// Every step is checked against the Neon database (the "database oracle").

const { test, expect } = require("@playwright/test");
const db = require("../lib/db");
const accounts = require("../lib/accounts");

// small helper: poll the DB until a condition is met (for async updates)
async function waitForRow(sql, params, predicate, tries = 15, delayMs = 400) {
  for (let i = 0; i < tries; i++) {
    const rows = await db.query(sql, params);
    if (predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return db.query(sql, params); // final attempt, let the assertion report it
}

async function login(page, { email, password }) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  // wait for the actual login request so we don't race the htmx redirect
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST"
    ),
    page.click('#login-signup button[type="submit"]'),
  ]);
  expect(res.ok(), "login request should succeed").toBeTruthy();
  await page.goto("/");
  await expect(page.getByText("Log out")).toBeVisible({ timeout: 15000 });
}

test.describe("Suite 1: positive end-to-end workflow", () => {
  const unique = Date.now();
  const target = `https://example.com/kutt-e2e-${unique}`;
  let slug, uuid, userId;

  test("full link lifecycle with DB checks", async ({ page, context }) => {
    // --- get the user's DB id up front ---
    const [u] = await db.query("select id from users where email = $1", [
      accounts.user.email,
    ]);
    userId = u.id;

    // 1. LOGIN (UI)
    await test.step("login as user", async () => {
      await login(page, accounts.user);
    });

    // 2. CREATE a link (UI)
    await test.step("create a short link", async () => {
      await page.goto("/");
      await page.fill("#target", target);
      await page.click("#shortener-form button.submit");

      // DB oracle: the link row must exist and belong to this user
      const rows = await waitForRow(
        "select address, uuid, user_id, target from links where target = $1",
        [target],
        (r) => r.length === 1
      );
      expect(rows.length).toBe(1);
      slug = rows[0].address;
      uuid = rows[0].uuid;
      expect(rows[0].user_id).toBe(userId);

      // UI reflects it: the generated slug is shown on the page
      await expect(page.locator("h1.link")).toContainText(slug);
    });

    // 3. VISIT the short link -> should redirect to the target
    await test.step("visit the short link and count the visit", async () => {
      const visitor = await context.newPage();
      await visitor.goto(`/${slug}`, { waitUntil: "commit" });
      expect(visitor.url()).toContain("example.com");
      await visitor.close();

      // DB oracle: visit_count is incremented (recorded asynchronously)
      const rows = await waitForRow(
        "select visit_count from links where uuid = $1",
        [uuid],
        (r) => r.length === 1 && Number(r[0].visit_count) >= 1
      );
      expect(Number(rows[0].visit_count)).toBeGreaterThanOrEqual(1);
    });

    // 4. EDIT the link (real API endpoint the UI edit button calls)
    await test.step("edit the link description", async () => {
      const newDesc = `edited-by-test-${unique}`;
      const res = await page.request.patch(`/api/links/${uuid}`, {
        form: { description: newDesc },
      });
      expect(res.ok()).toBeTruthy();

      const rows = await waitForRow(
        "select description from links where uuid = $1",
        [uuid],
        (r) => r.length === 1 && r[0].description === newDesc
      );
      expect(rows[0].description).toBe(newDesc);
    });

    // 5. DELETE the link (real API endpoint the UI delete button calls)
    await test.step("delete the link", async () => {
      const res = await page.request.delete(`/api/links/${uuid}`);
      expect(res.ok()).toBeTruthy();

      const rows = await waitForRow(
        "select 1 from links where uuid = $1",
        [uuid],
        (r) => r.length === 0
      );
      expect(rows.length).toBe(0);
    });

    // 6. LOGOUT (UI)
    await test.step("logout", async () => {
      await page.goto("/logout");
      await page.goto("/");
      await expect(page.getByText("Log in / Sign up")).toBeVisible();
    });
  });

  test.afterAll(async () => {
    // safety cleanup in case a step failed mid-way (shared DB)
    await db.query("delete from links where target like $1", [
      `https://example.com/kutt-e2e-%`,
    ]);
    await db.close();
  });
});
