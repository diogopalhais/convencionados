import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSdm } from "../src/extract.js";
import { geocodeMissing } from "../src/geocode.js";
import { normalize } from "../src/normalize.js";
import { extractSdmAux } from "../src/sdm-aux.js";
import { applyActivity, buildActivityIndex, type TransparenciaData } from "../src/transparencia.js";
import { sdmFixtureHtml } from "./fixture.js";

const html = sdmFixtureHtml();
const aux = extractSdmAux(html);
const ex = extractSdm(html);
const tr = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/transparencia-2026-09-24.json"), "utf8"),
) as TransparenciaData;

describe("listas auxiliares do SDM", () => {
  it("lê distritos, concelhos e freguesias", () => {
    expect(aux.districts.size).toBe(18);
    expect(aux.municipalities.size).toBeGreaterThan(250);
    expect(aux.parishes.size).toBeGreaterThan(800);
    expect(aux.districts.get("11")).toBe("Lisboa");
    expect(aux.municipalities.get("1106")).toBe("Lisboa");
  });
  it("normalize preenche nomes de concelho e distrito em quase todos os locais", () => {
    const n = normalize(ex.records, aux);
    const withMun = n.locations.filter((l) => l.address.municipalityName).length;
    expect(withMun / n.locations.length).toBeGreaterThan(0.98);
    const lx = n.locations.find((l) => l.address.municipalityCode === "1106");
    expect(lx?.address.districtName).toBe("Lisboa");
  });
});

describe("Transparência SNS → atividade por convenção", () => {
  const n = normalize(ex.records, aux);
  const idx = buildActivityIndex(tr, n.areas);
  it("faz corresponder todas as áreas da Transparência às áreas do SDM", () => {
    expect(idx.unmatchedAreas).toEqual([]);
    expect(idx.latestMonth).toBe("2026-06");
    expect(idx.byKey.size).toBeGreaterThan(900);
  });
  it("aplica faturação à maioria das convenções fora da hemodiálise", () => {
    const applied = applyActivity(n.locations, idx);
    const convs = n.locations.flatMap((l) => l.conventions).filter((c) => c.area.code !== "K");
    expect(applied / convs.length).toBeGreaterThan(0.85);
    const withActivity = convs.find((c) => c.activity);
    expect(withActivity?.activity?.requests).toBeGreaterThan(0);
    expect(withActivity?.activity?.lastMonth).toMatch(/^\d{4}-\d{2}$/);
  });
  it("soma 'atos não convencionados' na mesma área A", () => {
    const rows = tr.rows.filter((r) => r.area_mcdt.startsWith("ANÁLISES CLÍNICAS - ATOS"));
    expect(rows.length).toBeGreaterThan(0);
    const key = `${rows[0]!.nif}|A`;
    expect(idx.byKey.has(key)).toBe(true);
  });
});

describe("geocodificação de locais sem coordenadas (sem rede)", () => {
  it("resolve por CP7 de outro local ou por centróide CP4", async () => {
    const n = normalize(ex.records, aux);
    const missingBefore = n.locations.filter((l) => !l.coords).length;
    expect(missingBefore).toBeGreaterThan(100);
    const stats = await geocodeMissing(n.locations, { cache: {}, useApi: false });
    expect(stats.apiCalls).toBe(0);
    expect(stats.exact + stats.approx + stats.unresolved).toBe(missingBefore);
    expect(stats.exact + stats.approx).toBeGreaterThan(missingBefore * 0.8);
    for (const l of n.locations) if (l.coordsSource === "approx") expect(l.coords).not.toBeNull();
  });
  it("usa a cache em vez da API quando o CP7 já é conhecido", async () => {
    const n = normalize(ex.records, aux);
    const target = n.locations.find((l) => !l.coords && l.address.postalCode)!;
    const cache = { [target.address.postalCode!]: { lat: 40, lon: -8 } };
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await geocodeMissing([target], { cache, useApi: true, fetchImpl, delayMs: 0 });
    expect(calls).toBe(0);
    expect(target.coordsSource).toBe("geocoded");
  });
});
