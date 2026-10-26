// Barcha migratsiyalarni bitta SQL faylga yig'adi: Supabase → SQL Editor'ga qo'yib ishga tushirish uchun.
// Fayl oxirida schema_migrations to'ldiriladi, shunda keyin `npm run db:migrate` ularni qayta qo'llamaydi.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let out = "-- Hamyon: to'liq sxema (avtomatik yaratilgan: npm run db:sql). Supabase SQL Editor'da bir marta ishga tushiring.\n\nbegin;\n\n";
for (const f of files) out += `-- ═══ ${f} ═══\n${fs.readFileSync(path.join(dir, f), "utf8").trim()}\n\n`;
out += "insert into schema_migrations (name) values\n" + files.map((f) => `  ('${f}')`).join(",\n") + "\non conflict do nothing;\n\ncommit;\n";
fs.writeFileSync(path.join(__dirname, "..", "docs", "schema.sql"), out);
console.log(`docs/schema.sql: ${files.length} ta migratsiya`);
