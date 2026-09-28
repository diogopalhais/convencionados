import type { Entity, Location, Signal, Snapshot } from "@sns-conv/schema";

/** Limiares. Percentis são calculados por área, entre entidades, para não comparar dimensões diferentes. */
export const THRESHOLDS = {
  activeMonths: 2, // faturou no mês mais recente ou nos 2 anteriores
  staleMonths: 6, // sem faturação há 6+ meses
  minRequestsForComplaintRatio: 2000, // requisições em 12 meses para o rácio de reclamações ser significativo
  praisedMinPraise: 5,
  longevityYears: 10,
  highVolumePercentile: 0.75,
  manyComplaintsPercentile: 0.9,
};

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}
const fmt = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 1 });
const fmtMonth = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

interface EntityStats {
  requests: number; // 12 meses, soma das áreas (cada par NIF×área uma vez)
  byArea: Map<string, number>;
  dominantArea: string | null;
  ratio: number | null; // reclamações por 10 000 requisições (semestre)
}

/**
 * Calcula os sinais de cada local. Depende de `activity`, `complaints`, coordenadas e datas já preenchidos.
 * Devolve a contagem por código para o relatório.
 */
export function computeSignals(
  locations: Location[],
  entities: Entity[],
  source: Pick<Snapshot["source"], "transparencia" | "ersRec">,
  snapshotDate: string,
): Record<string, number> {
  const latest = source.transparencia?.latestMonth ?? null;
  const entityByNif = new Map(entities.map((e) => [e.nif, e]));

  // --- estatísticas por entidade (requisições por área, contadas uma vez) ---
  const stats = new Map<string, EntityStats>();
  const seen = new Set<string>();
  for (const l of locations)
    for (const c of l.conventions) {
      if (!c.activity) continue;
      const key = `${c.entityNif}|${c.area.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const st = stats.get(c.entityNif) ?? {
        requests: 0,
        byArea: new Map(),
        dominantArea: null,
        ratio: null,
      };
      st.requests += c.activity.requests;
      st.byArea.set(c.area.code, (st.byArea.get(c.area.code) ?? 0) + c.activity.requests);
      stats.set(c.entityNif, st);
    }
  for (const [nif, st] of stats) {
    let best: [string, number] | null = null;
    for (const [a, r] of st.byArea) if (!best || r > best[1]) best = [a, r];
    st.dominantArea = best?.[0] ?? null;
    const e = entityByNif.get(nif);
    if (e?.complaints && st.requests >= THRESHOLDS.minRequestsForComplaintRatio)
      st.ratio = (e.complaints.complaints / (st.requests / 2)) * 10000;
  }

  // --- distribuições por área ---
  const volumeByArea = new Map<string, number[]>();
  const ratioByArea = new Map<string, number[]>();
  for (const st of stats.values()) {
    for (const [a, r] of st.byArea) volumeByArea.set(a, [...(volumeByArea.get(a) ?? []), r]);
    if (st.ratio !== null && st.dominantArea)
      ratioByArea.set(st.dominantArea, [...(ratioByArea.get(st.dominantArea) ?? []), st.ratio]);
  }
  for (const arr of volumeByArea.values()) arr.sort((x, y) => x - y);
  for (const arr of ratioByArea.values()) arr.sort((x, y) => x - y);
  const allVolumes = [...stats.values()].map((s) => s.requests).sort((x, y) => x - y);
  const highVolumeAll = percentile(allVolumes, THRESHOLDS.highVolumePercentile);

  const counts: Record<string, number> = {};
  const snapshotYear = Number(snapshotDate.slice(0, 4));

  for (const l of locations) {
    const signals: Signal[] = [];
    const push = (s: Signal) => {
      signals.push(s);
      counts[s.code] = (counts[s.code] ?? 0) + 1;
    };
    const rated = l.conventions.filter((c) => c.area.code !== "K");
    const entity = entityByNif.get(l.nif);
    const st = stats.get(l.nif);

    // atividade
    if (latest && rated.length > 0) {
      let bestMonth: string | null = null;
      for (const c of rated)
        if (c.activity && (!bestMonth || c.activity.lastMonth > bestMonth))
          bestMonth = c.activity.lastMonth;
      const monthsAgo = bestMonth ? monthsBetween(bestMonth, latest) : null;
      if (monthsAgo !== null && monthsAgo <= THRESHOLDS.activeMonths)
        push({
          code: "active",
          tone: "positive",
          label: "Aceita o SNS",
          detail: `Fez exames pelo SNS em ${fmtMonth(bestMonth!)}${monthsAgo > 0 ? ` (o mês mais recente publicado é ${fmtMonth(latest)})` : ", o mês mais recente publicado"}.`,
          priority: 4,
        });
      else {
        const since = source.transparencia?.since ?? "";
        const oldEnough = rated.some((c) => c.startDate && c.startDate < since);
        if (oldEnough && (monthsAgo === null || monthsAgo >= THRESHOLDS.staleMonths))
          push({
            code: "stale",
            tone: "warning",
            label: "Confirme antes de ir",
            detail:
              monthsAgo === null
                ? `Sem exames pelo SNS desde ${fmtMonth(since.slice(0, 7))}, apesar de ter convenção há mais tempo. Ligue antes de se deslocar.`
                : `Último mês com exames pelo SNS: ${fmtMonth(bestMonth!)}. Ligue antes de se deslocar.`,
            priority: 1,
          });
      }
    }

    // âmbito
    const scopes = new Set(l.conventions.map((c) => (c.scope ?? "").toLowerCase()));
    const regional = l.conventions.filter((c) => /regional|distrital/i.test(c.scope ?? ""));
    if (regional.length > 0)
      push({
        code: "regional",
        tone: "warning",
        label: "Só vale na região",
        detail: `Em ${[...new Set(regional.map((c) => c.area.name))].join(", ")} a convenção é ${regional[0]!.scope!.toLowerCase()}: pode não aceitar requisições (P1) passadas noutra região.`,
        priority: 3,
      });
    else if (scopes.has("nacional"))
      push({
        code: "national",
        tone: "positive",
        label: "Vale em todo o país",
        detail: "Aceita requisições (P1) passadas em qualquer região do país.",
        priority: 7,
      });

    // reclamações
    if (entity && st && source.ersRec) {
      const areaRatios = st.dominantArea ? (ratioByArea.get(st.dominantArea) ?? []) : [];
      const median = percentile(areaRatios, 0.5);
      const p90 = percentile(areaRatios, THRESHOLDS.manyComplaintsPercentile);
      const period = entity.complaints?.period ?? source.ersRec.period;
      const periodLabel = `${period.endsWith("S1") ? "1.º" : "2.º"} semestre de ${period.slice(0, 4)}`;
      if (entity.complaints && st.ratio !== null && areaRatios.length >= 5) {
        if (st.ratio >= p90 && entity.complaints.complaints >= 3)
          push({
            code: "many-complaints",
            tone: "warning",
            label: "Muitas reclamações",
            detail: `${entity.complaints.complaints} reclamações na ERS no ${periodLabel}: ${fmt(st.ratio)} por 10 000 exames pedidos, entre as 10% mais altas da área (mediana ${fmt(median)}).`,
            priority: 2,
          });
        else if (st.ratio <= median)
          push({
            code: "few-complaints",
            tone: "positive",
            label: "Poucas reclamações",
            detail: `${entity.complaints.complaints} reclamações na ERS no ${periodLabel}: ${fmt(st.ratio)} por 10 000 exames pedidos, abaixo da mediana da área (${fmt(median)}).`,
            priority: 5,
          });
      }
      if (
        entity.complaints &&
        entity.complaints.praise >= THRESHOLDS.praisedMinPraise &&
        entity.complaints.praise >= entity.complaints.complaints
      )
        push({
          code: "praised",
          tone: "positive",
          label: "Elogiado",
          detail: `${entity.complaints.praise} elogios e ${entity.complaints.complaints} reclamações na ERS no ${periodLabel}.`,
          priority: 6,
        });
      if (!entity.complaints && st.requests >= highVolumeAll && Number.isFinite(highVolumeAll))
        push({
          code: "no-complaints",
          tone: "neutral",
          label: "Sem reclamações registadas",
          detail: `A entidade não consta da tabela da ERS do ${periodLabel}, apesar do volume elevado (${st.requests.toLocaleString("pt-PT")} exames pedidos em 12 meses). Pode também ser um nome de registo diferente.`,
          priority: 9,
        });
    }

    // volume
    if (st?.dominantArea) {
      const dist = volumeByArea.get(st.dominantArea) ?? [];
      const p75 = percentile(dist, THRESHOLDS.highVolumePercentile);
      const r = st.byArea.get(st.dominantArea) ?? 0;
      if (dist.length >= 8 && r >= p75)
        push({
          code: "high-volume",
          tone: "neutral",
          label: "Muito procurado",
          detail: `${r.toLocaleString("pt-PT")} exames pedidos pelo SNS em 12 meses na área principal, entre os 25% mais procurados.`,
          priority: 8,
        });
    }

    // vários exames
    const areas = [...new Map(l.conventions.map((c) => [c.area.code, c.area.name])).values()];
    if (areas.length >= 2)
      push({
        code: "multi-area",
        tone: "neutral",
        label: "Vários exames no mesmo local",
        detail: `${areas.join(", ")} no mesmo local.`,
        priority: 10,
      });

    // longevidade
    const starts = l.conventions.map((c) => c.startDate).filter((d): d is string => !!d);
    if (starts.length > 0) {
      const years = snapshotYear - Number(starts.sort()[0]!.slice(0, 4));
      if (years >= THRESHOLDS.longevityYears)
        push({
          code: "longevity",
          tone: "neutral",
          label: `Parceiro do SNS há ${years} anos`,
          detail: `A convenção mais antiga deste local começou em ${starts.sort()[0]!.slice(0, 4)}.`,
          priority: 11,
        });
    }

    if (l.emailSns24)
      push({
        code: "sns24-email",
        tone: "neutral",
        label: "Marcação por email",
        detail: `Tem email dedicado a marcações via SNS 24: ${l.emailSns24}.`,
        priority: 12,
      });

    if (l.coordsSource === "approx")
      push({
        code: "approx-location",
        tone: "warning",
        label: "Localização aproximada",
        detail:
          "Coordenadas estimadas pelo centro do código postal; a distância pode estar errada em alguns quilómetros.",
        priority: 13,
      });

    l.signals = signals.sort((a, b) => a.priority - b.priority);
  }
  return counts;
}
