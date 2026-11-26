// API helpers for authorization / session tests.
//
// Kutt reads the JWT only from the "token" cookie (server/passport.js), and the
// JSON login endpoint returns the token in the body instead of setting a cookie.
// So an API client "logged in as X" is a request context that sends
//   Cookie: token=<jwt>
// on every request. Clients can also authenticate with the X-API-Key header.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { request } = require("@playwright/test");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:3000";
const JSON_HEADERS = { Accept: "application/json" };

// Cache real login tokens per email, so each account logs in once per run.
// (Kutt can rate-limit /api/auth/login when ENABLE_RATE_LIMIT=true.)
const tokenCache = new Map();

async function loginToken({ email, password }) {
  if (tokenCache.has(email)) return tokenCache.get(email);
  const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: JSON_HEADERS });
  const res = await ctx.post("/api/auth/login", { data: { email, password } });
  const body = await res.json().catch(() => ({}));
  await ctx.dispose();
  if (!res.ok() || !body.token) {
    throw new Error(`Login failed for ${email}: ${res.status()} ${JSON.stringify(body)}`);
  }
  tokenCache.set(email, body.token);
  return body.token;
}

// A request context authenticated with a JWT cookie.
async function asToken(token) {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...JSON_HEADERS, Cookie: `token=${token}` },
  });
}

// A request context logged in as a real account (via the real login endpoint).
async function asUser(account) {
  return asToken(await loginToken(account));
}

// A request context authenticated with an API key.
async function asApiKey(apikey) {
  return request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...JSON_HEADERS, "X-API-Key": apikey },
  });
}

// A request context with no credentials at all.
async function anonymous() {
  return request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: JSON_HEADERS });
}

// Build a JWT the same way Kutt does (server/utils/utils.js signToken), with
// overrides so tests can forge tampered / expired / wrong-secret tokens.
function forgeToken({
  sub,
  secret = process.env.JWT_SECRET,
  expiresInSeconds = 7 * 24 * 3600,
  algorithm = "HS256",
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "ApiAuth", sub, iat: now, exp: now + expiresInSeconds };
  return jwt.sign(payload, secret, { algorithm });
}

// An unsigned token using the "none" algorithm (classic JWT attack).
function unsignedToken(sub) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ iss: "ApiAuth", sub, iat: now, exp: now + 3600 })}.`;
}

// Create a short link through the API and return Kutt's JSON (id = link uuid).
async function createLink(ctx, target, extra = {}) {
  const res = await ctx.post("/api/links", { data: { target, ...extra } });
  const body = await res.json().catch(() => ({}));
  if (res.status() !== 201) {
    throw new Error(`createLink failed: ${res.status()} ${JSON.stringify(body)}`);
  }
  return body;
}

// Generate (rotate) the API key of the account behind ctx.
async function generateApiKey(ctx) {
  const res = await ctx.post("/api/auth/apikey");
  const body = await res.json();
  if (!body.apikey) throw new Error(`apikey generation failed: ${JSON.stringify(body)}`);
  return body.apikey;
}

// Read a JSON error body safely.
async function errorOf(res) {
  const body = await res.json().catch(() => ({}));
  return body.error || "";
}

module.exports = {
  BASE_URL,
  loginToken,
  asToken,
  asUser,
  asApiKey,
  anonymous,
  forgeToken,
  unsignedToken,
  createLink,
  generateApiKey,
  errorOf,
};
