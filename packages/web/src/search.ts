import type { Coords, Location, McdtCode, McdtTable, Snapshot } from "@sns-conv/schema";
import MiniSearch from "minisearch";
import { haversineKm } from "./geo";

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const norm = (s: string) => stripAccents(s).toLowerCase();

/** Sinónimos frequentes no discurso do utente → termos que existem nas valências. */
const SYNONYMS: Record<string, string[]> = {
  tac: ["tc", "tomografia"],
  tc: ["tac", "tomografia"],
  ressonancia: ["rm", "rmn"],
  rm: ["ressonancia", "rmn"],
  raio: ["rx", "radiografia", "radiologia"],
  rx: ["raio", "radiografia"],
  analises: ["bioquimica", "hematologia", "microbiologia", "laboratorio", "colheita"],
  sangue: ["analises", "bioquimica", "hematologia", "colheita"],
  eco: ["ecografia"],
  ecografia: ["eco", "ecografias"],
  fisioterapia: ["reabilitacao", "fisica"],
  colonoscopia: ["endoscopia"],
  endoscopia: ["endoscopia", "colonoscopia", "gastroscopia"],
  eletrocardiograma: ["ecg", "electrocardiograma"],
  ecg: ["eletrocardiograma"],
};

export interface SearchDoc {
  id: number;
  name: string;
  entity: string;
  locality: string;
  parish: string;
  valencias: string;
  tags: string;
  areas: string;
  convCodes: string;
}

export interface Hit {
  loc: Location;
  /** pontuação textual × fator de atividade */
  score: number;
  /** 0.35 (sem faturação há 12 meses) … 1.15 (faturou no último mês com grande volume) */
  activityFactor: number;
  distanceKm: number | null;
  matchedValencias: string[];
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

/**
 * Fator de atividade de um local, a partir da faturação ao SNS das suas convenções.
 * Recência manda; o volume dá um pequeno empurrão. Sem dados da Transparência → 1 (neutro).
 * Locais só com hemodiálise (área fora da Transparência) ficam neutros.
 */
export function activityFactor(loc: Location, latestMonth: string | null): number {
  if (!latestMonth) return 1;
  const rated = loc.conventions.filter((c) => c.area.code !== "K");
  if (rated.length === 0) return 1;
  let best: { monthsAgo: number; requests: number } | null = null;
  for (const c of rated) {
    if (!c.activity) continue;
    const monthsAgo = monthsBetween(c.activity.lastMonth, latestMonth);
    if (!best || monthsAgo < best.monthsAgo) best = { monthsAgo, requests: c.activity.requests };
  }
  if (!best) return 0.35;
  const recency =
    best.monthsAgo <= 0 ? 1 : best.monthsAgo <= 2 ? 0.95 : best.monthsAgo <= 5 ? 0.8 : 0.6;
  const volume = 1 + Math.min(0.15, Math.log10(1 + best.requests) / 30);
  return recency * volume;
}

export class Index {
  private mini: MiniSearch<SearchDoc>;
  private byId: Map<number, Location>;
  private entityName: Map<string, string>;
  private activity: Map<number, number>;

  constructor(public snapshot: Snapshot) {
    this.byId = new Map(snapshot.locations.map((l) => [l.id, l]));
    this.entityName = new Map(snapshot.entities.map((e) => [e.nif, e.name]));
    const latestMonth = snapshot.source.transparencia?.latestMonth ?? null;
    this.activity = new Map(snapshot.locations.map((l) => [l.id, activityFactor(l, latestMonth)]));
    this.mini = new MiniSearch<SearchDoc>({
      fields: ["name", "entity", "locality", "parish", "valencias", "tags", "areas", "convCodes"],
      storeFields: [],
      processTerm: (term) => {
        const t = norm(term);
        return t.length < 2 ? null : t;
      },
      searchOptions: {
        boost: { name: 2, valencias: 1.6, tags: 1.8, areas: 1.2, convCodes: 3 },
        prefix: true,
        fuzzy: (term) => (term.length > 5 ? 0.15 : false),
        combineWith: "AND",
      },
    });
    this.mini.addAll(
      snapshot.locations.map((l) => ({
        id: l.id,
        name: l.name,
        entity: this.entityName.get(l.nif) ?? "",
        locality: `${l.address.locality ?? ""} ${l.address.postalCode ?? ""}`,
        parish: l.address.parishName ?? "",
        valencias: l.conventions.flatMap((c) => c.valencias.map((v) => v.text)).join(" · "),
        tags: l.conventions.flatMap((c) => c.valencias.flatMap((v) => v.tags)).join(" "),
        areas: l.conventions.map((c) => c.area.name).join(" "),
        convCodes: l.conventions.flatMap((c) => c.valencias.flatMap((v) => v.convCodes)).join(" "),
      })),
    );
  }

