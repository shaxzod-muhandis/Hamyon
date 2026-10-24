// Postgres ulanishi. Serverless: kichik pool; Supabase'da pooler (6543) manzili kerak.
const { Pool, types } = require("pg");

// bigint (int8) -> Number. Summalar 2^53 dan ancha kichik.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric -> Number (foizlar)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> 'YYYY-MM-DD' satr (vaqt zonasi siljishisiz)
types.setTypeParser(1082, (v) => v);

let pool;
function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL sozlanmagan");
  const local = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("pg pool xato:", e.message));
  return pool;
}

const query = (text, params) => getPool().query(text, params);

async function tx(fn) {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function close() {
  if (pool) await pool.end();
  pool = undefined;
}

module.exports = { query, tx, close, getPool };
