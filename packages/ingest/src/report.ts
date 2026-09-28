import {
  type McdtTable,
  type QualityReport,
  Snapshot,
  type Snapshot as SnapshotT,
} from "@sns-conv/schema";
import type { Normalized } from "./normalize.js";

export interface GateInput {
  snapshot: SnapshotT;
  previous: SnapshotT | null;
  normalized: Normalized;
  mcdt: McdtTable;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

export function buildReport({ snapshot, previous, normalized, mcdt }: GateInput): QualityReport {
  const locs = snapshot.locations;
  const convs = locs.flatMap((l) => l.conventions);
  const n = locs.length;
  const latestMonth = snapshot.source.transparencia?.latestMonth ?? "9999-12";

  const coverage: QualityReport["coverage"] = {
    coords: { count: locs.filter((l) => l.coords).length, pct: 0 },
    street: { count: locs.filter((l) => l.address.street).length, pct: 0 },
    postalCode: { count: locs.filter((l) => l.address.postalCode).length, pct: 0 },
    phone: { count: locs.filter((l) => l.phones.length > 0).length, pct: 0 },
    email: { count: locs.filter((l) => l.email).length, pct: 0 },
    emailSns24: { count: locs.filter((l) => l.emailSns24).length, pct: 0 },
    municipalityName: { count: locs.filter((l) => l.address.municipalityName).length, pct: 0 },
    coordsExactOrSdm: {
      count: locs.filter((l) => l.coordsSource === "sdm" || l.coordsSource === "geocoded").length,
      pct: 0,
    },
    valencias: { count: convs.filter((c) => c.valencias.length > 0).length, pct: 0 },
    billedLast3Months: {
      count: convs.filter(
        (c) => c.activity && monthsBetween(c.activity.lastMonth, latestMonth) <= 2,
      ).length,
      pct: 0,
    },
    billedLast12Months: { count: convs.filter((c) => c.activity).length, pct: 0 },
    ersMatchedEntities: { count: snapshot.entities.filter((e) => e.complaints).length, pct: 0 },
    ersMatchedRequests: { count: 0, pct: 0 },
  };
  // que fração das requisições ao SNS pertence a entidades com match na ERS (peso real da cobertura)
  {
    const matchedNifs = new Set(snapshot.entities.filter((e) => e.complaints).map((e) => e.nif));
    // a atividade é por NIF × área (repete-se em todos os locais da entidade): contar cada par uma vez
    const seen = new Set<string>();
    let all = 0;
    let matched = 0;
    for (const c of convs) {
      if (!c.activity) continue;
      const key = `${c.entityNif}|${c.area.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all += c.activity.requests;
      if (matchedNifs.has(c.entityNif)) matched += c.activity.requests;
    }
    coverage.ersMatchedRequests = { count: matched, pct: pct(matched, all) };
  }
  const perConvention = new Set(["valencias", "billedLast3Months", "billedLast12Months"]);
  for (const [k, v] of Object.entries(coverage)) {
    if (k === "ersMatchedRequests") continue;
    const denom =
      k === "ersMatchedEntities"
        ? snapshot.entities.length
        : perConvention.has(k)
          ? convs.length
          : n;
    v.pct = pct(v.count, denom);
  }

  const byAreaMap = new Map<
    string,
    { area: SnapshotT["areas"][number]; conventions: number; locations: Set<number> }
  >();
  for (const l of locs)
    for (const c of l.conventions) {
      const e = byAreaMap.get(c.area.code) ?? {
        area: c.area,
        conventions: 0,
        locations: new Set(),
      };
      e.conventions++;
      e.locations.add(l.id);
      byAreaMap.set(c.area.code, e);
    }
  const byArea = [...byAreaMap.values()]
    .map((e) => ({ area: e.area, conventions: e.conventions, locations: e.locations.size }))
    .sort((a, b) => b.conventions - a.conventions);

  const byRegionMap = new Map<string, number>();
  for (const l of locs)
    byRegionMap.set(
      l.region ?? "(sem região)",
      (byRegionMap.get(l.region ?? "(sem região)") ?? 0) + 1,
    );
  const byRegion = [...byRegionMap]
    .map(([region, locations]) => ({ region, locations }))
    .sort((a, b) => b.locations - a.locations);

  const allVal = convs.flatMap((c) => c.valencias);
  const tableCodes = new Set(mcdt.codes.map((c) => c.convCode));
  const notInTable = new Set<string>();
  for (const v of allVal)
    for (const code of v.convCodes) if (!tableCodes.has(code)) notInTable.add(code);
  const unmatched = allVal.filter((v) => v.convCodes.length === 0 && v.tags.length === 0);
  const sampleSet = new Map<string, number>();
  for (const u of unmatched) sampleSet.set(u.text, (sampleSet.get(u.text) ?? 0) + 1);
  const unmatchedSamples = [...sampleSet]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([t, c]) => `${c}× ${t}`);

  const anomalies: QualityReport["anomalies"] = [];
  for (const d of normalized.dropped)
    anomalies.push({ kind: "dropped", locationId: null, detail: `registo ${d.id}: ${d.reason}` });
  for (const l of locs) {
    if (!l.coords)
      anomalies.push({
        kind: "no-coords",
        locationId: l.id,
        detail: `${l.name} · ${l.address.postalCode ?? "sem CP"}`,
      });
    if (l.phones.length === 0 && !l.email)
      anomalies.push({ kind: "no-contact", locationId: l.id, detail: l.name });
    for (const c of l.conventions) {
      if (c.endDate && c.endDate < snapshot.version)
        anomalies.push({
          kind: "expired",
          locationId: l.id,
          detail: `${c.contractCode} terminou ${c.endDate}`,
        });
      if (c.valencias.length === 0)
        anomalies.push({
          kind: "no-valencias",
          locationId: l.id,
          detail: `${c.contractCode} (${c.area.name})`,
        });
      if (
        snapshot.source.transparencia &&
        !c.activity &&
        c.area.code !== "K" &&
        c.startDate &&
        c.startDate < snapshot.source.transparencia.since
      )
        anomalies.push({
          kind: "no-billing-12m",
          locationId: l.id,
          detail: `${l.name} · ${c.area.name} · desde ${c.startDate}`,
        });
    }
    if (l.coordsSource === "approx")
      anomalies.push({
        kind: "approx-coords",
        locationId: l.id,
        detail: `${l.name} · centróide do CP ${l.address.postalCode?.slice(0, 4)}`,
      });
  }
  // coordenadas duplicadas entre locais de entidades diferentes (indício de geocodificação por sede)
  const coordKey = new Map<string, number[]>();
  for (const l of locs)
    if (l.coords) {
      const k = `${l.coords.lat.toFixed(5)},${l.coords.lon.toFixed(5)}`;
      coordKey.set(k, [...(coordKey.get(k) ?? []), l.id]);
    }
  for (const [k, ids] of coordKey)
    if (ids.length >= 4)
      anomalies.push({
        kind: "shared-coords",
        locationId: null,
        detail: `${ids.length} locais em ${k}: ${ids.slice(0, 6).join(", ")}`,
      });

  const schemaErrors: string[] = [];
  const parsed = Snapshot.safeParse(snapshot);
  if (!parsed.success)
    for (const issue of parsed.error.issues.slice(0, 50))
      schemaErrors.push(`${issue.path.join(".")}: ${issue.message}`);

  const gates: QualityReport["gates"] = [
    {
      name: "schema",
      passed: parsed.success,
      detail: parsed.success ? "snapshot válido" : `${parsed.error.issues.length} erros`,
    },
    { name: "min-locations", passed: n >= 2000, detail: `${n} locais (mín. 2000)` },
    { name: "coords>=90%", passed: coverage.coords!.pct >= 90, detail: `${coverage.coords!.pct}%` },
    {
      name: "valencias>=95%",
      passed: coverage.valencias!.pct >= 95,
      detail: `${coverage.valencias!.pct}%`,
    },
    {
      name: "areas>=10",
      passed: snapshot.areas.length >= 10,
      detail: `${snapshot.areas.length} áreas`,
    },
  ];
  if (previous) {
    const prevN = previous.locations.length;
    const prevIds = new Set(previous.locations.map((l) => l.id));
    const removed = previous.locations.filter((l) => !locs.some((x) => x.id === l.id)).length;
    const added = locs.filter((l) => !prevIds.has(l.id)).length;
    gates.push({
      name: "count-vs-previous",
      passed: n >= prevN * 0.9,
      detail: `${n} vs ${prevN} (${added} novos, ${removed} removidos)`,
    });
    gates.push({
      name: "removed<10%",
      passed: removed <= prevN * 0.1,
      detail: `${removed} removidos`,
    });
  }

  return {
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    gates,
    counts: snapshot.counts,
    coverage,
    byArea,
    byRegion,
    valencias: {
      total: allVal.length,
      withConvCode: allVal.filter((v) => v.convCodes.length > 0).length,
      withTag: allVal.filter((v) => v.tags.length > 0).length,
      unmatched: unmatched.length,
      unmatchedSamples,
      convCodesNotInTable: [...notInTable].sort().slice(0, 100),
    },
    anomalies,
    schemaErrors,
  };
}

export function reportToMarkdown(r: QualityReport): string {
  const lines: string[] = [];
  lines.push(
    `# Relatório de qualidade · snapshot ${r.version}`,
    "",
    `Gerado em ${r.generatedAt}`,
    "",
  );
  lines.push("## Portas de qualidade", "", "| porta | estado | detalhe |", "|---|---|---|");
  for (const g of r.gates) lines.push(`| ${g.name} | ${g.passed ? "✅" : "❌"} | ${g.detail} |`);
  lines.push("", "## Contagens", "", "| métrica | valor |", "|---|---|");
  for (const [k, v] of Object.entries(r.counts)) lines.push(`| ${k} | ${v} |`);
  lines.push("", "## Cobertura", "", "| campo | n | % |", "|---|---|---|");
  for (const [k, v] of Object.entries(r.coverage)) lines.push(`| ${k} | ${v.count} | ${v.pct}% |`);
  lines.push("", "## Por área", "", "| área | convenções | locais |", "|---|---|---|");
  for (const a of r.byArea)
    lines.push(`| ${a.area.code} · ${a.area.name} | ${a.conventions} | ${a.locations} |`);
  lines.push("", "## Por região", "", "| região | locais |", "|---|---|");
  for (const a of r.byRegion) lines.push(`| ${a.region} | ${a.locations} |`);
  const v = r.valencias;
  lines.push(
    "",
    "## Valências",
    "",
    `- total de linhas: ${v.total}`,
    `- com código convencionado: ${v.withConvCode}`,
    `- com família (tag): ${v.withTag}`,
    `- sem match: ${v.unmatched}`,
    `- códigos referidos mas ausentes da tabela MCDT: ${v.convCodesNotInTable.length}`,
    "",
  );
  lines.push("### Amostra sem match", "");
  for (const s of v.unmatchedSamples) lines.push(`- ${s}`);
  const byKind = new Map<string, number>();
  for (const a of r.anomalies) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  lines.push("", "## Anomalias", "", "| tipo | n |", "|---|---|");
  for (const [k, n] of byKind) lines.push(`| ${k} | ${n} |`);
  if (r.signals) {
    lines.push("", "## Sinais (locais)", "", "| sinal | n |", "|---|---|");
    for (const [k, n] of Object.entries(r.signals).sort((a, b) => b[1] - a[1]))
      lines.push(`| ${k} | ${n} |`);
  }
  if (r.schemaErrors.length) {
    lines.push("", "## Erros de schema", "");
    for (const e of r.schemaErrors) lines.push(`- ${e}`);
  }
  return `${lines.join("\n")}\n`;
}
