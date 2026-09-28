import type { Activity, AreaRef, Location } from "@sns-conv/schema";
import { normalizeText } from "./valencias.js";

const DATASET =
  "https://transparencia.sns.gov.pt/api/explore/v2.1/catalog/datasets/exames-convencionados-e-area-mcdt";
const UA = "sns-conv-ingest/0.1 (+contacto: diogo.palhais@appliedblockchain.com)";

export interface TransparenciaRow {
  nif: string;
  area_mcdt: string;
  last_month: string; // ISO date
  requisicoes: number;
  atos: number;
  meses: number;
}
export interface TransparenciaData {
  fetchedAt: string;
  since: string; // YYYY-MM-DD
  rows: TransparenciaRow[];
}

/** Mês mais recente disponível (a Transparência publica com atraso n-3). */
export async function fetchLatestMonth(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${DATASET}/records?select=max(data)%20as%20m&limit=1`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Transparência HTTP ${res.status}`);
  const j = (await res.json()) as { results?: { m?: string }[] };
  const m = j.results?.[0]?.m;
  if (!m) throw new Error("Transparência: sem mês máximo");
  return m.slice(0, 10);
}

/** Agrega os últimos 12 meses disponíveis por NIF e área, num único pedido ao endpoint de export. */
export async function fetchTransparencia(
  fetchImpl: typeof fetch = fetch,
): Promise<TransparenciaData> {
  const latest = await fetchLatestMonth(fetchImpl);
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 11);
  const since = d.toISOString().slice(0, 10);
  const select = [
    "nif",
    "area_mcdt",
    "max(data) as last_month",
    "sum(requisicoes_aceites) as requisicoes",
    "sum(atos_aceites) as atos",
    "count(distinct data) as meses", // uma linha por região de faturação e mês; contam-se meses distintos
  ].join(",");
  const url = `${DATASET}/exports/json?select=${encodeURIComponent(select)}&where=${encodeURIComponent(`data>=date'${since}'`)}&group_by=nif,area_mcdt`;
  const res = await fetchImpl(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Transparência export HTTP ${res.status}`);
  const rows = (await res.json()) as TransparenciaRow[];
  if (!Array.isArray(rows) || rows.length < 100)
    throw new Error(`Transparência: só ${rows.length} linhas; formato mudou?`);
  return { fetchedAt: new Date().toISOString(), since, rows };
}

/** "ANÁLISES CLÍNICAS - ATOS NÃO CONVENCIONADOS" → "analises clinicas" etc. */
function areaKey(name: string): string {
  return normalizeText(name)
    .replace(/\s*-\s*atos nao convencionados$/, "")
    .trim();
}

export interface ActivityIndex {
  latestMonth: string; // YYYY-MM
  byKey: Map<string, Activity>; // `${nif}|${areaCode}`
  unmatchedAreas: string[];
}

export function buildActivityIndex(data: TransparenciaData, areas: AreaRef[]): ActivityIndex {
  const codeByKey = new Map(areas.map((a) => [areaKey(a.name), a.code]));
  const byKey = new Map<string, Activity>();
  const unmatched = new Set<string>();
  let latest = "";
  for (const r of data.rows) {
    const code = codeByKey.get(areaKey(r.area_mcdt));
    if (!code) {
      unmatched.add(r.area_mcdt);
      continue;
    }
    const month = r.last_month.slice(0, 7);
    if (month > latest) latest = month;
    const k = `${r.nif}|${code}`;
    const prev = byKey.get(k);
    byKey.set(k, {
      lastMonth: prev && prev.lastMonth > month ? prev.lastMonth : month,
      months: Math.max(prev?.months ?? 0, r.meses),
      requests: (prev?.requests ?? 0) + r.requisicoes,
      acts: (prev?.acts ?? 0) + r.atos,
    });
  }
  return { latestMonth: latest, byKey, unmatchedAreas: [...unmatched] };
}

/** Preenche `convention.activity` a partir do NIF da convenção e da sua área. */
export function applyActivity(locations: Location[], idx: ActivityIndex): number {
  let n = 0;
  for (const l of locations)
    for (const c of l.conventions) {
      const a = idx.byKey.get(`${c.entityNif}|${c.area.code}`) ?? null;
      c.activity = a;
      if (a) n++;
    }
  return n;
}
