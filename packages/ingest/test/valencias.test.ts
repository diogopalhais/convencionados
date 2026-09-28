import { describe, expect, it } from "vitest";
import { matchValencia, parseValencias, splitValencias } from "../src/valencias.js";

describe("splitValencias", () => {
  it("separa <li> e <br>, limpa entidades e espaços", () => {
    const html =
      "<ul><li>Bioquímica</li><li> Microbiologia</li></ul>Radiologia Convencional<br/> Mamografia &amp; Eco";
    expect(splitValencias(html)).toEqual([
      "Bioquímica",
      "Microbiologia",
      "Radiologia Convencional",
      "Mamografia & Eco",
    ]);
  });
  it("trata \\r\\n literal como quebra de linha", () => {
    expect(splitValencias("Ecografias\\r\\nEcocardiograma (1530.4)")).toEqual([
      "Ecografias",
      "Ecocardiograma (1530.4)",
    ]);
  });
  it("devolve [] para vazio e sentinela", () => {
    expect(splitValencias("---")).toEqual([]);
    expect(splitValencias(undefined)).toEqual([]);
  });
});

describe("matchValencia", () => {
  it("extrai códigos convencionados entre parênteses", () => {
    const m = matchValencia("Ecocardiograma transtorácico bidimensional (com doppler) (1530.4)");
    expect(m.convCodes).toEqual(["1530.4"]);
    expect(m.tags).toContain("ecocardiograma");
  });
  it("deteta famílias sem acentos e com siglas", () => {
    expect(matchValencia("TAC da coluna lombar").tags).toContain("tc");
    expect(matchValencia("Tomografia Computorizada").tags).toContain("tc");
    expect(matchValencia("Ecografias (exceto Obstétricas)").tags).toContain("ecografia");
    expect(matchValencia("Osteodensitometria").tags).toContain("densitometria");
  });
  it("parseValencias combina tudo", () => {
    const out = parseValencias("<ul><li>ECG simples</li><li>Prova de esforço e Holter</li></ul>");
    expect(out.map((v) => v.tags)).toEqual([["ecg"], ["holter", "prova de esforco"]]);
  });
});
