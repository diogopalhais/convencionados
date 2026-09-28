import type { Coords } from "@sns-conv/schema";

export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number): string {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : km < 10
      ? `${km.toFixed(1)} km`
      : `${Math.round(km)} km`;
}

export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Geolocalização indisponível"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.message)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
}

export interface GeocodeResult {
  coords: Coords;
  label: string;
  source: "snapshot" | "geoapi";
}

/**
 * Índice local de códigos postais construído a partir das moradas do snapshot:
 * CP7 exato → coordenadas desse local; CP4 → centróide dos locais com esse prefixo.
 * Evita depender de um serviço externo (a GEO API PT limita pedidos) na maioria dos casos.
 */
export class PostalIndex {
  private cp7 = new Map<string, { coords: Coords; label: string }>();
  private cp4 = new Map<string, { lat: number; lon: number; n: number; label: string }>();

  constructor(
    locations: {
      coords: Coords | null;
      address: { postalCode: string | null; locality: string | null };
    }[],
  ) {
    for (const l of locations) {
      if (!l.coords || !l.address.postalCode) continue;
      const label = l.address.locality ?? l.address.postalCode;
      if (!this.cp7.has(l.address.postalCode))
        this.cp7.set(l.address.postalCode, { coords: l.coords, label });
      const k4 = l.address.postalCode.slice(0, 4);
      const agg = this.cp4.get(k4) ?? { lat: 0, lon: 0, n: 0, label };
      agg.lat += l.coords.lat;
      agg.lon += l.coords.lon;
      agg.n += 1;
      this.cp4.set(k4, agg);
    }
  }

  lookup(cp: string): GeocodeResult | null {
    const m = /^(\d{4})-?(\d{3})?$/.exec(cp.trim());
    if (!m?.[1]) return null;
    if (m[2]) {
      const exact = this.cp7.get(`${m[1]}-${m[2]}`);
      if (exact) return { ...exact, source: "snapshot" };
    }
    const agg = this.cp4.get(m[1]);
    if (agg && agg.n >= 1)
      return {
        coords: { lat: agg.lat / agg.n, lon: agg.lon / agg.n },
        label: agg.label,
        source: "snapshot",
      };
    return null;
  }
}

export class GeocodeError extends Error {
  constructor(
    message: string,
    public readonly kind: "invalid" | "not-found" | "rate-limited" | "network",
  ) {
    super(message);
  }
}

/** Código postal → coordenadas: primeiro o índice local, depois a GEO API PT (gratuita, sem chave). */
export async function geocodePostalCode(cp: string, local?: PostalIndex): Promise<GeocodeResult> {
  const m = /^(\d{4})-?(\d{3})?$/.exec(cp.trim());
  if (!m?.[1]) throw new GeocodeError("Indique um código postal no formato 1234-567", "invalid");
  const hit = local?.lookup(cp);
  if (hit) return hit;
  const path = m[2] ? `${m[1]}-${m[2]}` : m[1];
  let res: Response;
  try {
    res = await fetch(`https://json.geoapi.pt/cp/${path}`);
  } catch {
    throw new GeocodeError("Sem ligação ao serviço de códigos postais", "network");
  }
  if (res.status === 429)
    throw new GeocodeError(
      "Serviço de códigos postais ocupado; tente de novo daqui a instantes",
      "rate-limited",
    );
  if (!res.ok) throw new GeocodeError("Código postal não encontrado", "not-found");
  const j = (await res.json()) as {
    centro?: [number, number];
    Localidade?: string;
    Concelho?: string;
    partes?: { Localidade?: string }[];
  };
  if (!j.centro) throw new GeocodeError("Código postal sem coordenadas", "not-found");
  const [lat, lon] = j.centro;
  const label = j.Localidade ?? j.partes?.[0]?.Localidade ?? j.Concelho ?? path;
  return {
    coords: { lat, lon },
    label: `${label}${j.Concelho && j.Concelho !== label ? `, ${j.Concelho}` : ""}`,
    source: "geoapi",
  };
}
