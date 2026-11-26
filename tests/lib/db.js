// Connects to the same Postgres database the app uses, by reading ../../.env
// The pool is created lazily so that one spec file calling close() in its
// afterAll does not break the next spec file running in the same worker.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function query(sql, params) {
  const res = await getPool().query(sql, params);
  return res.rows;
}

async function close() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

module.exports = { query, close, getPool };
