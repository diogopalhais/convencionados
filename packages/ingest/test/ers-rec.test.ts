import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Entity } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { applyErsComplaints, canonicalName, type ErsTable, parseErsTable } from "../src/ers-rec.js";

const pdf = new Uint8Array(
  readFileSync(resolve(import.meta.dirname, "../fixtures/ers-rec-2026-S1.pdf")),
);

function entity(nif: string, name: string): Entity {
  return { nif, name, legalNature: null, sdmManagerId: 0, hq: null, complaints: null };
}

describe("parseErsTable", () => {
  it("lê o período e mais de 1000 entidades com totais plausíveis", async () => {
    const t = await parseErsTable(pdf, "file://fixture");
    expect(t.period).toBe("2026-S1");
    expect(t.rows.length).toBeGreaterThan(1000);
    const total = t.rows.reduce((s, r) => s + r.complaints, 0);
    expect(total).toBeGreaterThan(30000);
    expect(t.rows.find((r) => r.name.startsWith("SYNLABHEALTH II"))).toMatchObject({
      complaints: 21,
      praise: 12,
    });
  });
});

describe("canonicalName", () => {
  it("ignora acentos, pontuação, sufixos legais e ordem das palavras", () => {
    expect(canonicalName("Synlabhealth II, S.A.")).toBe(canonicalName("SYNLABHEALTH II, S.A."));
    expect(canonicalName("Guerreiro e Neto - Medicina de Reabilitação, Lda")).toBe(
      canonicalName("GUERREIRO & NETO - MEDICINA DE REABILITAÇÃO LDA"),
    );
    expect(canonicalName("C.T.D. - Centro de Tratamento de Doentes, Lda")).toBe(
      canonicalName("CTD - CENTRO DE TRATAMENTO DE DOENTES, LDA"),
    ); // siglas com pontos
    expect(canonicalName("Pentágono Saúde, Unipessoal, Lda")).toBe(
      canonicalName("PENTAGONO SAUDE, UNIP, LDA"),
    );
  });
});

describe("applyErsComplaints", () => {
  const table: ErsTable = {
    period: "2026-S1",
    sourceUrl: "x",
    fetchedAt: "now",
    rows: [
      { name: "SYNLABHEALTH II, S.A.", complaints: 21, praise: 12 },
      { name: "IRMANDADE DA SANTA CASA DA MISERICÓRDIA DE CASTRO DAIRE", complaints: 3, praise: 0 },
      {
        name: "CENTRO DE MEDICINA LABORATORIAL GERMANO DE SOUSA, S.A.",
        complaints: 74,
        praise: 41,
      },
    ],
  };
  it("cruza por forma canónica e por dicionário manual, e recusa falsos positivos", () => {
    const ents = [
      entity("500065012", "Synlabhealth II, S.A."),
      entity("500000001", "Irmandade da Santa Casa da Misericórdia de Riba d'Ave"),
      entity("500000002", "Germano de Sousa - Centro de Medicina Laboratorial, S.A."),
    ];
    const st = applyErsComplaints(ents, table, {
      "500000002": "CENTRO DE MEDICINA LABORATORIAL GERMANO DE SOUSA, S.A.",
    });
    expect(ents[0]!.complaints?.matchMethod).toBe("exact");
    expect(ents[0]!.complaints?.complaints).toBe(21);
    expect(ents[1]!.complaints).toBeNull(); // Riba d'Ave ≠ Castro Daire
    expect(ents[2]!.complaints?.matchMethod).toBe("manual");
    expect(st).toMatchObject({ exact: 1, manual: 1, unmatched: 1 });
  });
});
