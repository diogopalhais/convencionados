import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Snapshot, type Snapshot as SnapshotT } from "@sns-conv/schema";
import { applyErsComplaints, fetchErsTable, parseErsTable } from "./ers-rec.js";
import { extractSdm } from "./extract.js";
import { fetchSdmReport } from "./fetch-sdm.js";
import { geocodeMissing, loadCache, saveCache } from "./geocode.js";
import { parseMcdtTable } from "./mcdt.js";
import { normalize } from "./normalize.js";
import { pseudonymiseNaturalPersons } from "./privacy.js";
import { buildReport, reportToMarkdown } from "./report.js";
import { extractSdmAux } from "./sdm-aux.js";
import { computeSignals } from "./signals.js";
import {
  applyActivity,
  buildActivityIndex,
  fetchTransparencia,
  type TransparenciaData,
} from "./transparencia.js";

interface Args {
  fixture?: string;
  live: boolean;
  out: string;
  mcdt: string;
  mcdtVersion: string;
  saveRaw: boolean;
  /** "live" | "off" | caminho para fixture JSON */
  transparencia: string;
  geocodeApi: boolean;
  /** "live" | "off" | caminho para PDF */
  ers: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    live: false,
    out: "../../data",
    mcdt: "fixtures/tabela-mcdt-2026-03-01.xlsx",
    mcdtVersion: "2026-03-01",
    saveRaw: true,
    transparencia: "live",
    geocodeApi: true,
    ers: "live",
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--fixture" && v) {
      a.fixture = v;
      i++;
    } else if (k === "--live") a.live = true;
    else if (k === "--out" && v) {
      a.out = v;
      i++;
    } else if (k === "--mcdt" && v) {
      a.mcdt = v;
      i++;
    } else if (k === "--mcdt-version" && v) {
      a.mcdtVersion = v;
      i++;
    } else if (k === "--no-raw") a.saveRaw = false;
  }
  if (!a.fixture && !a.live) throw new Error("Indique --fixture <ficheiro.html[.gz]> ou --live");
  return a;
}

