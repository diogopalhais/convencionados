import type { Entity, ErsComplaints } from "@sns-conv/schema";
import { extractText, getDocumentProxy } from "unpdf";
import { stripAccents } from "./valencias.js";

const PAGE = "https://www.ers.pt/pt/reclamacoes-em-numeros/";
const UA = "sns-conv-ingest/0.1 (+contacto: diogo.palhais@appliedblockchain.com)";

export interface ErsRow {
  name: string;
  complaints: number;
  praise: number;
}
export interface ErsTable {
  /** "2026-S1" */
  period: string;
  sourceUrl: string;
  fetchedAt: string;
  rows: ErsRow[];
}

/** Encontra o PDF mais recente da tabela na página "Reclamações em números". */
export async function discoverErsTableUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(PAGE, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ERS página HTTP ${res.status}`);
  const html = await res.text();
  const links = [...html.matchAll(/href="([^"]*tabela[^"]*\.pdf)"/gi)].map((m) => m[1] as string);
  if (links.length === 0) throw new Error("ERS: link da tabela não encontrado na página");
  const href = links[0] as string;
  return href.startsWith("http") ? href : `https://www.ers.pt${href}`;
}

export async function fetchErsTable(fetchImpl: typeof fetch = fetch): Promise<ErsTable> {
  const url = await discoverErsTableUrl(fetchImpl);
  const res = await fetchImpl(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ERS PDF HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return parseErsTable(bytes, url);
}

function periodFrom(text: string): string {
  const m = /(\d)[ºª°]?\s*SEMESTRE\s+DE\s+(\d{4})/i.exec(text);
  if (m) return `${m[2]}-S${m[1]}`;
  const y = /ANO\s+DE\s+(\d{4})/i.exec(text);
  if (y) return `${y[1]}-S2`; // tabela anual: tratamos como o 2.º semestre desse ano
  throw new Error("ERS: período não reconhecido no PDF");
}

const ROW = /^(.+?)\s+(\d{1,6})\s+(\d{1,6})\s*$/;

/** Extrai (nome, reclamações, elogios) de cada linha da tabela. */
export async function parseErsTable(bytes: Uint8Array, sourceUrl: string): Promise<ErsTable> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  const period = periodFrom(text.slice(0, 2000));
  const rows: ErsRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^\d+ de \d+$/.test(line) || line.startsWith("ENTIDADES")) continue;
    const m = ROW.exec(line);
    if (!m) continue;
    const name = (m[1] as string).trim();
    if (name.length < 3 || /^(Nº|N\.º)/i.test(name)) continue;
    rows.push({ name, complaints: Number(m[2]), praise: Number(m[3]) });
  }
  if (rows.length < 200)
    throw new Error(`ERS: só ${rows.length} linhas extraídas; formato do PDF mudou?`);
  return { period, sourceUrl, fetchedAt: new Date().toISOString(), rows };
}

const LEGAL =
  /\b(s\s?a|sa|lda|ldª|l\.?da|limitada|unipessoal|unip|e\s?p\s?e|epe|sociedade|ii|iii|iv|dr|dra|drª|de|da|do|das|dos|e|em|no|na)\b/g;

/** Forma canónica para cruzar nomes SDM ↔ ERS: sem acentos, pontuação, sufixos legais e artigos; tokens ordenados. */
export function canonicalName(name: string): string {
  const s = stripAccents(name)
    .toLowerCase()
    .replace(/ª/g, "a")
    .replace(/º/g, "o")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1") // siglas com pontos: c.r.t. → crt
    .replace(/\b([a-z]{1,4})\.(?=\s|$)/g, "$1")
    .replace(/[.,;:'"´`’\-–—/&()]/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

function dice(a: string, b: string): number {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export interface ErsMatchStats {
  exact: number;
  fuzzy: number;
  manual: number;
  unmatched: number;
  /** sugestões para curadoria: entidade SDM → melhor candidato ERS (não aplicado) */
  suggestions: { nif: string; name: string; candidate: string; score: number }[];
}

/**
 * Aplica `entity.complaints` a partir da tabela ERS.
 * 1. `overrides` (NIF → nome ERS exato) · 2. igualdade da forma canónica · 3. Dice ≥ 0.9 sobre tokens
 * com pelo menos 3 tokens em comum (evita falsos positivos como "Misericórdia de X" ↔ "Misericórdia de Y").
 */
export function applyErsComplaints(
  entities: Entity[],
  table: ErsTable,
  overrides: Record<string, string> = {},
): ErsMatchStats {
  const byExact = new Map<string, ErsRow>();
  const byCanon = new Map<string, ErsRow>();
  for (const r of table.rows) {
    byExact.set(r.name, r);
    const c = canonicalName(r.name);
    if (!byCanon.has(c)) byCanon.set(c, r);
  }
  const canonRows = [...byCanon.entries()];
  const stats: ErsMatchStats = { exact: 0, fuzzy: 0, manual: 0, unmatched: 0, suggestions: [] };

  const set = (e: Entity, r: ErsRow, matchMethod: ErsComplaints["matchMethod"]) => {
    e.complaints = {
      period: table.period,
      complaints: r.complaints,
      praise: r.praise,
      ersName: r.name,
      matchMethod,
    };
  };

  for (const e of entities) {
    e.complaints = null;
    const ov = overrides[e.nif];
    if (ov) {
      const r = byExact.get(ov) ?? byCanon.get(canonicalName(ov));
      if (r) {
        set(e, r, "manual");
        stats.manual++;
        continue;
      }
    }
    const canon = canonicalName(e.name);
    const exact = byCanon.get(canon);
    if (exact) {
      set(e, exact, "exact");
      stats.exact++;
      continue;
    }
    let best: { row: ErsRow; score: number; common: number } | null = null;
    const tokens = new Set(canon.split(" "));
    for (const [c, row] of canonRows) {
      const score = dice(canon, c);
      if (score < 0.8) continue;
      let common = 0;
      for (const t of c.split(" ")) if (tokens.has(t)) common++;
      if (!best || score > best.score) best = { row, score, common };
    }
    if (best && best.score >= 0.9 && best.common >= 3) {
      set(e, best.row, "fuzzy");
      stats.fuzzy++;
      continue;
    }
    if (best)
      stats.suggestions.push({
        nif: e.nif,
        name: e.name,
        candidate: best.row.name,
        score: Math.round(best.score * 100) / 100,
      });
    stats.unmatched++;
  }
  return stats;
}
