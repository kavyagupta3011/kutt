// Suite 2 - Bypass testing (the required client-side technique, Deck 2)
//
// Kutt's forms have almost no client-side constraints; nearly every rule lives
// on the server (server/handlers/validators.handler.js). Bypass testing here
// means: skip the browser and send the request straight to the server, with
// input the UI would never send, and check that the server enforces its own
// rules. The three levels from the slides:
//
//   Value level          invalid values: lengths, types, formats, special chars
//   Parameter level      invalid combinations / extra / missing parameters,
//                        and DOM changes made in the real page before submitting
//   Control-flow level   steps done out of order or after they should be over
//
// Each result is classified as V1 / V2 / V3 / F / E (see lib/bypass.js), checked
// against the database, and saved to test-results/bypass-vfe.json for the report.
//
// Known Kutt defects are marked with test.fail(): the result is still
// recorded, the suite stays green, and the bug ID points to the bug report.

const { test, expect } = require("@playwright/test");
const db = require("../lib/db");
const api = require("../lib/api");
const accounts = require("../lib/accounts");
const { send, record, writeSummary } = require("../lib/bypass");

const RUN = Date.now();
const T = (s) => `https://example.com/kutt-bp-${RUN}-${s}`; // valid target with a marker
const SAFE = ["V1", "V2", "V3"]; // categories where the server handled the input safely

let userApi, adminApi, anonApi, userId;

test.beforeAll(async () => {
  userApi = await api.asUser(accounts.user);
  adminApi = await api.asUser(accounts.admin);
  anonApi = await api.anonymous();
  [{ id: userId }] = await db.query("select id from users where email = $1", [accounts.user.email]);
});

test.afterAll(async () => {
  writeSummary();
  await db.query(
    "delete from links where target like $1 or target like 'data:%' or address in ('LOGIN', 'Settings')",
    [`https://example.com/kutt-bp-${RUN}-%`]
  );
  await db.query("delete from users where email like $1", [`bp-${RUN}-%`]);
  for (const c of [userApi, adminApi, anonApi]) await c?.dispose();
  await db.close();
});

// Runs one table-driven case: send, classify, record, assert.
function caseTest(level, c) {
  test(`${c.id} ${c.title}`, async ({}, testInfo) => {
    if (c.bug) test.fail(true, c.bug);
    const ctx = c.as === "anon" ? anonApi : c.as === "admin" ? adminApi : userApi;
    const url = typeof c.url === "function" ? await c.url() : c.url;
    const r = await send(ctx, c.method || "post", url || "/api/links", c.data, {
      isExposure: c.isExposure,
    });
    record(testInfo, { id: c.id, level, ...r });

    if (c.bug) {
      // A defect is expected here: the server should still handle it safely.
      expect(SAFE, `got ${r.category}: HTTP ${r.status} ${r.message}`).toContain(r.category);
    } else {
      expect(r.category, `HTTP ${r.status} ${r.message}`).toBe(c.expect);
      if (c.message) expect(r.message).toMatch(c.message);
    }
  });
}

