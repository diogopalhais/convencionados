import { describe, expect, it } from "vitest";
import { extractSdm, scanJsonLiteral } from "../src/extract.js";
import { sdmFixtureHtml } from "./fixture.js";

describe("scanJsonLiteral", () => {
  it("encontra o fim respeitando strings com chavetas", () => {
    const s = 'x = {"a":"}","b":[1,{"c":"]"}]} tail';
    const start = s.indexOf("{");
    expect(s.slice(start, scanJsonLiteral(s, start))).toBe('{"a":"}","b":[1,{"c":"]"}]}');
  });
});

describe("extractSdm (fixture 2026-09-24)", () => {
  const ex = extractSdm(sdmFixtureHtml());
  it("lê a data do relatório", () => expect(ex.reportDate).toBe("2026-09-24"));
  it("extrai todos os registos", () => expect(ex.records.length).toBe(3280));
  it("registo tem os campos essenciais", () => {
    const r = ex.records[0]!;
    expect(r.id_prestador).toBeTypeOf("number");
    expect(r.data.nif_entid_gest).toMatch(/^\d{9}$/);
    expect(r.data.sub_tipo_prestacao).toMatch(/^[A-Z]$/);
    expect(r.contactos).toBeTypeOf("object");
  });
  it("falha com mensagem clara se o marcador desaparecer", () => {
    expect(() => extractSdm("<html>nada</html>")).toThrow(/ArrServAt/);
  });
});
