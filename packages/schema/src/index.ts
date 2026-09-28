import { z } from "zod";

/** Códigos de área MCDT tal como usados pelo SDM (sub_tipo_prestacao) e pela tabela ACSS. */
export const AreaRef = z.object({
  code: z.string().min(1).max(2),
  name: z.string().min(1),
});
export type AreaRef = z.infer<typeof AreaRef>;

export const Coords = z.object({
  lat: z.number().min(29).max(43), // Continente + Madeira + Açores
  lon: z.number().min(-32).max(-6),
});
export type Coords = z.infer<typeof Coords>;

export const Address = z.object({
  street: z.string(),
  postalCode: z
    .string()
    .regex(/^\d{4}-\d{3}$/)
    .nullable(),
  locality: z.string().nullable(),
  parishCode: z.string().nullable(),
  parishName: z.string().nullable(),
  municipalityCode: z.string().nullable(),
  municipalityName: z.string().nullable(),
  districtCode: z.string().nullable(),
  districtName: z.string().nullable(),
});
export type Address = z.infer<typeof Address>;

/** Reclamações e elogios registados pela ERS sobre a entidade (tabela semestral "Reclamações em números"). */
export const ErsComplaints = z.object({
  /** ex. "2026-S1" */
  period: z.string().regex(/^\d{4}-S[12]$/),
  complaints: z.number().int(),
  praise: z.number().int(),
  /** nome tal como consta no registo da ERS (SRER) */
  ersName: z.string(),
  matchMethod: z.enum(["exact", "fuzzy", "manual"]),
});
export type ErsComplaints = z.infer<typeof ErsComplaints>;

/**
 * NIF de 9 dígitos, ou pseudónimo `P` + 8 hex quando o titular é pessoa singular
 * (NIF a começar por 1, 2 ou 3): o NIF de uma pessoa é dado pessoal e não é publicado.
 */
export const Nif = z.string().regex(/^(\d{9}|P[0-9A-F]{8})$/);
export const isNaturalPersonNif = (nif: string) => /^[123]\d{8}$/.test(nif);
export const isPseudonymNif = (nif: string) => nif.startsWith("P");

export const Entity = z.object({
  nif: Nif,
  name: z.string().min(1),
  legalNature: z.string().nullable(),
  sdmManagerId: z.number().int(),
  hq: Address.nullable(),
  /** null = entidade não encontrada na tabela da ERS (sem processos no período, ou nome não cruzado) */
  complaints: ErsComplaints.nullable(),
});
export type Entity = z.infer<typeof Entity>;

export const ValenciaMatch = z.object({
  text: z.string(),
  /** códigos convencionados (ex. "1530.4") encontrados no texto */
  convCodes: z.array(z.string()),
  /** famílias de exame detetadas por dicionário (ex. "ecografia", "tc") */
  tags: z.array(z.string()),
});
export type ValenciaMatch = z.infer<typeof ValenciaMatch>;

/** Faturação ao SNS desta entidade nesta área (Transparência SNS, últimos 12 meses disponíveis). */
export const Activity = z.object({
  /** último mês com requisições aceites, formato YYYY-MM */
  lastMonth: z.string().regex(/^\d{4}-\d{2}$/),
  months: z.number().int(),
  requests: z.number().int(),
  acts: z.number().int(),
});
export type Activity = z.infer<typeof Activity>;

export const Convention = z.object({
  contractCode: z.string().min(1),
  /** entidade titular desta convenção; pode diferir da entidade "dona" do local (ex. radiologia dentro de um hospital) */
  entityNif: Nif,
  /** nome do prestador tal como aparece nesta convenção, quando difere do nome do local */
  providerName: z.string().nullable(),
  area: AreaRef,
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  scope: z.string().nullable(),
  valencias: z.array(ValenciaMatch),
  notes: z.string().nullable(),
  /** null = sem faturação registada nos últimos 12 meses (ou área fora da Transparência, ex. hemodiálise) */
  activity: Activity.nullable(),
});
export type Convention = z.infer<typeof Convention>;