function readMaybeGz(path: string): string {
  const buf = readFileSync(path);
  return path.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  const t0 = Date.now();

  let html: string;
  let origin: "live" | "fixture";
  if (args.live) {
    console.log("→ a obter relatório SDM (live)…");
    const r = await fetchSdmReport();
    html = r.html;
    origin = "live";
    console.log(
      `  ${(html.length / 1e6).toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } else {
    console.log(`→ a ler fixture ${args.fixture}`);
    html = readMaybeGz(resolve(args.fixture as string));
    origin = "fixture";
  }

  const extracted = extractSdm(html);
  console.log(
    `→ extraídos ${extracted.records.length} registos · relatório de ${extracted.reportDate ?? "?"}`,
  );
  const version = extracted.reportDate ?? new Date().toISOString().slice(0, 10);
  if (args.saveRaw) {
    writeJson(resolve(out, "raw", `sdm-${version}.json`), extracted.records);
    if (origin === "live") {
      mkdirSync(resolve(out, "raw"), { recursive: true });
      writeFileSync(resolve(out, "raw", `sdm-${version}.html`), html);
    }
  }

  const aux = extractSdmAux(html);
  console.log(
    `→ listas auxiliares: ${aux.districts.size} distritos · ${aux.municipalities.size} concelhos · ${aux.parishes.size} freguesias`,
  );
  const normalized = normalize(extracted.records, aux);
  console.log(
    `→ normalizados: ${normalized.entities.length} entidades · ${normalized.locations.length} locais · ${normalized.dropped.length} descartados`,
  );

  // enriquecimento 1: faturação ao SNS por NIF × área (Transparência SNS)
  let transparencia: TransparenciaData | null = null;
  let trOrigin: "live" | "fixture" = "fixture";
  if (args.transparencia === "live") {
    try {
      console.log("→ a obter faturação (Transparência SNS)…");
      transparencia = await fetchTransparencia();
      trOrigin = "live";
      writeJson(resolve(out, "raw", `transparencia-${version}.json`), transparencia);
    } catch (e) {
      console.warn(
        `  ⚠ Transparência indisponível (${e instanceof Error ? e.message : e}); a usar fixture`,
      );
      transparencia = JSON.parse(
        readFileSync(resolve("fixtures/transparencia-2026-09-24.json"), "utf8"),
      ) as TransparenciaData;
    }
  } else if (args.transparencia !== "off") {
    transparencia = JSON.parse(
      readFileSync(resolve(args.transparencia), "utf8"),
    ) as TransparenciaData;
  }
  let trMeta: {
    latestMonth: string;
    since: string;
    fetchedAt: string;
    origin: "live" | "fixture";
  } | null = null;
  if (transparencia) {
    const idx = buildActivityIndex(transparencia, normalized.areas);
    const n = applyActivity(normalized.locations, idx);
    trMeta = {
      latestMonth: idx.latestMonth,
      since: transparencia.since,
      fetchedAt: transparencia.fetchedAt,
      origin: trOrigin,
    };
    console.log(
      `  ${idx.byKey.size} pares NIF×área · ${n} convenções com faturação · último mês ${idx.latestMonth}${idx.unmatchedAreas.length ? ` · áreas sem correspondência: ${idx.unmatchedAreas.join(", ")}` : ""}`,
    );
  }

  // enriquecimento 2: reclamações e elogios por entidade (tabela semestral da ERS)
  let ersMeta: SnapshotT["source"]["ersRec"] = null;
  if (args.ers !== "off") {
    let table = null;
    let ersOrigin: "live" | "fixture" = "fixture";
    if (args.ers === "live") {
      try {
        console.log("→ a obter tabela de reclamações (ERS)…");
        table = await fetchErsTable();
        ersOrigin = "live";
        mkdirSync(resolve(out, "raw"), { recursive: true });
        writeFileSync(resolve(out, "raw", `ers-rec-${table.period}.json`), JSON.stringify(table));
      } catch (e) {
        console.warn(
          `  ⚠ ERS indisponível (${e instanceof Error ? e.message : e}); a usar fixture`,
        );
      }
    }
    if (!table) {
      const path = args.ers === "live" ? "fixtures/ers-rec-2026-S1.pdf" : args.ers;
      table = await parseErsTable(new Uint8Array(readFileSync(resolve(path))), `file://${path}`);
    }
    const overridesPath = resolve("fixtures/ers-name-overrides.json");
    const overrides = existsSync(overridesPath)
      ? (JSON.parse(readFileSync(overridesPath, "utf8")) as Record<string, string>)
      : {};
    const st = applyErsComplaints(normalized.entities, table, overrides);
    const matched = st.exact + st.fuzzy + st.manual;
    ersMeta = {
      period: table.period,
      sourceUrl: table.sourceUrl,
      fetchedAt: table.fetchedAt,
      origin: ersOrigin,
      entitiesInTable: table.rows.length,
      matched,
    };
    console.log(
      `  ${table.period} · ${table.rows.length} entidades na tabela · ${matched} cruzadas (${st.exact} exatas, ${st.fuzzy} por semelhança, ${st.manual} manuais) · ${st.unmatched} sem match`,
    );
    writeJson(resolve(out, `ers-suggestions-${table.period}.json`), st.suggestions);
  }

  // enriquecimento 3: coordenadas em falta (CP7 de outro local → GEO API PT com cache → centróide CP4)
  const cachePath = resolve(out, "geocode-cache.json");
  const cache = loadCache(cachePath);
  const geo = await geocodeMissing(normalized.locations, { cache, useApi: args.geocodeApi });
  saveCache(cachePath, cache);
  console.log(
    `→ geocodificação: ${geo.exact} exatas · ${geo.approx} aproximadas · ${geo.unresolved} por resolver · ${geo.apiCalls} pedidos à API${geo.rateLimited ? " (limite atingido)" : ""}`,
  );

  // sinais por local (atividade, âmbito, reclamações, volume, …)
  const signalCounts = computeSignals(
    normalized.locations,
    normalized.entities,
    { transparencia: trMeta, ersRec: ersMeta },
    version,
  );
  console.log(
    `→ sinais: ${Object.entries(signalCounts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );

  // privacidade: o NIF de pessoas singulares não é publicado (pseudónimo estável)
  const pseudonymised = pseudonymiseNaturalPersons(normalized.entities, normalized.locations);
  console.log(`→ privacidade: ${pseudonymised} entidades singulares com NIF pseudonimizado`);

  console.log(`→ a ler tabela MCDT ${args.mcdt}`);
  const mcdt = await parseMcdtTable(resolve(args.mcdt), args.mcdtVersion);
  console.log(`  ${mcdt.codes.length} códigos`);

  const snapshot: SnapshotT = {
    schemaVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    source: {
      sdmReportDate: extracted.reportDate,
      sdmFetchedAt: origin === "live" ? new Date().toISOString() : null,
      sdmOrigin: origin,
      mcdtTableVersion: mcdt.version,
      transparencia: trMeta,
      geocoded: { exact: geo.exact, approx: geo.approx, unresolved: geo.unresolved },
      ersRec: ersMeta,
    },
    counts: {
      entities: normalized.entities.length,
      locations: normalized.locations.length,
      conventions: normalized.locations.reduce((s, l) => s + l.conventions.length, 0),
      withCoords: normalized.locations.filter((l) => l.coords).length,
      mcdtCodes: mcdt.codes.length,
    },
    areas: normalized.areas,
    entities: normalized.entities,
    locations: normalized.locations,
  };

  const latestPath = resolve(out, "latest.json");
  let previous: SnapshotT | null = null;
  if (existsSync(latestPath)) {
    const parsed = Snapshot.safeParse(JSON.parse(readFileSync(latestPath, "utf8")));
    if (parsed.success) previous = parsed.data;
    else
      console.warn(
        "  ⚠ latest.json anterior não valida contra o schema atual; comparação com o anterior ignorada",
      );
  }

  const report = buildReport({ snapshot, previous, normalized, mcdt });
  report.signals = signalCounts;
  const failed = report.gates.filter((g) => !g.passed);
  console.log("→ portas de qualidade:");
  for (const g of report.gates) console.log(`  ${g.passed ? "✅" : "❌"} ${g.name} — ${g.detail}`);

  writeJson(resolve(out, `snapshot-${version}.json`), snapshot);
  writeJson(resolve(out, `report-${version}.json`), report);
  writeFileSync(resolve(out, `report-${version}.md`), reportToMarkdown(report));
  writeJson(resolve(out, "mcdt-codes.json"), mcdt);

  if (failed.length > 0) {
    console.error(`✗ ${failed.length} porta(s) falharam; latest.json NÃO foi atualizado.`);
    process.exitCode = 2;
  } else {
    writeJson(latestPath, snapshot);
    writeJson(resolve(out, "report-latest.json"), report);
    console.log(
      `✓ latest.json atualizado (${version}) em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}

main().catch((e) => {
  console.error("✗ ingestão falhou:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
