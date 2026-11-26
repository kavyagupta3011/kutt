// Connects to the same Neon Postgres the app uses, by reading ../../.env
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function close() { await pool.end(); }

module.exports = { query, close, pool };
