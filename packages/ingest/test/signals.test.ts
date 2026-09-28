import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Entity, Location } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { applyErsComplaints, type ErsTable } from "../src/ers-rec.js";
import { extractSdm } from "../src/extract.js";
import { normalize } from "../src/normalize.js";
import { extractSdmAux } from "../src/sdm-aux.js";
import { computeSignals } from "../src/signals.js";
import { applyActivity, buildActivityIndex, type TransparenciaData } from "../src/transparencia.js";
import { sdmFixtureHtml } from "./fixture.js";

function loc(id: number, nif: string, over: Partial<Location> = {}): Location {
  return {
    id,
    nif,
    name: `Local ${id}`,
    address: {
      street: "Rua",
      postalCode: "1000-001",
      locality: "Lisboa",
      parishCode: null,
      parishName: null,
      municipalityCode: null,
      municipalityName: null,
      districtCode: null,
      districtName: null,
    },
    coords: { lat: 38.7, lon: -9.1 },
    coordsSource: "sdm",
    phones: [],
    email: null,
    emailSns24: null,
    region: null,
    uls: null,
    conventions: [
      {
        contractCode: `C${id}`,
        entityNif: nif,
        providerName: null,
        area: { code: "M", name: "Radiologia" },
        startDate: "2010-01-01",
        endDate: null,
        scope: "Nacional",
        valencias: [],
        notes: null,
        activity: { lastMonth: "2026-06", months: 12, requests: 10000, acts: 12000 },
      },
    ],
    signals: [],
    ...over,
  };
}
function ent(nif: string, complaints: Entity["complaints"] = null): Entity {
  return { nif, name: `E${nif}`, legalNature: null, sdmManagerId: 0, hq: null, complaints };
}
const source = {
  transparencia: {
    latestMonth: "2026-06",
    since: "2025-07-01",
    fetchedAt: "x",
    origin: "fixture" as const,
  },
  ersRec: {
    period: "2026-S1",
    sourceUrl: "x",
    fetchedAt: "x",
    origin: "fixture" as const,
    entitiesInTable: 1,
    matched: 1,
  },
};

describe("computeSignals (dados sintéticos)", () => {
  it("ativo vs. sem faturação recente, âmbito, longevidade", () => {
    const stale = loc(2, "2");
    stale.conventions[0]!.activity = { lastMonth: "2025-09", months: 3, requests: 500, acts: 500 };
    const never = loc(3, "3");
    never.conventions[0]!.activity = null;
    const regional = loc(4, "4");
    regional.conventions[0]!.scope = "Regional";
    const locations = [loc(1, "1"), stale, never, regional];
    computeSignals(
      locations,
      ["1", "2", "3", "4"].map((n) => ent(n)),
      source,
      "2026-09-24",
    );
    const codes = (l: Location) => l.signals.map((s) => s.code);
    expect(codes(locations[0]!)).toContain("active");
    expect(codes(locations[0]!)).toContain("national");
    expect(codes(locations[0]!)).toContain("longevity");
    expect(codes(stale)).toContain("stale");
    expect(codes(never)).toContain("stale");
    expect(codes(regional)).toContain("regional");
    expect(codes(regional)).not.toContain("national");
    // ordem por prioridade: avisos primeiro
    expect(stale.signals[0]!.code).toBe("stale");
  });

  it("reclamações: poucas vs. muitas, por percentil dentro da área", () => {
    // 10 entidades com rácios crescentes; a última tem 10× a mediana
    const locations: Location[] = [];
    const entities: Entity[] = [];
    for (let i = 1; i <= 10; i++) {
      const nif = `${i}`;
      const l = loc(i, nif);
      l.conventions[0]!.activity = {
        lastMonth: "2026-06",
        months: 12,
        requests: 20000,
        acts: 20000,
      };
      locations.push(l);
      entities.push(
        ent(nif, {
          period: "2026-S1",
          complaints: i === 10 ? 60 : i,
          praise: i === 3 ? 9 : 0,
          ersName: `E${nif}`,
          matchMethod: "exact",
        }),
      );
    }
    const counts = computeSignals(locations, entities, source, "2026-09-24");
    expect(locations[9]!.signals.map((s) => s.code)).toContain("many-complaints");
    expect(locations[0]!.signals.map((s) => s.code)).toContain("few-complaints");
    expect(locations[2]!.signals.map((s) => s.code)).toContain("praised");
    expect(counts["few-complaints"]).toBeGreaterThanOrEqual(4);
    const detail = locations[9]!.signals.find((s) => s.code === "many-complaints")!.detail;
    expect(detail).toMatch(/por 10 000 exames pedidos/);
  });

  it("não atribui 'poucas reclamações' sem volume mínimo", () => {
    const l = loc(1, "1");
    l.conventions[0]!.activity = { lastMonth: "2026-06", months: 12, requests: 100, acts: 100 };
    const others = Array.from({ length: 6 }, (_, i) => loc(i + 2, `${i + 2}`));
    const entities = [
      ent("1", {
        period: "2026-S1",
        complaints: 0,
        praise: 0,
        ersName: "E1",
        matchMethod: "exact",
      }),
      ...others.map((o) =>
        ent(o.nif, {
          period: "2026-S1",
          complaints: 2,
          praise: 0,
          ersName: o.nif,
          matchMethod: "exact",
        }),
      ),
    ];
    computeSignals([l, ...others], entities, source, "2026-09-24");
    expect(l.signals.map((s) => s.code)).not.toContain("few-complaints");
  });
});

describe("computeSignals (fixture real)", () => {
  it("produz uma distribuição plausível", () => {
    const html = sdmFixtureHtml();
    const n = normalize(extractSdm(html).records, extractSdmAux(html));
    const tr = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../fixtures/transparencia-2026-09-24.json"),
        "utf8",
      ),
    ) as TransparenciaData;
    const idx = buildActivityIndex(tr, n.areas);
    applyActivity(n.locations, idx);
    const table = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../fixtures/ers-table-2026-S1.json"), "utf8"),
    ) as ErsTable;
    applyErsComplaints(n.entities, table);
    const counts = computeSignals(
      n.locations,
      n.entities,
      {
        transparencia: {
          latestMonth: idx.latestMonth,
          since: tr.since,
          fetchedAt: "x",
          origin: "fixture",
        },
        ersRec: {
          period: table.period,
          sourceUrl: "x",
          fetchedAt: "x",
          origin: "fixture",
          entitiesInTable: table.rows.length,
          matched: 0,
        },
      },
      "2026-09-24",
    );
    expect(counts.active).toBeGreaterThan(2000);
    expect(counts.stale).toBeGreaterThan(50);
    expect(counts.stale).toBeLessThan(400);
    expect(counts.national).toBeGreaterThan(2000);
    expect(counts["few-complaints"]).toBeGreaterThan(50);
    expect(counts["many-complaints"]).toBeGreaterThan(5);
    expect(counts["many-complaints"]).toBeLessThan(counts["few-complaints"]!);
    for (const l of n.locations) expect(l.signals.length).toBeLessThanOrEqual(8);
  });
});
