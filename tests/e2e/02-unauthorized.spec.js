// Suite 3 - Unauthorized access
//
// What this suite checks (CSE731 brief: "unauthorized access" negative cases):
//   A. Link ownership, designed with CACC on Kutt's real predicate
//   B. Admin-only endpoints called by a normal user and by an anonymous client
//   C. Session (JWT cookie) tampering: missing / garbage / wrong-secret / expired /
//      unsigned / non-existent user / legacy-format tokens
//   D. API-key authentication (wrong key, another user's key, key on admin routes)
//   E. Protected pages opened directly in the browser (control-flow bypass)
//   F. Known findings: security expectations Kutt does NOT meet (test.fail)
//
// Every "denied" test also checks the database (the DB oracle), so a request
// that returns an error but still changed data is caught.
//
// The authorization predicate under test (server/handlers/links.handler.js,
// edit / remove / stats):
//     link = find({ uuid, ...(!req.user.admin && { user_id: req.user.id }) })
// i.e.   access  <=>  isAdmin  OR  isOwner        p = a ∨ b
//
// CACC rows for p = a ∨ b (a = isAdmin, b = isOwner):
//   row | a | b | p | used for
//   R1  | F | T | T | major clause b (pair with R3)   owner edits own link
//   R2  | T | F | T | major clause a (pair with R3)   admin edits another user's link
//   R3  | F | F | F | shared row for both pairs       other user edits the link
// Each row is run against three operations: EDIT, DELETE and STATS.

const { test, expect } = require("@playwright/test");
const db = require("../lib/db");
const api = require("../lib/api");
const accounts = require("../lib/accounts");

const RUN = Date.now();
const TARGET_PREFIX = `https://example.com/kutt-ua-${RUN}`;
const USER_B = { email: `userb-${RUN}@test.com`, password: "UserB12345" };

let n = 0;
const nextTarget = () => `${TARGET_PREFIX}-${++n}`;

// clients
let adminApi, userApi, userBApi, anonApi;
// ids
let adminId, userId, userBId;

async function linkRow(uuid) {
  const rows = await db.query(
    "select uuid, user_id, description, banned, target from links where uuid = $1",
    [uuid]
  );
  return rows[0];
}

async function userRow(id) {
  const rows = await db.query("select id, email, role, banned from users where id = $1", [id]);
  return rows[0];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  adminApi = await api.asUser(accounts.admin);
  userApi = await api.asUser(accounts.user);
  anonApi = await api.anonymous();

  // Second normal user, created by the admin (verified, so it can log in).
  const res = await adminApi.post("/api/users/admin", {
    data: { email: USER_B.email, password: USER_B.password, role: "USER", verified: true },
  });
  expect(res.status(), await res.text()).toBe(201);
  userBApi = await api.asUser(USER_B);

  const ids = await db.query("select id, email from users where email = any($1)", [
    [accounts.admin.email, accounts.user.email, USER_B.email],
  ]);
  const idOf = (email) => ids.find((r) => r.email === email).id;
  adminId = idOf(accounts.admin.email);
  userId = idOf(accounts.user.email);
  userBId = idOf(USER_B.email);
});

test.afterAll(async () => {
  await db.query("delete from links where target like $1", [`${TARGET_PREFIX}-%`]);
  await db.query("delete from users where email = $1 or email like $2", [
    USER_B.email,
    `ua-escalation-${RUN}-%`,
  ]);
  for (const c of [adminApi, userApi, userBApi, anonApi]) await c?.dispose();
  await db.close();
});

