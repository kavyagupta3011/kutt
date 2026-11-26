# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-unauthorized.spec.js >> F. Known findings (expected failures, see bug reports) >> UA-39 BUG: normal user opening /admin gets HTTP 200 instead of 401/403
- Location: e2e/02-unauthorized.spec.js:434:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected value: 200
Received array: [401, 403]
```

# Test source

```ts
  340 |     expect(row).toBeDefined();
  341 |     expect(row.description).toBe("original");
  342 |   });
  343 | 
  344 |   test("UA-31 a normal user's API key cannot reach admin routes", async () => {
  345 |     const ctx = await api.asApiKey(userKey);
  346 |     expect((await ctx.get("/api/users/admin")).status()).toBe(401);
  347 |     expect((await ctx.get("/api/links/admin")).status()).toBe(401);
  348 |     await ctx.dispose();
  349 |   });
  350 | 
  351 |   test("UA-32 a rotated (old) API key stops working", async () => {
  352 |     const oldKey = userBKey;
  353 |     userBKey = await api.generateApiKey(userBApi); // rotate
  354 |     const ctx = await api.asApiKey(oldKey);
  355 |     expect((await ctx.get("/api/users")).status()).toBe(401);
  356 |     await ctx.dispose();
  357 |   });
  358 | });
  359 | 
  360 | // ---------------------------------------------------------------------------
  361 | // E. Protected pages opened directly in the browser
  362 | // ---------------------------------------------------------------------------
  363 | test.describe("E. Protected pages (direct URL navigation)", () => {
  364 |   async function loginBrowser(context, account) {
  365 |     const token = await api.loginToken(account);
  366 |     await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
  367 |   }
  368 | 
  369 |   for (const path of ["/settings", "/admin", "/stats"]) {
  370 |     test(`UA-33 anonymous visitor typing ${path} is sent away (no protected content)`, async ({ page }) => {
  371 |       await page.goto(path);
  372 |       await expect(page).toHaveURL(/\/$|\/logout$/);
  373 |       await expect(page.getByText("Log in / Sign up")).toBeVisible();
  374 |     });
  375 |   }
  376 | 
  377 |   test("UA-34 normal user does not see the Admin button", async ({ page, context }) => {
  378 |     await loginBrowser(context, accounts.user);
  379 |     await page.goto("/");
  380 |     await expect(page.getByText("Log out")).toBeVisible();
  381 |     await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  382 |   });
  383 | 
  384 |   test("UA-35 normal user typing /admin gets an error page, not the admin panel", async ({ page, context }) => {
  385 |     await loginBrowser(context, accounts.user);
  386 |     await page.goto("/admin");
  387 |     await expect(page.locator("#error-page")).toBeVisible();
  388 |     await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  389 |   });
  390 | 
  391 |   test("UA-36 control: admin sees the Admin button and the admin panel", async ({ page, context }) => {
  392 |     await loginBrowser(context, accounts.admin);
  393 |     await page.goto("/");
  394 |     await expect(page.locator('a[href="/admin"]')).toBeVisible();
  395 |     await page.goto("/admin");
  396 |     await expect(page.locator("#error-page")).toHaveCount(0);
  397 |   });
  398 | });
  399 | 
  400 | // ---------------------------------------------------------------------------
  401 | // F. Known findings - security expectations Kutt does not meet.
  402 | // test.fail() marks the test as "expected to fail": the suite stays green while
  403 | // the defect is documented. If Kutt is ever fixed, the test will flip to
  404 | // "unexpectedly passed", which tells you to remove the test.fail().
  405 | // ---------------------------------------------------------------------------
  406 | test.describe("F. Known findings (expected failures, see bug reports)", () => {
  407 |   test("UA-37 BUG: ownership denial should be a 4xx, but Kutt answers 500", async () => {
  408 |     test.fail(true, "Kutt throws CustomError without a status code -> HTTP 500");
  409 |     const link = await api.createLink(userApi, nextTarget());
  410 |     const edit = await userBApi.patch(`/api/links/${link.id}`, { data: { description: "x" } });
  411 |     const del = await userBApi.delete(`/api/links/${link.id}`);
  412 |     const stats = await userBApi.get(`/api/links/${link.id}/stats`);
  413 |     for (const res of [edit, del, stats]) {
  414 |       expect(res.status()).toBeGreaterThanOrEqual(400);
  415 |       expect(res.status()).toBeLessThan(500);
  416 |     }
  417 |   });
  418 | 
  419 |   test("UA-38 BUG: a token captured before logout still works after logout", async () => {
  420 |     test.fail(true, "JWTs are stateless; /logout only clears the browser cookie");
  421 |     // fresh real login, so this test does not reuse the cached token
  422 |     const ctx = await api.anonymous();
  423 |     const login = await ctx.post("/api/auth/login", { data: accounts.user });
  424 |     const { token } = await login.json();
  425 |     await ctx.dispose();
  426 | 
  427 |     const session = await api.asToken(token);
  428 |     await session.get("/logout"); // what the Log out button does
  429 |     const me = await session.get("/api/users");
  430 |     await session.dispose();
  431 |     expect(me.status()).toBe(401);
  432 |   });
  433 | 
  434 |   test("UA-39 BUG: normal user opening /admin gets HTTP 200 instead of 401/403", async ({ context }) => {
  435 |     test.fail(true, "The page-level error is rendered with status 200");
  436 |     const token = await api.loginToken(accounts.user);
  437 |     await context.addCookies([{ name: "token", value: token, url: api.BASE_URL }]);
  438 |     const page = await context.newPage();
  439 |     const res = await page.goto("/admin");
> 440 |     expect([401, 403]).toContain(res.status());
      |                        ^ Error: expect(received).toContain(expected) // indexOf
  441 |   });
  442 | });
  443 | 
```