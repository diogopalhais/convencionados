import { scanJsonLiteral } from "./extract.js";

export interface SdmAux {
  districts: Map<string, string>;
  municipalities: Map<string, string>;
  parishes: Map<string, string>;
}

function readArray<T>(html: string, name: string): T[] {
  const m = new RegExp(`${name}\\s*=\\s*`).exec(html);
  if (!m) return [];
  const start = m.index + m[0].length;
  if (html[start] !== "{") return [];
  const end = scanJsonLiteral(html, start);
  const parsed = JSON.parse(html.slice(start, end)) as { values?: T[] };
  return Array.isArray(parsed.values) ? parsed.values : [];
}

/** Listas auxiliares do relatório SDM: códigos DICOFRE → nomes de distrito, concelho e freguesia. */
export function extractSdmAux(html: string): SdmAux {
  const districts = new Map<string, string>();
  for (const d of readArray<{ CDistMor: string; DesDistMor: string }>(
    html,
    "array_lista_distritos_morada",
  ))
    if (d.CDistMor && d.DesDistMor) districts.set(d.CDistMor, d.DesDistMor);
  const municipalities = new Map<string, string>();
  for (const c of readArray<{ CConcMor: string; DesConcMor: string }>(
    html,
    "array_lista_concelhos_morada",
  ))
    if (c.CConcMor && c.DesConcMor) municipalities.set(c.CConcMor, c.DesConcMor);
  const parishes = new Map<string, string>();
  for (const f of readArray<{ CFregMor: string; DesFregMor: string }>(
    html,
    "array_lista_freguesias_morada",
  ))
    if (f.CFregMor && f.DesFregMor) parishes.set(f.CFregMor, f.DesFregMor);
  return { districts, municipalities, parishes };
}
