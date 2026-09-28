import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Snapshot } from "@sns-conv/schema";
import { describe, expect, it } from "vitest";
import { GeocodeError, geocodePostalCode, haversineKm, PostalIndex } from "../src/geo";

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../data/latest.json"), "utf8"),
) as Snapshot;
const index = new PostalIndex(snapshot.locations);

describe("PostalIndex", () => {
  it("resolve um CP7 presente no snapshot para as coordenadas desse local", () => {
    const withCp = snapshot.locations.find((l) => l.coords && l.address.postalCode);
    const r = index.lookup(withCp!.address.postalCode!);
    expect(r?.source).toBe("snapshot");
    expect(r?.coords).toEqual(withCp!.coords);
  });
  it("resolve um CP4 de Lisboa para um centróide na área de Lisboa", () => {
    const r = index.lookup("1000");
    expect(r).not.toBeNull();
    expect(haversineKm(r!.coords, { lat: 38.72, lon: -9.14 })).toBeLessThan(6);
  });
  it("aceita CP7 desconhecido mas com prefixo conhecido (cai no CP4)", () => {
    const r = index.lookup("4000-999");
    expect(r?.source).toBe("snapshot");
    expect(haversineKm(r!.coords, { lat: 41.15, lon: -8.61 })).toBeLessThan(8);
  });
  it("rejeita formatos inválidos", () => {
    expect(index.lookup("abc")).toBeNull();
    expect(index.lookup("12")).toBeNull();
  });
});

describe("geocodePostalCode", () => {
  it("usa o índice local sem tocar na rede", async () => {
    const r = await geocodePostalCode("1000-001", index);
    expect(r.source).toBe("snapshot");
  });
  it("lança GeocodeError 'invalid' para texto que não é código postal", async () => {
    await expect(geocodePostalCode("lisboa", index)).rejects.toBeInstanceOf(GeocodeError);
    await expect(geocodePostalCode("lisboa", index)).rejects.toMatchObject({ kind: "invalid" });
  });
});
