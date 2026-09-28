import type { Address, AreaRef, Convention, Entity, Location } from "@sns-conv/schema";
import type { SdmAux } from "./sdm-aux.js";
import type { SdmRawRecord } from "./sdm-raw.js";
import { parseValencias } from "./valencias.js";

const EMPTY = new Set(["", "---", "null", "undefined"]);

export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return EMPTY.has(s) ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "---") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function date(v: unknown): string | null {
  const s = clean(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (s === "2500-01-01") return null; // sentinela do SDM para "sem fim"
  return s;
}

function postal(v: unknown): string | null {
  const s = clean(v);
  return s && /^\d{4}-\d{3}$/.test(s) ? s : null;
}

function phones(...vals: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of vals) {
    const s = clean(v);
    if (!s) continue;
    for (const part of s.split(/[/,;]| e /)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length === 9) out.add(digits);
    }
  }
  return [...out];
}

function email(v: unknown): string | null {
  const s = clean(v)?.toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function prestacaoAddress(r: SdmRawRecord, aux?: SdmAux): Address {
  const c = r.contactos;
  const parishCode = clean(c.cod_freguesia_localid_prestacao) ?? clean(r.CFregMor);
  const municipalityCode = clean(r.CConcMor);
  const districtCode = clean(r.CDistMor);
  return {
    street: clean(c.rua_prestacao) ?? "",
    postalCode: postal(c.cod_postal_prestacao) ?? postal(r.CPost),
    locality: clean(c.cod_postal_localid_prestacao),
    parishCode,
    parishName:
      clean(c.des_freguesia_localid_prestacao) ??
      (parishCode ? (aux?.parishes.get(parishCode) ?? null) : null),
    municipalityCode,
    municipalityName: municipalityCode ? (aux?.municipalities.get(municipalityCode) ?? null) : null,
    districtCode,
    districtName: districtCode ? (aux?.districts.get(districtCode) ?? null) : null,
  };
}

function hqAddress(r: SdmRawRecord): Address | null {
  const c = r.contactos;
  const street = clean(c.rua_sede_social);
  if (!street) return null;
  return {
    street,
    postalCode: postal(c.cod_postal_sede_social),
    locality: clean(c.cod_postal_localid_sede_social),
    parishCode: clean(c.cod_freguesia_sede_social),
    parishName: clean(c.des_freguesia_sede_social),
    municipalityCode: null,
    municipalityName: null,
    districtCode: null,
    districtName: null,
  };
}

function convention(r: SdmRawRecord, area: AreaRef, nif: string, locationName: string): Convention {
  const providerName = clean(r.data.des_entid_prest);
  return {
    contractCode: r.data.cod_contrato,
    entityNif: nif,
    providerName: providerName && providerName !== locationName ? providerName : null,
    area,
    startDate: date(r.data.data_ini),
    endDate: date(r.data.data_fim),
    scope: clean(r.data.cod_ambito),
    valencias: parseValencias(r.data.valencias),
    notes: clean(r.data.observacoes)?.replace(/<br\s*\/?>/gi, " · ") ?? null,
    activity: null,
  };
}

export interface Normalized {
  areas: AreaRef[];
  entities: Entity[];
  locations: Location[];
  /** registos ignorados e porquê */
  dropped: { id: number; reason: string }[];
}

/** Transforma os registos SDM (um por convenção × local) em entidades e locais com convenções embutidas. */
export function normalize(records: SdmRawRecord[], aux?: SdmAux): Normalized {
  const areas = new Map<string, AreaRef>();
  const entities = new Map<string, Entity>();
  const locations = new Map<number, Location>();
  const dropped: Normalized["dropped"] = [];

  for (const r of records) {
    const nif = clean(r.data.nif_entid_gest);
    if (!nif || !/^\d{9}$/.test(nif)) {
      dropped.push({ id: r.id, reason: `NIF inválido: ${r.data.nif_entid_gest}` });
      continue;
    }
    const areaCode = clean(r.data.sub_tipo_prestacao);
    const areaName = clean(r.data.des_sub_tipo_prestacao);
    if (!areaCode || !areaName) {
      dropped.push({ id: r.id, reason: "área em falta" });
      continue;
    }
    const area: AreaRef = areas.get(areaCode) ?? { code: areaCode, name: areaName };
    areas.set(areaCode, area);

    if (!entities.has(nif)) {
      entities.set(nif, {
        nif,
        name: clean(r.data.des_entid_gest) ?? nif,
        legalNature: clean(r.data.natureza_juridica),
        sdmManagerId: r.id_gestora,
        hq: hqAddress(r),
        complaints: null,
      });
    }

    const lat = num(r.contactos.WGS84_lat);
    const lon = num(r.contactos.WGS84_long);
    const coords = lat !== null && lon !== null ? { lat, lon } : null;

    let loc = locations.get(r.id_prestador);
    if (!loc) {
      loc = {
        id: r.id_prestador,
        nif,
        name: clean(r.data.des_entid_prest) ?? clean(r.data.des_entid_gest) ?? nif,
        address: prestacaoAddress(r, aux),
        coords,
        coordsSource: coords ? "sdm" : "none",
        phones: phones(r.contactos.telefone1_prestacao, r.contactos.telefone2_prestacao),
        email: email(r.contactos.email_geral_prestacao),
        emailSns24: email(r.contactos.email_sns24),
        region: clean(r.data.ars_abrange_local_prestacao)?.replace(/^Região\s+/i, "") ?? null,
        uls: clean(r.data.aces_abrange_local_prestacao),
        conventions: [],
        signals: [],
      };
      locations.set(r.id_prestador, loc);
    }
    if (loc.conventions.some((c) => c.contractCode === r.data.cod_contrato)) {
      dropped.push({ id: r.id, reason: `contrato duplicado ${r.data.cod_contrato}` });
      continue;
    }
    loc.conventions.push(convention(r, area, nif, loc.name));
  }

  const sortedAreas = [...areas.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    areas: sortedAreas,
    entities: [...entities.values()].sort((a, b) => a.nif.localeCompare(b.nif)),
    locations: [...locations.values()].sort((a, b) => a.id - b.id),
    dropped,
  };
}
