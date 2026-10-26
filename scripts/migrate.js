// migrations/*.sql ni tartib bilan qo'llaydi. `--test` — TEST_DATABASE_URL'ga.
require("./_env").loadEnv();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function migrate(url) {
  const local = /localhost|127\.0\.0\.1/.test(url);
  const c = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await c.query("select name from schema_migrations")).rows.map((r) => r.name));
  const dir = path.join(__dirname, "..", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await c.query("begin");
    try {
      await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await c.query("insert into schema_migrations (name) values ($1)", [f]);
      await c.query("commit");
      console.log("✅", f);
    } catch (e) {
      await c.query("rollback");
      console.error("❌", f, e.message);
      process.exitCode = 1;
      break;
    }
  }
  await c.end();
}

if (require.main === module) {
  // Migratsiya uchun DIRECT_URL (Supabase session pooler, 5432) afzal; bo'lmasa DATABASE_URL
  const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL (yoki --test uchun TEST_DATABASE_URL) sozlanmagan");
    process.exit(1);
  }
  migrate(url);
}
module.exports = { migrate };