// ===========================================================================
// VALUE LEVEL
// ===========================================================================
test.describe("Value level", () => {
  const long = (n) => "https://example.com/" + "a".repeat(n - 20);
  const NON_UUID = "x".repeat(36); // passes Kutt's length check (36) but is not a UUID

  let ownLinkId; // a real link for the id-format cases
  test.beforeAll(async () => {
    ownLinkId = (await api.createLink(userApi, T("own"))).id;
  });

  // --- boundary controls (valid input must still be accepted) -------------
  test("BP-V00a control: target of exactly 2040 chars is accepted", async () => {
    const res = await userApi.post("/api/links", { data: { target: long(2040) } });
    expect(res.status()).toBe(201);
    await db.query("delete from links where uuid = $1", [(await res.json()).id]);
  });

  test("BP-V00b control: custom URL of exactly 64 chars is accepted", async () => {
    const slug = `bp${RUN}`.padEnd(64, "z");
    const res = await userApi.post("/api/links", { data: { target: T("v00b"), customurl: slug } });
    expect(res.status()).toBe(201);
  });

  const cases = [
    // target (the long URL)
    { id: "BP-V01", title: "target empty", data: { target: "" }, expect: "V1", message: /missing/i },
    { id: "BP-V02", title: "target 2041 chars (one over the limit)", data: { target: long(2041) }, expect: "V1", message: /2040/ },
    { id: "BP-V03", title: "target is not a URL", data: { target: "not a url" }, expect: "V1", message: /not valid/i },
    { id: "BP-V04", title: "target is a private IP (192.168.x.x)", data: { target: "http://192.168.1.1/x" }, expect: "V1", message: /not valid/i },
    { id: "BP-V05", title: "target points to Kutt itself", data: { target: "http://localhost:3000/abc" }, expect: "V1" },
    {
      id: "BP-V06", title: "target uses javascript: scheme",
      data: { target: "javascript:alert(1)" },
      bug: "BUG-BP-06: a URL with no hostname passes validation and crashes a later DB query (HTTP 500)",
    },
    {
      id: "BP-V07", title: "target uses data: scheme with a script",
      data: { target: "data:text/html,<script>alert(1)</script>" },
      bug: "BUG-BP-01: data: URLs are accepted and stored as link targets",
    },
    { id: "BP-V08", title: "target sent as a number", data: { target: 12345 }, expect: "V2" },
    { id: "BP-V09", title: "target sent as an array", data: { target: [T("arr")] }, expect: "V2" },

    // customurl (the slug)
    { id: "BP-V10", title: "custom URL 65 chars", data: { target: T("v10"), customurl: "a".repeat(65) }, expect: "V1", message: /between 1 and 64/ },
    { id: "BP-V11", title: "custom URL with <script>", data: { target: T("v11"), customurl: "<script>" }, expect: "V1", message: /not valid/i },
    { id: "BP-V12", title: "custom URL with ../ (path traversal)", data: { target: T("v12"), customurl: "../admin" }, expect: "V1", message: /not valid/i },
    { id: "BP-V13", title: "custom URL with a space", data: { target: T("v13"), customurl: "my slug" }, expect: "V1", message: /not valid/i },
    { id: "BP-V14", title: "custom URL with SQL injection", data: { target: T("v14"), customurl: "a' OR '1'='1" }, expect: "V1", message: /not valid/i },
    { id: "BP-V15", title: "custom URL with an emoji", data: { target: T("v15"), customurl: "😀" }, expect: "V1", message: /not valid/i },
    { id: "BP-V16", title: "custom URL is a reserved word (login)", data: { target: T("v16"), customurl: "login" }, expect: "V1", message: /can't use/i },
    {
      id: "BP-V17", title: "custom URL is a reserved word in capitals (LOGIN)",
      data: { target: T("v17"), customurl: "LOGIN" },
      isExposure: (rows) => rows.some((r) => r.address === "LOGIN"),
      bug: "BUG-BP-02: reserved-word check is case-sensitive; LOGIN/Settings are accepted but unreachable",
    },
    {
      id: "BP-V18", title: "custom URL is a reserved word in mixed case (Settings)",
      data: { target: T("v18"), customurl: "Settings" },
      isExposure: (rows) => rows.some((r) => r.address === "Settings"),
      bug: "BUG-BP-02: reserved-word check is case-sensitive; LOGIN/Settings are accepted but unreachable",
    },
    { id: "BP-V19", title: "custom URL sent as an object (NoSQL-style)", data: { target: T("v19"), customurl: { $gt: "" } }, expect: "V2" },

    // link password
    { id: "BP-V20", title: "link password 2 chars", data: { target: T("v20"), password: "ab" }, expect: "V1", message: /between 3 and 64/ },
    { id: "BP-V21", title: "link password 65 chars", data: { target: T("v21"), password: "p".repeat(65) }, expect: "V1", message: /between 3 and 64/ },

    // expire_in
    { id: "BP-V22", title: "expire_in 30s (under 1 minute)", data: { target: T("v22"), expire_in: "30s" }, expect: "V1", message: /more than 1 minute/ },
    { id: "BP-V23", title: "expire_in not a duration (abc)", data: { target: T("v23"), expire_in: "abc" }, expect: "V1", message: /format is invalid/i },
    { id: "BP-V24", title: "expire_in negative (-5m)", data: { target: T("v24"), expire_in: "-5m" }, expect: "V1", message: /more than 1 minute/ },
    { id: "BP-V25", title: "expire_in sent as a number", data: { target: T("v25"), expire_in: 120000 }, expect: "V2" },
    {
      id: "BP-V26", title: "expire_in absurdly large (999999999 years)",
      data: { target: T("v26"), expire_in: "999999999 years" },
      bug: "BUG-BP-03: huge expire_in passes validation and crashes the server (HTTP 500)",
    },

    // description, reuse, domain
    { id: "BP-V27", title: "description 2041 chars", data: { target: T("v27"), description: "d".repeat(2041) }, expect: "V1", message: /between 1 and 2040/ },
    { id: "BP-V28", title: "reuse is not a boolean", data: { target: T("v28"), reuse: "yes" }, expect: "V1", message: /boolean/ },
    { id: "BP-V29", title: "domain the user does not own", data: { target: T("v29"), domain: "evil.com" }, expect: "V1", message: /can't use this domain/i },

    // login / signup forms
    { id: "BP-V30", title: "login password 7 chars", as: "anon", url: "/api/auth/login", data: { email: accounts.user.email, password: "short12" }, expect: "V1", message: /between 8 and 64/ },
    { id: "BP-V31", title: "login email is not an email", as: "anon", url: "/api/auth/login", data: { email: "admin", password: accounts.admin.password }, expect: "V1", message: /not valid/i },
    { id: "BP-V32", title: "login email 256 chars", as: "anon", url: "/api/auth/login", data: { email: "a".repeat(247) + "@test.com", password: accounts.user.password }, expect: "V1", message: /max 255/ },
    { id: "BP-V33", title: "login with SQL injection in email", as: "anon", url: "/api/auth/login", data: { email: "' OR 1=1 --", password: "whatever1" }, expect: "V1", message: /not valid/i },
    { id: "BP-V34", title: "signup password 7 chars", as: "anon", url: "/api/auth/signup", data: { email: `bp-${RUN}-a@test.com`, password: "short12" }, expect: "V1", message: /between 8 and 64/ },
    { id: "BP-V35", title: "signup email is not an email", as: "anon", url: "/api/auth/signup", data: { email: "nope", password: "Longenough1" }, expect: "V1", message: /not valid/i },

    // id in the URL
    { id: "BP-V36", title: "edit with a short id (123)", method: "patch", url: "/api/links/123", data: { description: "x" }, expect: "V1", message: /ID is invalid/ },
    {
      id: "BP-V37", title: "edit with a 36-char id that is not a UUID",
      method: "patch", url: `/api/links/${NON_UUID}`, data: { description: "x" },
      bug: "BUG-BP-04: 36-char non-UUID ids pass validation and crash the Postgres query (HTTP 500)",
    },
    {
      id: "BP-V38", title: "delete with a 36-char id that is not a UUID",
      method: "delete", url: `/api/links/${NON_UUID}`,
      bug: "BUG-BP-04: 36-char non-UUID ids pass validation and crash the Postgres query (HTTP 500)",
    },
    {
      id: "BP-V39", title: "stats with a 36-char id that is not a UUID",
      method: "get", url: `/api/links/${NON_UUID}/stats`,
      bug: "BUG-BP-04: 36-char non-UUID ids pass validation and crash the Postgres query (HTTP 500)",
    },
    {
      id: "BP-V40", title: "open protected link with a 36-char id that is not a UUID",
      as: "anon", url: `/api/links/${NON_UUID}/protected`, data: { password: "abcdef" },
      bug: "BUG-BP-04: 36-char non-UUID ids pass validation and crash the Postgres query (HTTP 500)",
    },
    { id: "BP-V41", title: "edit own link with a 65-char custom URL", method: "patch", url: () => `/api/links/${ownLinkId}`, data: { address: "a".repeat(65) }, expect: "V1", message: /between 1 and 64/ },
  ];

  for (const c of cases) caseTest("value", c);
});

// ===========================================================================
// PARAMETER LEVEL
// ===========================================================================
test.describe("Parameter level", () => {
  const cases = [
    // fields the server reserves for logged-in users, sent anonymously
    { id: "BP-P01", title: "anonymous request with a custom URL", as: "anon", data: { target: T("p01"), customurl: `bp${RUN}p01` }, expect: "V1", message: /Only users/ },
    { id: "BP-P02", title: "anonymous request with a link password", as: "anon", data: { target: T("p02"), password: "secret12" }, expect: "V1", message: /Only users/ },
    { id: "BP-P03", title: "anonymous request with reuse", as: "anon", data: { target: T("p03"), reuse: true }, expect: "V1", message: /Only users/ },
    { id: "BP-P04", title: "anonymous request with a domain", as: "anon", data: { target: T("p04"), domain: "evil.com" }, expect: "V1", message: /Only users/ },
    // missing / combined parameters
    { id: "BP-P05", title: "empty request body", data: {}, expect: "V1", message: /missing/i },
    {
      id: "BP-P06", title: "differential: all fields valid except the custom URL (nothing is saved)",
      data: { target: T("p06"), description: "valid", expire_in: "2h", customurl: "bad slug" },
      expect: "V1", message: /not valid/i,
    },
    {
      id: "BP-P07", title: "extra fields on create (user_id, visit_count, banned, uuid) are ignored",
      data: { target: T("p07"), user_id: 1, visit_count: 999, banned: true, uuid: "00000000-0000-0000-0000-000000000000" },
      isExposure: (rows) =>
        rows.some((r) => r.user_id !== userId || Number(r.visit_count) !== 0 || r.banned ||
          r.uuid === "00000000-0000-0000-0000-000000000000"),
      expect: "V3",
    },
  ];
  for (const c of cases) caseTest("parameter", c);

  test("BP-P08 extra fields on edit (user_id, visit_count, banned) are ignored", async ({}, testInfo) => {
    const link = await api.createLink(userApi, T("p08"));
    const res = await userApi.patch(`/api/links/${link.id}`, {
      data: { description: "changed", user_id: 1, visit_count: 999, banned: true },
    });
    const [row] = await db.query("select user_id, visit_count, banned, description from links where uuid = $1", [link.id]);
    const exposed = row.user_id !== userId || Number(row.visit_count) !== 0 || row.banned;
    record(testInfo, { id: "BP-P08", level: "parameter", category: exposed ? "E" : "V3", status: res.status(), message: "" });
    expect(res.ok()).toBeTruthy();
    expect(row.description).toBe("changed");
    expect(exposed).toBe(false);
  });

  test("BP-P09 edit that changes nothing is rejected", async ({}, testInfo) => {
    const link = await api.createLink(userApi, T("p09"), { description: "same" });
    const r = await send(userApi, "patch", `/api/links/${link.id}`, { description: "same" });
    record(testInfo, { id: "BP-P09", level: "parameter", ...r });
    expect(r.category).toBe("V1");
    expect(r.message).toMatch(/at least update one field/i);
  });

  test("BP-P10 custom URL already taken by another user is rejected", async ({}, testInfo) => {
    const slug = `bp${RUN}taken`;
    await api.createLink(userApi, T("p10a"), { customurl: slug });
    const r = await send(adminApi, "post", "/api/links", { target: T("p10b"), customurl: slug });
    record(testInfo, { id: "BP-P10", level: "parameter", ...r });
    expect(r.category).toBe("V1");
    expect(r.message).toMatch(/already in use/i);
    const owners = await db.query("select user_id from links where address = $1", [slug]);
    expect(owners).toEqual([{ user_id: userId }]);
  });

  test("BP-P11 protected link opened with no password field", async ({}, testInfo) => {
    const link = await api.createLink(userApi, T("p11"), { password: "letmein" });
    const r = await send(anonApi, "post", `/api/links/${link.id}/protected`, {});
    record(testInfo, { id: "BP-P11", level: "parameter", ...r });
    expect(r.category).toBe("V1");
    expect(r.body.target).toBeUndefined();
  });

  test("BP-P12 protected link opened with the wrong password", async ({}, testInfo) => {
    const link = await api.createLink(userApi, T("p12"), { password: "letmein" });
    const r = await send(anonApi, "post", `/api/links/${link.id}/protected`, { password: "wrongpw" });
    record(testInfo, { id: "BP-P12", level: "parameter", ...r });
    expect(r.category).toBe("V1");
    expect(r.status).toBe(401);
    expect(r.body.target).toBeUndefined();
  });

  // --- DOM bypass: change the real page before submitting -------------------
  test("BP-P13 DOM bypass: inject a domain option the user does not own", async ({ page, context }, testInfo) => {
    const token = await api.loginToken(accounts.user);
    await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
    await page.goto("/");
    await page.fill("#target", T("p13"));
    await page.check('#shortener-form input[name="show_advanced"]');
    // The domain <select> only offers the user's own domains. Add one it doesn't.
    await page.evaluate(() => {
      const select = document.querySelector('#shortener-form select[name="domain"]');
      const opt = document.createElement("option");
      opt.value = "evil.com";
      opt.textContent = "evil.com";
      select.appendChild(opt);
      select.value = "evil.com";
    });
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/links") && r.request().method() === "POST"),
      page.click("#shortener-form button.submit"),
    ]);
    await expect(page.getByText("You can't use this domain.")).toBeVisible();
    const rows = await db.query("select 1 from links where target = $1", [T("p13")]);
    record(testInfo, { id: "BP-P13", level: "parameter", category: rows.length ? "E" : "V1", status: res.status(), message: "You can't use this domain." });
    expect(rows.length).toBe(0);
  });

  test("BP-P14 anonymous visitor fills the advanced options in the page", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.fill("#target", T("p14"));
    // The page offers the advanced options to anonymous visitors too, so the
    // server is the only thing that stops them.
    await page.check('#shortener-form input[name="show_advanced"]');
    await page.fill('#shortener-form input[name="customurl"]', `bp${RUN}p14`);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/links") && r.request().method() === "POST"),
      page.click("#shortener-form button.submit"),
    ]);
    await expect(page.getByText("Only users can use this field.").first()).toBeVisible();
    const rows = await db.query("select 1 from links where target = $1", [T("p14")]);
    record(testInfo, { id: "BP-P14", level: "parameter", category: rows.length ? "E" : "V1", status: res.status(), message: "Only users can use this field." });
    expect(rows.length).toBe(0);
  });
});

