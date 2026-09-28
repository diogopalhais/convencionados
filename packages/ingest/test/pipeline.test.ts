import { Snapshot } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { extractSdm } from "../src/extract.js";
import { parseMcdtTable } from "../src/mcdt.js";
import { normalize } from "../src/normalize.js";
import { buildReport } from "../src/report.js";
import { MCDT_FIXTURE, sdmFixtureHtml } from "./fixture.js";

describe("pipeline completo sobre a fixture", () => {
  const ex = extractSdm(sdmFixtureHtml());
  const n = normalize(ex.records);

  it("normaliza sem descartar registos", () => {
    expect(n.dropped).toEqual([]);
    // local partilhado por duas entidades (radiologia dentro de um hospital) fica com 2 convenções de NIF distinto
    const shared = n.locations.find((l) => l.id === 1362)!;
    expect(new Set(shared.conventions.map((c) => c.entityNif)).size).toBe(2);
    expect(n.entities.length).toBe(828);
    expect(n.locations.length).toBe(2979);
    expect(n.locations.reduce((s, l) => s + l.conventions.length, 0)).toBe(3280);
  });

  it("tem 15 áreas com nomes", () => {
    expect(n.areas.length).toBe(15);
    expect(n.areas.find((a) => a.code === "M")?.name).toBe("Radiologia");
    expect(n.areas.find((a) => a.code === "A")?.name).toBe("Análises Clínicas");
  });

  it("coordenadas dentro de Portugal e cobertura ≥ 95%", () => {
    const withCoords = n.locations.filter((l) => l.coords);
    expect(withCoords.length / n.locations.length).toBeGreaterThan(0.95);
    for (const l of withCoords) {
      expect(l.coords!.lat).toBeGreaterThan(32);
      expect(l.coords!.lat).toBeLessThan(43);
      expect(l.coords!.lon).toBeGreaterThan(-18);
      expect(l.coords!.lon).toBeLessThan(-6);
    }
  });

  it("valida contra o schema", () => {
    const snap = {
      schemaVersion: 1 as const,
      version: ex.reportDate!,
      generatedAt: new Date().toISOString(),
      source: {
        sdmReportDate: ex.reportDate,
        sdmFetchedAt: null,
        sdmOrigin: "fixture" as const,
        mcdtTableVersion: null,
        transparencia: null,
        geocoded: null,
        ersRec: null,
      },
      counts: {
        entities: n.entities.length,
        locations: n.locations.length,
        conventions: 3280,
        withCoords: 0,
        mcdtCodes: 0,
      },
      areas: n.areas,
      entities: n.entities,
      locations: n.locations,
    };
    const parsed = Snapshot.safeParse(snap);
    if (!parsed.success) console.log(parsed.error.issues.slice(0, 5));
    expect(parsed.success).toBe(true);
  });

  it("tabela MCDT lê milhares de códigos com radiologia incluída", async () => {
    const t = await parseMcdtTable(MCDT_FIXTURE, "2026-03-01");
    expect(t.codes.length).toBeGreaterThan(700);
    const eco = t.codes.find((c) => c.convCode === "748.0");
    expect(eco?.areaCode).toBe("M");
    expect(eco?.description).toMatch(/tir[oó]ide/i);
    expect(eco?.price).toBe(26);
    const ecocardio = t.codes.find((c) => c.convCode === "1530.4");
    expect(ecocardio?.areaCode).toBe("C");
  });

  it("relatório: portas base passam", async () => {
    const mcdt = await parseMcdtTable(MCDT_FIXTURE, "2026-03-01");
    const snap = Snapshot.parse({
      schemaVersion: 1,
      version: ex.reportDate,
      generatedAt: new Date().toISOString(),
      source: {
        sdmReportDate: ex.reportDate,
        sdmFetchedAt: null,
        sdmOrigin: "fixture",
        mcdtTableVersion: mcdt.version,
        transparencia: null,
        geocoded: null,
        ersRec: null,
      },
      counts: {
        entities: n.entities.length,
        locations: n.locations.length,
        conventions: 3280,
        withCoords: n.locations.filter((l) => l.coords).length,
        mcdtCodes: mcdt.codes.length,
      },
      areas: n.areas,
      entities: n.entities,
      locations: n.locations,
    });
    const r = buildReport({ snapshot: snap, previous: null, normalized: n, mcdt });
    expect(r.gates.every((g) => g.passed)).toBe(true);
    expect(r.valencias.withConvCode + r.valencias.withTag).toBeGreaterThan(r.valencias.total * 0.6);
  });
});
