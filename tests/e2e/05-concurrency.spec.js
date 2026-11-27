// Suite 5 (bonus) - Concurrency / multiple simultaneous clients
//
// Your slides list "multiple users, session data and concurrency" as an OPEN
// problem the ATG/CIM models do not cover. Playwright can fire many requests at
// once, so this suite checks Kutt's behaviour under races, with the database as
// the source of truth:
//   CC-01/02  two or more clients claim the SAME custom slug at once
//             -> the database must still end up with exactly ONE such link
//   CC-03     many clients visit the same link at once
//             -> the atomic counter must count every visit (no lost updates)
//   CC-04     two clients edit the same link at once
//             -> the row stays consistent (one winner, not a merged/!corrupt value)

const { test, expect, request } = require("@playwright/test");
const db = require("../lib/db");
const api = require("../lib/api");
const accounts = require("../lib/accounts");

const RUN = Date.now();
let userApi, adminApi, userId;

const target = (s) => `https://example.com/kutt-cc-${RUN}-${s}`;

async function rowsForAddress(addr) {
  return db.query("select id, user_id, description from links where address = $1", [addr]);
}

// a request context that looks like a real browser (so visits are not treated as a bot)
async function visitorContext() {
  return request.newContext({
    baseURL: api.BASE_URL,
    extraHTTPHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
}

test.describe("Suite 5: concurrency (the slides' open problem)", () => {
  test.beforeAll(async () => {
    userApi = await api.asUser(accounts.user);
    adminApi = await api.asUser(accounts.admin);
    [{ id: userId }] = await db.query("select id from users where email = $1", [accounts.user.email]);
  });

  test.afterAll(async () => {
    await db.query("delete from links where target like $1", [`https://example.com/kutt-cc-${RUN}-%`]);
    for (const c of [userApi, adminApi]) await c?.dispose();
    await db.close();
  });

  // CC-01 -------------------------------------------------------------------
  test("CC-01 two clients claim the same custom slug at once -> exactly one link", async () => {
    test.fail(true, "BUG-CC-01: concurrent create with the same custom slug is not atomic (TOCTOU race); duplicate links with the same address are stored");
    const slug = `cc${RUN}a`;
    const [r1, r2] = await Promise.all([
      userApi.post("/api/links", { data: { target: target("a1"), customurl: slug } }),
      adminApi.post("/api/links", { data: { target: target("a2"), customurl: slug } }),
    ]);
    // integrity: the database must hold exactly one link with this slug
    const rows = await rowsForAddress(slug);
    expect(rows.length, `statuses were ${r1.status()} & ${r2.status()}`).toBe(1);
    // exactly one request should have succeeded (201)
    const okCount = [r1, r2].filter((r) => r.status() === 201).length;
    expect(okCount).toBe(1);
  });

  // CC-02 -------------------------------------------------------------------
  test("CC-02 five clients claim the same custom slug at once -> exactly one link", async () => {
    test.fail(true, "BUG-CC-01: concurrent create with the same custom slug is not atomic (TOCTOU race); duplicate links with the same address are stored");
    const slug = `cc${RUN}b`;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        userApi.post("/api/links", { data: { target: target(`b${i}`), customurl: slug } })
      )
    );
    const rows = await rowsForAddress(slug);
    const statuses = results.map((r) => r.status());
    expect(rows.length, `statuses: ${statuses.join(",")}`).toBe(1);
    expect(statuses.filter((s) => s === 201).length).toBe(1);
  });

  // CC-03 -------------------------------------------------------------------
  test("CC-03 ten simultaneous visits are all counted (no lost updates)", async () => {
    const link = await api.createLink(userApi, target("visits"));
    const N = 10;
    const ctx = await visitorContext();
    await Promise.all(
      Array.from({ length: N }, () => ctx.get(`/${link.address}`, { maxRedirects: 0 }))
    );
    await ctx.dispose();

    // visits are recorded asynchronously -> poll until the count settles
    await expect
      .poll(
        async () =>
          Number((await db.query("select visit_count from links where uuid = $1", [link.id]))[0].visit_count),
        { timeout: 15000, intervals: [500] }
      )
      .toBe(N);
  });

  // CC-04 -------------------------------------------------------------------
  test("CC-04 two simultaneous edits leave the row consistent (one winner)", async () => {
    const link = await api.createLink(userApi, target("edit"), { description: "original" });
    const [rA, rB] = await Promise.all([
      userApi.patch(`/api/links/${link.id}`, { data: { description: "edit-A" } }),
      userApi.patch(`/api/links/${link.id}`, { data: { description: "edit-B" } }),
    ]);
    const [row] = await db.query("select description from links where uuid = $1", [link.id]);
    // the final description must be exactly one of the two writes, never merged/corrupt
    expect(["edit-A", "edit-B"]).toContain(row.description);
    // the link is not duplicated or lost
    const all = await db.query("select 1 from links where uuid = $1", [link.id]);
    expect(all.length).toBe(1);
  });
});
