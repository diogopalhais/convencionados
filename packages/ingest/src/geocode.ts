import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Coords, Location } from "@sns-conv/schema";

const UA = "sns-conv-ingest/0.1 (+contacto: diogo.palhais@appliedblockchain.com)";

export interface GeocodeCache {
  /** CP7 → coordenadas, ou null quando a API não conhece o código */
  [cp7: string]: Coords | null;
}

export function loadCache(path: string): GeocodeCache {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as GeocodeCache) : {};
}
export function saveCache(path: string, cache: GeocodeCache) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 1));
}

export interface GeocodeStats {
  exact: number; // CP7 igual a outro local com coordenadas, ou resposta da API
  approx: number; // centróide do CP4
  unresolved: number;
  apiCalls: number;
  rateLimited: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Preenche coordenadas em falta, por ordem de confiança:
 * 1. outro local do snapshot com o mesmo CP7 → "geocoded"
 * 2. GEO API PT por CP7 (com cache em disco e pausa entre pedidos) → "geocoded"
 * 3. centróide dos locais com o mesmo CP4 → "approx"
 */
export async function geocodeMissing(
  locations: Location[],
  opts: { cache: GeocodeCache; useApi: boolean; delayMs?: number; fetchImpl?: typeof fetch },
): Promise<GeocodeStats> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const stats: GeocodeStats = {
    exact: 0,
    approx: 0,
    unresolved: 0,
    apiCalls: 0,
    rateLimited: false,
  };

  const cp7 = new Map<string, Coords>();
  const cp4 = new Map<string, { lat: number; lon: number; n: number }>();
  for (const l of locations) {
    const cp = l.address.postalCode;
    if (!l.coords || !cp || l.coordsSource !== "sdm") continue;
    if (!cp7.has(cp)) cp7.set(cp, l.coords);
    const agg = cp4.get(cp.slice(0, 4)) ?? { lat: 0, lon: 0, n: 0 };
    agg.lat += l.coords.lat;
    agg.lon += l.coords.lon;
    agg.n++;
    cp4.set(cp.slice(0, 4), agg);
  }

  for (const l of locations) {
    if (l.coords) continue;
    const cp = l.address.postalCode;
    if (!cp) {
      stats.unresolved++;
      continue;
    }
    const sibling = cp7.get(cp);
    if (sibling) {
      l.coords = sibling;
      l.coordsSource = "geocoded";
      stats.exact++;
      continue;
    }
    if (opts.useApi && !stats.rateLimited) {
      if (!(cp in opts.cache)) {
        stats.apiCalls++;
        try {
          const res = await fetchImpl(`https://json.geoapi.pt/cp/${cp}`, {
            headers: { "User-Agent": UA },
          });
          if (res.status === 429) stats.rateLimited = true;
          else if (res.ok) {
            const j = (await res.json()) as { centro?: [number, number] };
            opts.cache[cp] = j.centro ? { lat: j.centro[0], lon: j.centro[1] } : null;
          } else opts.cache[cp] = null;
        } catch {
          /* rede indisponível: fica por resolver nesta execução */
        }
        await sleep(opts.delayMs ?? 300);
      }
      const hit = opts.cache[cp];
      if (hit) {
        l.coords = hit;
        l.coordsSource = "geocoded";
        stats.exact++;
        continue;
      }
    }
    const agg = cp4.get(cp.slice(0, 4));
    if (agg && agg.n >= 2) {
      l.coords = { lat: agg.lat / agg.n, lon: agg.lon / agg.n };
      l.coordsSource = "approx";
      stats.approx++;
      continue;
    }
    stats.unresolved++;
  }
  return stats;
}
