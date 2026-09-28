import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McdtTable, Snapshot } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { activityFactor, findMcdtCode, Index } from "../src/search";

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../data/latest.json"), "utf8"),
) as Snapshot;
const mcdt = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../data/mcdt-codes.json"), "utf8"),
) as McdtTable;
const index = new Index(snapshot);
const LISBOA = { lat: 38.7223, lon: -9.1393 };

describe("Index.search", () => {
  it("constrói o índice em menos de 1s", () => {
    const t0 = performance.now();
    new Index(snapshot);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("'ecografia tiroide' devolve sobretudo radiologia e realça a valência", () => {
    const hits = index.search({ query: "ecografia tiroide", areaCodes: new Set(), origin: null });
    expect(hits.length).toBeGreaterThan(50);
    const radiology = hits.filter((h) => h.loc.conventions.some((c) => c.area.code === "M"));
    expect(radiology.length / hits.length).toBeGreaterThan(0.6);
    expect(hits[0]?.matchedValencias.length).toBeGreaterThan(0);
  });

  it("sinónimos: 'TAC' encontra quem só escreve 'TC' ou 'Tomografia'", () => {
    const hits = index.search({ query: "TAC", areaCodes: new Set(), origin: null });
    expect(hits.length).toBeGreaterThan(30);
    const someTomografia = hits.some((h) =>
      h.loc.conventions.some((c) => c.valencias.some((v) => /tomografia|\bTC\b/i.test(v.text))),
    );
    expect(someTomografia).toBe(true);
  });

  it("filtro por área restringe e ordena por distância com origem", () => {
    const hits = index.search({ query: "", areaCodes: new Set(["C"]), origin: LISBOA, limit: 20 });
    expect(hits.length).toBe(20);
    for (const h of hits) expect(h.loc.conventions.some((c) => c.area.code === "C")).toBe(true);
    const d = hits.map((h) => h.distanceKm ?? Number.POSITIVE_INFINITY);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(d[0]).toBeLessThan(5);
  });

  it("pesquisa por localidade funciona sem acentos", () => {
    const hits = index.search({ query: "setubal analises", areaCodes: new Set(), origin: null });
    expect(hits.some((h) => /set[uú]bal/i.test(h.loc.address.locality ?? ""))).toBe(true);
  });

  it("código convencionado nas valências filtra por convCode", () => {
    const hits = index.search({
      query: "",
      areaCodes: new Set(["C"]),
      origin: null,
      convCode: "1530.4",
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits)
      expect(
        h.loc.conventions.some((c) => c.valencias.some((v) => v.convCodes.includes("1530.4"))),
      ).toBe(true);
  });
});

describe("findMcdtCode", () => {
  it("reconhece o código convencionado completo", () => {
    const c = findMcdtCode("748.0", mcdt);
    expect(c?.areaCode).toBe("M");
    expect(c?.description).toMatch(/tir[oó]ide/i);
  });
  it("reconhece o cod_mcdt de 6 dígitos e o código SNS", () => {
    expect(findMcdtCode("770748", mcdt)?.convCode).toBe("748.0");
    expect(findMcdtCode("40550", mcdt)?.convCode).toBe("1530.4");
  });
  it("ignora texto normal", () => {
    expect(findMcdtCode("ecografia", mcdt)).toBeNull();
  });
});

describe("atividade na relevância", () => {
  const latest = snapshot.source.transparencia?.latestMonth ?? null;
  it("o snapshot tem dados da Transparência", () => {
    expect(latest).toMatch(/^\d{4}-\d{2}$/);
  });
  it("pesquisa só por área ordena locais com faturação recente primeiro", () => {
    const hits = index.search({ query: "", areaCodes: new Set(["M"]), origin: null, limit: 500 });
    const first = hits.slice(0, 30);
    expect(first.every((h) => h.activityFactor >= 0.9)).toBe(true);
    const last = hits[hits.length - 1]!;
    expect(last.activityFactor).toBeLessThan(first[0]!.activityFactor);
  });
  it("com texto, a pontuação textual é multiplicada pelo fator", () => {
    const hits = index.search({
      query: "ecografia",
      areaCodes: new Set(),
      origin: null,
      limit: 500,
    });
    const inactive = hits.filter((h) => h.activityFactor < 0.5);
    const active = hits.filter((h) => h.activityFactor >= 0.9);
    expect(inactive.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(inactive.length);
    // um inativo nunca aparece nas primeiras 10 posições
    expect(hits.slice(0, 10).some((h) => h.activityFactor < 0.5)).toBe(false);
  });
  it("hemodiálise é neutra (fora da Transparência)", () => {
    const onlyK = snapshot.locations.find(
      (l) => l.conventions.length > 0 && l.conventions.every((c) => c.area.code === "K"),
    );
    expect(onlyK).toBeDefined();
    const factor = activityFactor(onlyK!, latest);
    expect(factor).toBe(1);
  });
});