// ===========================================================================
// CONTROL-FLOW LEVEL
// ===========================================================================
test.describe("Control-flow level", () => {
  // helper: an unverified user created by the admin (no email needed)
  async function unverifiedUser(tag) {
    const email = `bp-${RUN}-${tag}@test.com`;
    const password = "Unverified1";
    const res = await adminApi.post("/api/users/admin", { data: { email, password, verified: false } });
    expect(res.status(), await res.text()).toBe(201);
    return { email, password };
  }

  // helper: give a user a verification token directly in the DB
  // (a whole day either way, so database time-zone settings can't matter)
  async function setVerificationToken(email, { expired = false } = {}) {
    const [row] = await db.query(
      `update users set verification_token = gen_random_uuid(),
         verification_expires = now() + ($2 || ' days')::interval
       where email = $1 returning verification_token`,
      [email, expired ? "-1" : "1"]
    );
    return row.verification_token;
  }

  const verifiedOf = async (email) =>
    (await db.query("select verified, verification_token from users where email = $1", [email]))[0];

  test("BP-C01 log in before verifying the email", async ({}, testInfo) => {
    const u = await unverifiedUser("c01");
    const r = await send(anonApi, "post", "/api/auth/login", u);
    record(testInfo, { id: "BP-C01", level: "control-flow", ...r });
    expect(r.category).toBe("V1");
    expect(r.message).toMatch(/not verified/i);
    expect(r.body.token).toBeUndefined();
  });

  test("BP-C02 run first-time admin setup again after setup", async ({}, testInfo) => {
    const [{ count: before }] = await db.query("select count(*) from users");
    const r = await send(anonApi, "post", "/api/auth/create-admin", {
      email: `bp-${RUN}-c02@test.com`,
      password: "Takeover123",
    });
    const [{ count: after }] = await db.query("select count(*) from users");
    record(testInfo, { id: "BP-C02", level: "control-flow", ...r });
    expect(r.category).toBe("V1");
    expect(r.message).toMatch(/already exists/i);
    expect(after).toBe(before);
  });

  test("BP-C03 reuse a verification link that was already used", async ({}, testInfo) => {
    const u = await unverifiedUser("c03");
    const token = await setVerificationToken(u.email);
    const html = { headers: { Accept: "text/html" } };
    await anonApi.get(`/verify/${token}`, html);
    expect((await verifiedOf(u.email)).verified).toBe(true); // first use works
    await db.query("update users set verified = false where email = $1", [u.email]);
    const res = await anonApi.get(`/verify/${token}`, html); // second use must do nothing
    const state = await verifiedOf(u.email);
    record(testInfo, { id: "BP-C03", level: "control-flow", category: state.verified ? "E" : "V3", status: res.status(), message: "" });
    expect(state.verified).toBe(false);
  });

  test("BP-C04 use an expired verification link", async ({ page }, testInfo) => {
    const u = await unverifiedUser("c04");
    const token = await setVerificationToken(u.email, { expired: true });
    const res = await page.goto(`/verify/${token}`);
    const state = await verifiedOf(u.email);
    record(testInfo, { id: "BP-C04", level: "control-flow", category: state.verified ? "E" : "V3", status: res?.status() ?? 0, message: "" });
    expect(state.verified).toBe(false);
  });

  test("BP-C05 open a made-up verification link", async ({ page }, testInfo) => {
    const [{ count: before }] = await db.query("select count(*) from users where verified");
    const res = await page.goto("/verify/00000000-0000-4000-8000-000000000000");
    const [{ count: after }] = await db.query("select count(*) from users where verified");
    record(testInfo, { id: "BP-C05", level: "control-flow", category: after !== before ? "E" : "V3", status: res?.status() ?? 0, message: "" });
    expect(after).toBe(before);
  });

  test("BP-C06 open a password-protected short link directly (skip the password step)", async ({}, testInfo) => {
    const link = await api.createLink(userApi, T("c06"), { password: "letmein" });
    const res = await anonApi.get(`/${link.address}`, { maxRedirects: 0 });
    const leaked = (res.headers().location || "").includes("c06") || (await res.text()).includes(T("c06"));
    record(testInfo, { id: "BP-C06", level: "control-flow", category: leaked ? "E" : "V1", status: res.status(), message: "" });
    expect(leaked).toBe(false);
  });

  test("BP-C07 visit a short link after it has expired", async ({}, testInfo) => {
    test.fail(true, "BUG-BP-05: redirect does not check expire_in; expired links work until the 30s cleanup job runs");
    const link = await api.createLink(userApi, T("c07"), { expire_in: "2m" });
    await db.query("update links set expire_in = now() - interval '1 day' where uuid = $1", [link.id]);
    const res = await anonApi.get(`/${link.address}`, { maxRedirects: 0 });
    const redirected = (res.headers().location || "").includes("c07");
    record(testInfo, { id: "BP-C07", level: "control-flow", category: redirected ? "E" : "V1", status: res.status(), message: "" });
    expect(redirected).toBe(false);
  });

  test("BP-C08 control: expired links are removed by the cleanup job", async () => {
    test.setTimeout(60_000);
    const link = await api.createLink(userApi, T("c08"), { expire_in: "2m" });
    await db.query("update links set expire_in = now() - interval '1 day' where uuid = $1", [link.id]);
    await expect
      .poll(async () => (await db.query("select 1 from links where uuid = $1", [link.id])).length, {
        timeout: 45_000,
        intervals: [2_000],
      })
      .toBe(0);
  });

  test("BP-C09 press Back after logging out, then reload", async ({ page, context }, testInfo) => {
    const token = await api.loginToken(accounts.user);
    await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
    await page.goto("/settings");
    await expect(page.locator("#apikey-wrapper")).toBeVisible();
    await page.goto("/logout");
    await expect(page.getByText("Log in / Sign up")).toBeVisible();
    await page.goBack();
    await page.reload();
    const stillInSettings = (await page.locator("#apikey-wrapper").count()) > 0;
    record(testInfo, { id: "BP-C09", level: "control-flow", category: stillInSettings ? "E" : "V1", status: 0, message: "" });
    expect(stillInSettings).toBe(false);
  });
});
