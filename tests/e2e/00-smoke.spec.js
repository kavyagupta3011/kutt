const { test, expect } = require("@playwright/test");
const db = require("../lib/db");
const accounts = require("../lib/accounts");

test.describe("Smoke: environment is wired up", () => {
  test("homepage loads in the browser", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Cut your links shorter")).toBeVisible();
  });

  test("Neon database is reachable and seed accounts exist", async () => {
    const rows = await db.query(
      "select email, role, verified from users order by id asc"
    );
    console.log("users in DB:", rows);
    const emails = rows.map((r) => r.email);

    expect(emails).toContain(accounts.admin.email); // admin@test.com
    expect(emails).toContain(accounts.user.email);  // user@test.com

    const admin = rows.find((r) => r.email === accounts.admin.email);
    expect(admin.role).toBe("ADMIN");
  });

});