  get(id: number) {
    return this.byId.get(id);
  }
  entity(nif: string) {
    return this.entityName.get(nif) ?? nif;
  }

  private expand(q: string): string {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const out = new Set(words);
    for (const w of words) for (const s of SYNONYMS[w] ?? []) out.add(s);
    return [...out].join(" ");
  }

  search(opts: {
    query: string;
    areaCodes: Set<string>;
    origin: Coords | null;
    convCode?: string | null;
    limit?: number;
  }): Hit[] {
    const { query, areaCodes, origin, convCode } = opts;
    const q = query.trim();
    let candidates: { id: number; score: number; terms: string[] }[];
    if (q.length >= 2) {
      const expanded = this.expand(q);
      // OR entre sinónimos, mas exige que pelo menos um termo original esteja presente
      const res = this.mini.search(expanded, { combineWith: "OR" });
      candidates = res.map((r) => ({ id: r.id as number, score: r.score, terms: r.terms }));
    } else {
      // sem texto: a relevância é só a atividade
      candidates = this.snapshot.locations.map((l) => ({ id: l.id, score: 1, terms: [] }));
    }

    const hits: Hit[] = [];
    for (const c of candidates) {
      const loc = this.byId.get(c.id);
      if (!loc) continue;
      if (areaCodes.size > 0 && !loc.conventions.some((cv) => areaCodes.has(cv.area.code)))
        continue;
      if (
        convCode &&
        !loc.conventions.some((cv) => cv.valencias.some((v) => v.convCodes.includes(convCode)))
      )
        continue;
      const matched = new Set<string>();
      if (c.terms.length) {
        for (const cv of loc.conventions)
          for (const v of cv.valencias) {
            const t = norm(v.text);
            if (c.terms.some((term) => t.includes(term))) matched.add(v.text);
          }
      }
      const factor = this.activity.get(loc.id) ?? 1;
      hits.push({
        loc,
        score: c.score * factor,
        activityFactor: factor,
        distanceKm: origin && loc.coords ? haversineKm(origin, loc.coords) : null,
        matchedValencias: [...matched].slice(0, 3),
      });
    }

    if (origin) {
      hits.sort((a, b) => {
        // com origem: distância manda, mas empurra para cima quem tem match forte no texto
        const da = a.distanceKm ?? 9999;
        const db = b.distanceKm ?? 9999;
        if (q.length >= 2) {
          const sa = da / (1 + Math.min(a.score, 20) / 10);
          const sb = db / (1 + Math.min(b.score, 20) / 10);
          return sa - sb;
        }
        return da - db;
      });
    } else {
      hits.sort((a, b) => b.score - a.score || a.loc.name.localeCompare(b.loc.name));
    }
    return hits.slice(0, opts.limit ?? 200);
  }
}

/** Reconhece um código MCDT (P1) na pesquisa: "770748", "748.0", "748". */
export function findMcdtCode(query: string, table: McdtTable): McdtCode | null {
  const q = query.trim();
  if (!/^\d{3,6}(\.\d)?$/.test(q)) return null;
  const byConv = table.codes.find((c) => c.convCode === q);
  if (byConv) return byConv;
  if (/^\d{6}$/.test(q)) {
    // cod_mcdt de 6 dígitos = 77 + conv sem dígito de controlo? (ex. 770748 → 748.x). Tentamos prefixo.
    const tail = q.slice(2).replace(/^0+/, "");
    return table.codes.find((c) => c.convCode.split(".")[0] === tail) ?? null;
  }
  if (/^\d{3,4}$/.test(q)) return table.codes.find((c) => c.convCode.split(".")[0] === q) ?? null;
  const bySns = table.codes.find((c) => c.snsCode === q);
  return bySns ?? null;
}
