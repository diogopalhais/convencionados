import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

let cached: string | null = null;
export function sdmFixtureHtml(): string {
  if (!cached)
    cached = gunzipSync(
      readFileSync(resolve(import.meta.dirname, "../fixtures/sdm-2026-09-24.html.gz")),
    ).toString("utf8");
  return cached;
}
export const MCDT_FIXTURE = resolve(import.meta.dirname, "../fixtures/tabela-mcdt-2026-03-01.xlsx");
