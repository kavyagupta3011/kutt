// Bypass-testing harness: send a request straight to the server (skipping the
// browser), then classify how the server handled it, using the response
// categories from the client-side testing slides:
//
//   V1  Valid response: rejected with an explicit, specific error message
//   V2  Valid response: rejected with a generic / unhelpful message
//   V3  Valid response: accepted, but the invalid part was ignored or sanitized
//   F   Fault / failure: server error (unhandled exception, HTTP 5xx "An error occurred.")
//   E   Exposure: invalid input was accepted and stored, or caused a state
//       change that should not happen
//
// Every request is paired with a database check (the DB oracle): the newest
// link id is read before and after, so any row the request created is caught
// even when the HTTP response looks like a rejection.

const fs = require("fs");
const path = require("path");
const db = require("./db");

const GENERIC_MESSAGES = ["An error occurred.", "Invalid value"];

async function maxLinkId() {
  const [row] = await db.query("select coalesce(max(id), 0) as m from links");
  return Number(row.m);
}

async function newLinksSince(id) {
  return db.query(
    "select id, uuid, address, target, user_id, visit_count, banned, description, expire_in from links where id > $1",
    [id]
  );
}

// Send one bypass request and classify the result.
//   ctx     Playwright APIRequestContext (logged in or anonymous)
//   method  "post" | "patch" | "get" | "delete"
//   url     path, e.g. "/api/links"
//   data    request body (or undefined)
//   isExposure(rows)  optional: given the rows the request created, return true
//                     if they contain the invalid input (=> E). Default: any new
//                     row from a request that should have been rejected is E.
async function send(ctx, method, url, data, { isExposure } = {}) {
  const before = await maxLinkId();
  let res, status, body, text;
  try {
    res = await ctx[method](url, data === undefined ? undefined : { data });
    status = res.status();
    text = await res.text();
    try { body = JSON.parse(text); } catch { body = {}; }
  } catch (err) {
    return { category: "F", status: 0, message: String(err.message || err), rows: [] };
  }
  const rows = await newLinksSince(before);
  const message = body.error || body.message || "";

  let category;
  if (status >= 200 && status < 300) {
    const exposed = isExposure ? await isExposure(rows, body) : rows.length > 0;
    category = exposed ? "E" : "V3";
  } else if (rows.length > 0) {
    category = "E"; // rejected on the surface, but data was still written
  } else if (status >= 500 && GENERIC_MESSAGES.includes(message)) {
    category = "F";
  } else if (GENERIC_MESSAGES.includes(message) || !message) {
    category = "V2";
  } else {
    category = "V1";
  }
  return { category, status, message, body, rows };
}

// Every classified result is appended to a JSON-lines file inside test-results/.
// Playwright empties test-results/ at the start of each run, and appending to a
// file (instead of keeping an in-memory list) keeps earlier results even if a
// failing test makes Playwright restart the worker.
const RESULTS_DIR = path.join(__dirname, "..", "test-results");
const LINES_FILE = path.join(RESULTS_DIR, "bypass-vfe.jsonl");

function record(testInfo, entry) {
  const { id, level, category, status, message } = entry;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.appendFileSync(
    LINES_FILE,
    JSON.stringify({ id, level, title: testInfo.title, category, status, message: message || "" }) + "\n"
  );
  testInfo.annotations.push({
    type: "VFE",
    description: `${entry.category} (HTTP ${entry.status}) ${entry.message || ""}`.trim(),
  });
}

function readResults() {
  if (!fs.existsSync(LINES_FILE)) return [];
  const byId = new Map(); // one entry per case (a retried case keeps its last result)
  for (const line of fs.readFileSync(LINES_FILE, "utf8").split("\n")) {
    if (line.trim()) {
      const r = JSON.parse(line);
      byId.set(r.id, r);
    }
  }
  return [...byId.values()];
}

function writeSummary(file = path.join(RESULTS_DIR, "bypass-vfe.json")) {
  const results = readResults();
  const counts = { V1: 0, V2: 0, V3: 0, F: 0, E: 0 };
  for (const r of results) counts[r.category] = (counts[r.category] || 0) + 1;
  const total = results.length || 1;
  const pct = Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, `${((v / total) * 100).toFixed(1)}%`])
  );
  const out = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    counts,
    percentages: pct,
    results,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));

  console.log("\nBypass results by category (V/F/E):");
  console.table(
    Object.keys(counts).map((k) => ({ category: k, count: counts[k], percent: pct[k] }))
  );
  console.log(`Saved: ${file}`);
  return out;
}

module.exports = { send, record, writeSummary, readResults };