// ---------------------------------------------------------------------------
// A. Link ownership (CACC)
// ---------------------------------------------------------------------------
test.describe("A. Link ownership - CACC on isAdmin OR isOwner", () => {
  // --- EDIT -----------------------------------------------------------------
  test("UA-01 [R1 a=F b=T] owner can edit own link", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userApi.patch(`/api/links/${link.id}`, {
      data: { description: "edited by owner" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await linkRow(link.id)).description).toBe("edited by owner");
  });

  test("UA-02 [R2 a=T b=F] admin can edit another user's link", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await adminApi.patch(`/api/links/${link.id}`, {
      data: { description: "edited by admin" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    expect((await linkRow(link.id)).description).toBe("edited by admin");
  });

  test("UA-03 [R3 a=F b=F] other user cannot edit the link", async () => {
    const link = await api.createLink(userApi, nextTarget(), { description: "original" });
    const res = await userBApi.patch(`/api/links/${link.id}`, {
      data: { description: "hacked by B", target: "https://evil.example.com" },
    });
    expect(res.ok()).toBeFalsy();
    expect(await api.errorOf(res)).toMatch(/not found/i);
    const row = await linkRow(link.id);
    expect(row.description).toBe("original");
    expect(row.target).not.toContain("evil");
  });

  // --- DELETE ---------------------------------------------------------------
  test("UA-04 [R1 a=F b=T] owner can delete own link", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userApi.delete(`/api/links/${link.id}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(await linkRow(link.id)).toBeUndefined();
  });

  test("UA-05 [R2 a=T b=F] admin can delete another user's link", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await adminApi.delete(`/api/links/${link.id}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    expect(await linkRow(link.id)).toBeUndefined();
  });

  test("UA-06 [R3 a=F b=F] other user cannot delete the link", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userBApi.delete(`/api/links/${link.id}`);
    expect(res.ok()).toBeFalsy();
    expect(await api.errorOf(res)).toMatch(/could not find/i);
    expect(await linkRow(link.id)).toBeDefined();
  });

  // --- STATS ----------------------------------------------------------------
  test("UA-07 [R1 a=F b=T] owner can read own link stats", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userApi.get(`/api/links/${link.id}/stats`);
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("UA-08 [R2 a=T b=F] admin can read another user's link stats", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await adminApi.get(`/api/links/${link.id}/stats`);
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("UA-09 [R3 a=F b=F] other user cannot read the link stats", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userBApi.get(`/api/links/${link.id}/stats`);
    expect(res.ok()).toBeFalsy();
    expect(await api.errorOf(res)).toMatch(/could not be found/i);
  });

  // --- LIST -----------------------------------------------------------------
  test("UA-10 a user's link list never contains another user's links", async () => {
    const link = await api.createLink(userApi, nextTarget());
    const res = await userBApi.get("/api/links?limit=50");
    expect(res.ok()).toBeTruthy();
    const ids = (await res.json()).data.map((l) => l.id);
    expect(ids).not.toContain(link.id);
  });
});

// ---------------------------------------------------------------------------
// B. Admin-only endpoints
// ---------------------------------------------------------------------------
test.describe("B. Admin-only endpoints", () => {
  test("UA-11 control: admin can list all users and all links", async () => {
    const users = await adminApi.get("/api/users/admin");
    expect(users.ok()).toBeTruthy();
    const links = await adminApi.get("/api/links/admin");
    expect(links.ok()).toBeTruthy();
  });

  for (const who of ["user", "anonymous"]) {
    const client = () => (who === "user" ? userApi : anonApi);

    test(`UA-12 ${who} cannot list all users (GET /api/users/admin)`, async () => {
      const res = await client().get("/api/users/admin");
      expect(res.status()).toBe(401);
    });

    test(`UA-13 ${who} cannot list all links (GET /api/links/admin)`, async () => {
      const res = await client().get("/api/links/admin");
      expect(res.status()).toBe(401);
    });

    test(`UA-14 ${who} cannot create an ADMIN account (POST /api/users/admin)`, async () => {
      const email = `ua-escalation-${RUN}-${who}@test.com`;
      const res = await client().post("/api/users/admin", {
        data: { email, password: "Escalate123", role: "ADMIN", verified: true },
      });
      expect(res.status()).toBe(401);
      const rows = await db.query("select 1 from users where email = $1", [email]);
      expect(rows.length).toBe(0);
    });

    test(`UA-15 ${who} cannot delete a user (DELETE /api/users/admin/:id)`, async () => {
      const res = await client().delete(`/api/users/admin/${userBId}`);
      expect(res.status()).toBe(401);
      expect(await userRow(userBId)).toBeDefined();
    });

    test(`UA-16 ${who} cannot ban a user (POST /api/users/admin/ban/:id)`, async () => {
      const res = await client().post(`/api/users/admin/ban/${userBId}`, { data: { links: true } });
      expect(res.status()).toBe(401);
      expect((await userRow(userBId)).banned).toBe(false);
    });

    test(`UA-17 ${who} cannot ban a link (POST /api/links/admin/ban/:id)`, async () => {
      const link = await api.createLink(userBApi, nextTarget());
      const res = await client().post(`/api/links/admin/ban/${link.id}`, { data: {} });
      expect(res.status()).toBe(401);
      expect((await linkRow(link.id)).banned).toBe(false);
    });

    test(`UA-18 ${who} cannot use the admin link-edit route (PATCH /api/links/admin/:id)`, async () => {
      const link = await api.createLink(userBApi, nextTarget(), { description: "original" });
      const res = await client().patch(`/api/links/admin/${link.id}`, {
        data: { description: "changed via admin route" },
      });
      expect(res.status()).toBe(401);
      expect((await linkRow(link.id)).description).toBe("original");
    });
  }
});

// ---------------------------------------------------------------------------
// C. Session (JWT cookie) tampering - all against GET /api/users ("my account")
// ---------------------------------------------------------------------------
test.describe("C. JWT session tampering", () => {
  async function getMe(token) {
    const ctx = token === undefined ? await api.anonymous() : await api.asToken(token);
    const res = await ctx.get("/api/users");
    const status = res.status();
    const body = await res.json().catch(() => ({}));
    await ctx.dispose();
    return { status, body };
  }

  test("UA-19 control: a correctly signed token is accepted and bound to its user", async () => {
    const { status, body } = await getMe(api.forgeToken({ sub: userId }));
    expect(status).toBe(200);
    expect(body.email).toBe(accounts.user.email);
  });

  test("UA-20 no cookie at all -> 401", async () => {
    expect((await getMe(undefined)).status).toBe(401);
  });

  test("UA-21 garbage token -> 401", async () => {
    expect((await getMe("not.a.jwt")).status).toBe(401);
  });

  test("UA-22 token claiming to be admin, signed with the wrong secret -> 401", async () => {
    const token = api.forgeToken({ sub: adminId, secret: "attacker-guessed-secret" });
    expect((await getMe(token)).status).toBe(401);
  });

  test("UA-23 unsigned token (alg: none) claiming to be admin -> 401", async () => {
    expect((await getMe(api.unsignedToken(adminId))).status).toBe(401);
  });

  test("UA-24 expired token (real secret, exp in the past) -> 401", async () => {
    const token = api.forgeToken({ sub: userId, expiresInSeconds: -60 });
    expect((await getMe(token)).status).toBe(401);
  });

  test("UA-25 token for a user id that does not exist -> 401", async () => {
    const token = api.forgeToken({ sub: 987654321 });
    expect((await getMe(token)).status).toBe(401);
  });

  test("UA-26 legacy-format token (sub = email string) is rejected", async () => {
    const token = api.forgeToken({ sub: accounts.admin.email });
    expect((await getMe(token)).status).toBe(401);
  });

  test("UA-27 payload tampered after signing (sub swapped to admin) -> 401", async () => {
    const real = api.forgeToken({ sub: userId });
    const [h, p, s] = real.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    payload.sub = adminId;
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
    expect((await getMe(tampered)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// D. API key authentication
// ---------------------------------------------------------------------------
test.describe("D. API key authentication", () => {
  let userKey, userBKey;

  test.beforeAll(async () => {
    userKey = await api.generateApiKey(userApi);
    userBKey = await api.generateApiKey(userBApi);
  });

  test("UA-28 control: a valid API key authenticates as its owner", async () => {
    const ctx = await api.asApiKey(userKey);
    const res = await ctx.get("/api/users");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).email).toBe(accounts.user.email);
    await ctx.dispose();
  });

  test("UA-29 wrong API key -> 401", async () => {
    const ctx = await api.asApiKey("x".repeat(40));
    const res = await ctx.get("/api/users");
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("UA-30 user B's API key cannot edit or delete user A's link", async () => {
    const link = await api.createLink(userApi, nextTarget(), { description: "original" });
    const ctx = await api.asApiKey(userBKey);

    const edit = await ctx.patch(`/api/links/${link.id}`, { data: { description: "via B key" } });
    expect(edit.ok()).toBeFalsy();
    const del = await ctx.delete(`/api/links/${link.id}`);
    expect(del.ok()).toBeFalsy();
    await ctx.dispose();

    const row = await linkRow(link.id);
    expect(row).toBeDefined();
    expect(row.description).toBe("original");
  });

  test("UA-31 a normal user's API key cannot reach admin routes", async () => {
    const ctx = await api.asApiKey(userKey);
    expect((await ctx.get("/api/users/admin")).status()).toBe(401);
    expect((await ctx.get("/api/links/admin")).status()).toBe(401);
    await ctx.dispose();
  });

  test("UA-32 a rotated (old) API key stops working", async () => {
    const oldKey = userBKey;
    userBKey = await api.generateApiKey(userBApi); // rotate
    const ctx = await api.asApiKey(oldKey);
    expect((await ctx.get("/api/users")).status()).toBe(401);
    await ctx.dispose();
  });
});

// ---------------------------------------------------------------------------
// E. Protected pages opened directly in the browser
// ---------------------------------------------------------------------------
test.describe("E. Protected pages (direct URL navigation)", () => {
  async function loginBrowser(context, account) {
    const token = await api.loginToken(account);
    await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
  }

  for (const path of ["/settings", "/admin", "/stats"]) {
    test(`UA-33 anonymous visitor typing ${path} is sent away (no protected content)`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$|\/logout$/);
      await expect(page.getByText("Log in / Sign up")).toBeVisible();
    });
  }

  test("UA-34 normal user does not see the Admin button", async ({ page, context }) => {
    await loginBrowser(context, accounts.user);
    await page.goto("/");
    await expect(page.getByText("Log out")).toBeVisible();
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("UA-35 normal user typing /admin gets an error page, not the admin panel", async ({ page, context }) => {
    await loginBrowser(context, accounts.user);
    await page.goto("/admin");
    await expect(page.locator("#error-page")).toBeVisible();
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("UA-36 control: admin sees the Admin button and the admin panel", async ({ page, context }) => {
    await loginBrowser(context, accounts.admin);
    await page.goto("/");
    await expect(page.locator('a[href="/admin"]')).toBeVisible();
    await page.goto("/admin");
    await expect(page.locator("#error-page")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// F. Known findings - security expectations Kutt does not meet.
// test.fail() marks the test as "expected to fail": the suite stays green while
// the defect is documented. If Kutt is ever fixed, the test will flip to
// "unexpectedly passed", which tells you to remove the test.fail().
// ---------------------------------------------------------------------------
test.describe("F. Known findings (expected failures, see bug reports)", () => {
  test("UA-37 BUG: ownership denial should be a 4xx, but Kutt answers 500", async () => {
    test.fail(true, "Kutt throws CustomError without a status code -> HTTP 500");
    const link = await api.createLink(userApi, nextTarget());
    const edit = await userBApi.patch(`/api/links/${link.id}`, { data: { description: "x" } });
    const del = await userBApi.delete(`/api/links/${link.id}`);
    const stats = await userBApi.get(`/api/links/${link.id}/stats`);
    for (const res of [edit, del, stats]) {
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
    }
  });

  test("UA-38 BUG: a token captured before logout still works after logout", async () => {
    test.fail(true, "JWTs are stateless; /logout only clears the browser cookie");
    // fresh real login, so this test does not reuse the cached token
    const ctx = await api.anonymous();
    const login = await ctx.post("/api/auth/login", { data: accounts.user });
    const { token } = await login.json();
    await ctx.dispose();

    const session = await api.asToken(token);
    await session.get("/logout"); // what the Log out button does
    const me = await session.get("/api/users");
    await session.dispose();
    expect(me.status()).toBe(401);
  });

  test("UA-39 BUG: normal user opening /admin gets HTTP 200 instead of 401/403", async ({ context }) => {
    test.fail(true, "The page-level error is rendered with status 200");
    const token = await api.loginToken(accounts.user);
    await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
    const page = await context.newPage();
    const res = await page.goto("/admin");
    expect([401, 403]).toContain(res.status());
  });
});
