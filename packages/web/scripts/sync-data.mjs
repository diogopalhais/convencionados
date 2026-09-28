// Copia o snapshot mais recente de ../../data para public/data (servido em /data/*)
// e gera o sitemap.xml com uma entrada por local.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE = "https://convencionados.xyz";
const src = resolve(import.meta.dirname, "../../../data");
const pub = resolve(import.meta.dirname, "../public");
const dst = resolve(pub, "data");
mkdirSync(dst, { recursive: true });
for (const f of ["latest.json", "report-latest.json", "mcdt-codes.json"]) {
  const from = resolve(src, f);
  if (!existsSync(from)) {
    console.error(`sync-data: falta ${from}. Corra 'pnpm run ingest:fixture' na raiz.`);
    process.exit(1);
  }
  copyFileSync(from, resolve(dst, f));
}

const snap = JSON.parse(readFileSync(resolve(dst, "latest.json"), "utf8"));
const lastmod = snap.generatedAt.slice(0, 10);
const url = (path, priority, changefreq = "monthly") =>
  `<url><loc>${SITE}${path}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
const urls = [
  url("/", "1.0", "weekly"),
  url("/privacidade", "0.3", "yearly"),
  url("/qualidade", "0.3"),
  ...snap.locations.map((l) => url(`/p/${l.id}`, "0.6")),
];
writeFileSync(
  resolve(pub, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
);
console.log(`sync-data: snapshot copiado para public/data · sitemap com ${urls.length} URLs`);
