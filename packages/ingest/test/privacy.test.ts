import type { Entity, Location } from "@sns-conv/schema";
import { Nif } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { pseudonymForNif, pseudonymiseNaturalPersons } from "../src/privacy.js";

const ent = (nif: string): Entity => ({
  nif,
  name: `E${nif}`,
  legalNature: null,
  sdmManagerId: 0,
  hq: null,
  complaints: null,
});
const loc = (id: number, nif: string, entityNif = nif): Location => ({
  id,
  nif,
  name: `L${id}`,
  address: {
    street: "Rua",
    postalCode: null,
    locality: null,
    parishCode: null,
    parishName: null,
    municipalityCode: null,
    municipalityName: null,
    districtCode: null,
    districtName: null,
  },
  coords: null,
  coordsSource: "none",
  phones: [],
  email: null,
  emailSns24: null,
  region: null,
  uls: null,
  conventions: [
    {
      contractCode: `C${id}`,
      entityNif,
      providerName: null,
      area: { code: "M", name: "Radiologia" },
      startDate: "2010-01-01",
      endDate: null,
      scope: "Nacional",
      valencias: [],
      notes: null,
      activity: null,
    },
  ],
  signals: [],
});

describe("pseudonymiseNaturalPersons", () => {
  it("substitui só NIFs de pessoas singulares, de forma consistente e válida no schema", () => {
    const entities = [ent("123456789"), ent("234567890"), ent("500000000"), ent("980000000")];
    const locations = [loc(1, "123456789"), loc(2, "500000000", "234567890")];
    const n = pseudonymiseNaturalPersons(entities, locations);
    expect(n).toBe(2);
    expect(entities[0]!.nif).toBe(pseudonymForNif("123456789"));
    expect(entities[2]!.nif).toBe("500000000");
    expect(locations[0]!.nif).toBe(entities[0]!.nif);
    expect(locations[1]!.nif).toBe("500000000");
    expect(locations[1]!.conventions[0]!.entityNif).toBe(entities[1]!.nif);
    for (const e of entities) expect(Nif.safeParse(e.nif).success).toBe(true);
    expect(pseudonymForNif("123456789")).toMatch(/^P[0-9A-F]{8}$/);
    expect(pseudonymForNif("123456789")).not.toBe(pseudonymForNif("123456788"));
  });
});
