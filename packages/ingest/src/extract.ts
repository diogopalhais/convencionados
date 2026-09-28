import type { SdmExtract, SdmRawRecord } from "./sdm-raw.js";

const MARKER = /ArrServAt\s*=\s*(?=\{"values":\[)/;

/**
 * Encontra o fim de um literal JSON que começa em `start` (um `{` ou `[`),
 * respeitando strings e escapes. Devolve o índice exclusivo do fim.
 */
export function scanJsonLiteral(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("JSON literal não terminado");
}

/** Extrai o objeto ArrServAt e a data do relatório do HTML devolvido pelo postback do SDM. */
export function extractSdm(html: string): SdmExtract {
  const m = MARKER.exec(html);
  if (!m) throw new Error('Marcador `ArrServAt = {"values":[` não encontrado no HTML do SDM');
  const start = m.index + m[0].length;
  const end = scanJsonLiteral(html, start);
  const parsed = JSON.parse(html.slice(start, end)) as { values?: unknown };
  if (!Array.isArray(parsed.values)) throw new Error("ArrServAt.values não é um array");
  const records = parsed.values as SdmRawRecord[];
  if (records.length === 0) throw new Error("ArrServAt.values vazio");

  const dateMatch = /vigentes na data de (\d{4}-\d{2}-\d{2})/.exec(html);
  return { reportDate: dateMatch?.[1] ?? null, records };
}