/** Sinal objetivo e explicável sobre um local, calculado na ingestão. */
export const Signal = z.object({
  code: z.enum([
    "active",
    "stale",
    "national",
    "regional",
    "few-complaints",
    "many-complaints",
    "praised",
    "no-complaints",
    "high-volume",
    "multi-area",
    "longevity",
    "sns24-email",
    "approx-location",
  ]),
  tone: z.enum(["positive", "warning", "neutral"]),
  label: z.string(),
  /** o "porquê", numa frase, com os números que sustentam o sinal */
  detail: z.string(),
  /** menor = mais importante; usado para escolher as 3 tags do cartão */
  priority: z.number().int(),
});
export type Signal = z.infer<typeof Signal>;

export const Location = z.object({
  id: z.number().int(),
  nif: Nif,
  name: z.string().min(1),
  address: Address,
  coords: Coords.nullable(),
  /** sdm: coordenadas da fonte · geocoded: código postal exato · approx: centróide do CP4 · none */
  coordsSource: z.enum(["sdm", "geocoded", "approx", "none"]),
  phones: z.array(z.string()),
  email: z.string().nullable(),
  emailSns24: z.string().nullable(),
  region: z.string().nullable(),
  uls: z.string().nullable(),
  conventions: z.array(Convention).min(1),
  signals: z.array(Signal),
});
export type Location = z.infer<typeof Location>;

export const McdtCode = z.object({
  /** código convencionado com dígito de controlo, ex. "748.0" */
  convCode: z.string(),
  snsCode: z.string().nullable(),
  areaCode: z.string(),
  description: z.string(),
  group: z.string().nullable(),
  price: z.number().nullable(),
  copay: z.number().nullable(),
});
export type McdtCode = z.infer<typeof McdtCode>;

export const SnapshotCounts = z.object({
  entities: z.number().int(),
  locations: z.number().int(),
  conventions: z.number().int(),
  withCoords: z.number().int(),
  mcdtCodes: z.number().int(),
});

export const Snapshot = z.object({
  schemaVersion: z.literal(1),
  version: z.string(), // YYYY-MM-DD
  generatedAt: z.string(),
  source: z.object({
    sdmReportDate: z.string().nullable(),
    sdmFetchedAt: z.string().nullable(),
    sdmOrigin: z.enum(["live", "fixture"]),
    mcdtTableVersion: z.string().nullable(),
    transparencia: z
      .object({
        latestMonth: z.string(),
        since: z.string(),
        fetchedAt: z.string(),
        origin: z.enum(["live", "fixture"]),
      })
      .nullable(),
    geocoded: z
      .object({ exact: z.number().int(), approx: z.number().int(), unresolved: z.number().int() })
      .nullable(),
    ersRec: z
      .object({
        period: z.string(),
        sourceUrl: z.string(),
        fetchedAt: z.string(),
        origin: z.enum(["live", "fixture"]),
        entitiesInTable: z.number().int(),
        matched: z.number().int(),
      })
      .nullable(),
  }),
  counts: SnapshotCounts,
  areas: z.array(AreaRef),
  entities: z.array(Entity),
  locations: z.array(Location),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const McdtTable = z.object({
  version: z.string(),
  codes: z.array(McdtCode),
});
export type McdtTable = z.infer<typeof McdtTable>;

/** Relatório de qualidade produzido pela ingestão; a PWA mostra-o em /qualidade. */
export const QualityReport = z.object({
  version: z.string(),
  generatedAt: z.string(),
  gates: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    }),
  ),
  counts: SnapshotCounts,
  coverage: z.record(z.string(), z.object({ count: z.number(), pct: z.number() })),
  byArea: z.array(z.object({ area: AreaRef, conventions: z.number(), locations: z.number() })),
  byRegion: z.array(z.object({ region: z.string(), locations: z.number() })),
  valencias: z.object({
    total: z.number(),
    withConvCode: z.number(),
    withTag: z.number(),
    unmatched: z.number(),
    unmatchedSamples: z.array(z.string()),
    convCodesNotInTable: z.array(z.string()),
  }),
  anomalies: z.array(
    z.object({ kind: z.string(), locationId: z.number().nullable(), detail: z.string() }),
  ),
  schemaErrors: z.array(z.string()),
  /** contagem de locais por sinal */
  signals: z.record(z.string(), z.number()).optional(),
});
export type QualityReport = z.infer<typeof QualityReport>;
