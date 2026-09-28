import type { ValenciaMatch } from "@sns-conv/schema";

/** Dicionário de famílias de exame → padrões (sem acentos, minúsculas). */
export const TAG_PATTERNS: Record<string, RegExp> = {
  ecografia: /\becografi|\beco\b|ecodoppler|\bdoppler\b/,
  ecocardiograma: /ecocardiogra/,
  mamografia: /mamografi/,
  tc: /\btc\b|\btac\b|tomografia computorizada|angio-?tc/,
  rm: /\brm\b|\brmn\b|ressonancia magnetica/,
  "raio-x": /raio-?x|radiologia convencional|radiologia geral|radiografia|\brx\b/,
  ortopantomografia: /ortopantomografi/,
  densitometria: /osteodensitometri|densitometri/,
  ecg: /\becg\b|eletrocardiogra|electrocardiogra/,
  holter: /holter/,
  "prova de esforco": /prova de esforco/,
  "analises clinicas":
    /bioquimic|hematologi|microbiologi|imunologi|serologi|analises clinic|endocrinologia laboratorial|monitorizacao de farmacos|toxicologia|patologia molecular|citometria|hemostase|imunohemoterapi|genetica/,
  endoscopia:
    /endoscopi|colonoscopi|gastroscopi|retossigmoidoscopi|rectosigmoidoscopi|rectoscopi|anuscopi|polipectomi|tatuagem colica|\bsedac|\bsedar|enteroscopi|capsula endoscop|\bcpre\b/,
  fisioterapia:
    /fisioterapi|medicina fisica|reabilitac|cinesiterapi|hidroterapi|eletroterapi|electroterapi|mecanoterapi|fototerapi|termoterapi|vibroterapi|massoterapi|treinos? terapeut|terapia ocupacional|terapia da fala|hidrocinesi|tecnicas terapeuticas|ensino e treino/,
  espirometria:
    /espirometri|prova(s)? funciona(l|is) respirat|ventiloterapi|mecanica ventilat|prova broncodilat|prova inespecif|pletismografi|oximetri/,
  eeg: /\beeg\b|eletroencefalogra|electroencefalogra/,
  audiometria: /audiometri|audiograma|timpanogra|otoemiss|potenciais evocados auditivos/,
  "anatomia patologica": /anatomia patolog|citolog|histolog|citopatolog|histopatolog|biopsia/,
  "medicina nuclear": /cintigrafi|medicina nuclear|\bpet\b/,
  hemodialise: /hemodialis|dialise/,
  psicologia: /psicolog/,
  "actos complementares": /actos complementares|atos complementares|tecnicas terapeuticas medicas/,
};

const CONV_CODE = /\b(\d{3,4}\.\d)\b/g;

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Converte o HTML livre do campo `valencias` numa lista de linhas limpas. */
export function splitValencias(html: string | undefined | null): string[] {
  if (!html || html === "---") return [];
  return (
    decodeEntities(html)
      // o SDM guarda por vezes quebras de linha como texto literal "\\r\\n"
      .replace(/\\r\\n|\\n|\\r/g, "\n")
      .replace(/<\s*\/?\s*(li|br|p|div|tr|ul|ol)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((l) =>
        l
          .replace(/\s+/g, " ")
          .replace(/^[\s•·\-–|]+|[\s;|]+$/g, "")
          .trim(),
      )
      .filter((l) => l.length > 1)
  );
}

export function matchValencia(text: string): ValenciaMatch {
  const codes = new Set<string>();
  for (const m of text.matchAll(CONV_CODE)) if (m[1]) codes.add(m[1]);
  const norm = normalizeText(text);
  const tags = Object.entries(TAG_PATTERNS)
    .filter(([, re]) => re.test(norm))
    .map(([tag]) => tag);
  return { text, convCodes: [...codes], tags };
}

export function parseValencias(html: string | undefined | null): ValenciaMatch[] {
  return splitValencias(html).map(matchValencia);
}
