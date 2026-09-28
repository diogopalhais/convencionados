import type { QualityReport, Snapshot } from "@sns-conv/schema";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { loadReport, loadSnapshot, useAsync } from "../data";
import { useDocumentTitle } from "../theme";

const fmt = (n: number) => n.toLocaleString("pt-PT");
const fmtMonth = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-PT", { dateStyle: "long", timeStyle: "short" });
const fmtPeriod = (p: string) => `${p.endsWith("S1") ? "1.º" : "2.º"} semestre de ${p.slice(0, 4)}`;

type Tone = "positive" | "warning" | "neutral";

const GATES: Record<string, string> = {
  schema: "Snapshot válido contra o schema",
  "min-locations": "Pelo menos 2 000 locais",
  "coords>=90%": "Coordenadas em 90% ou mais dos locais",
  "valencias>=95%": "Lista de exames em 95% ou mais das convenções",
  "areas>=10": "Pelo menos 10 áreas de exame",
  "count-vs-previous": "Sem quebra face ao snapshot anterior",
  "removed<10%": "Menos de 10% de locais removidos",
};
const COVERAGE: Record<string, { label: string; group: string }> = {
  coords: { label: "Coordenadas", group: "Por local" },
  coordsExactOrSdm: { label: "Coordenadas exatas", group: "Por local" },
  street: { label: "Morada", group: "Por local" },
  postalCode: { label: "Código postal", group: "Por local" },
  municipalityName: { label: "Concelho", group: "Por local" },
  phone: { label: "Telefone", group: "Por local" },
  email: { label: "Email", group: "Por local" },
  emailSns24: { label: "Email para marcações SNS 24", group: "Por local" },
  valencias: { label: "Lista de exames", group: "Por convenção" },
  billedLast3Months: { label: "Exames pelo SNS nos últimos 3 meses", group: "Por convenção" },
  billedLast12Months: { label: "Exames pelo SNS nos últimos 12 meses", group: "Por convenção" },
  ersMatchedEntities: { label: "Cruzadas com a tabela da ERS", group: "Por entidade" },
  ersMatchedRequests: { label: "Exames pedidos a entidades cruzadas", group: "Por entidade" },
};
const SIGNALS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Aceita o SNS", tone: "positive" },
  stale: { label: "Confirme antes de ir", tone: "warning" },
  national: { label: "Vale em todo o país", tone: "positive" },
  regional: { label: "Só vale na região", tone: "warning" },
  "few-complaints": { label: "Poucas reclamações", tone: "positive" },
  "many-complaints": { label: "Muitas reclamações", tone: "warning" },
  praised: { label: "Elogiado", tone: "positive" },
  "no-complaints": { label: "Sem reclamações registadas", tone: "neutral" },
  "high-volume": { label: "Muito procurado", tone: "neutral" },
  "multi-area": { label: "Vários exames no mesmo local", tone: "neutral" },
  longevity: { label: "Parceiro do SNS há 10+ anos", tone: "neutral" },
  "sns24-email": { label: "Marcação por email", tone: "neutral" },
  "approx-location": { label: "Localização aproximada", tone: "warning" },
};
const ANOMALIES: Record<string, string> = {
  "no-billing-12m": "Sem exames pelo SNS em 12 meses",
  "approx-coords": "Coordenadas aproximadas",
  "no-coords": "Sem coordenadas",
  "shared-coords": "Coordenadas repetidas",
  "no-valencias": "Sem lista de exames",
  expired: "Convenção terminada",
  "no-contact": "Sem telefone nem email",
};
const ANOMALY_HELP: Record<string, string> = {
  "no-billing-12m":
    "Convenções com mais de um ano que não registaram exames pedidos pelo SNS no último ano. Na app aparecem com o aviso “Confirme antes de ir”.",
  "approx-coords":
    "Locais sem coordenadas na fonte, colocados no centro do código postal. Na app aparecem com o aviso “Localização aproximada”.",
  "no-coords":
    "Locais que não conseguimos colocar no mapa. Continuam a aparecer na pesquisa por nome.",
  "shared-coords":
    "Locais diferentes com as mesmas coordenadas exatas. Normalmente a mesma clínica com duas convenções.",
  "no-valencias": "Convenções sem lista de exames na fonte. Não podem ser encontradas por exame.",
};

function Bar({
  label,
  value,
  max,
  text,
  tone,
  sub,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
  tone?: Tone;
  sub?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="bar-row" title={`${label}: ${text}${sub ? ` (${sub})` : ""}`}>
      <span className="bar-label">
        {tone && <span className={`dot ${tone}`} aria-hidden="true" />}
        <span className="bar-text">{label}</span>
      </span>
      <span className="bar-track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="bar-val">
        {text}
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

export function Quality() {
  useDocumentTitle("Qualidade dos dados");
  const rep = useAsync(() => loadReport(), []);
  const snap = useAsync(() => loadSnapshot(), []);
  const [kind, setKind] = useState<string | null>(null);
  const [shownMax, setShownMax] = useState(25);
  const anomaliesByKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of rep.data?.anomalies ?? []) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rep.data]);

  if (rep.error || snap.error)
    return (
      <div className="wrap page">
        <div className="empty">{rep.error ?? snap.error}</div>
      </div>
    );
  if (!rep.data || !snap.data) return <div className="loading">a carregar relatório…</div>;
  const r: QualityReport = rep.data;
  const s: Snapshot = snap.data;
  const v = r.valencias;
  const passed = r.gates.filter((g) => g.passed).length;
  const allPassed = passed === r.gates.length;
  const coverageGroups = ["Por local", "Por convenção", "Por entidade"];
  const signalRows = Object.entries(r.signals ?? {})
    .map(([code, n]) => ({
      code,
      n,
      ...(SIGNALS[code] ?? { label: code, tone: "neutral" as Tone }),
    }))
    .sort((a, b) => b.n - a.n);
  const maxArea = Math.max(1, ...r.byArea.map((a) => a.conventions));
  const maxRegion = Math.max(1, ...r.byRegion.map((a) => a.locations));
  const maxSignal = Math.max(1, ...signalRows.map((x) => x.n));
  const geo = s.source.geocoded;
  const tr = s.source.transparencia;
  const ers = s.source.ersRec;
  const coords = r.coverage.coords;
  const exact = r.coverage.coordsExactOrSdm;
  const billed = r.coverage.billedLast12Months;
  const activeKind = kind ?? anomaliesByKind[0]?.[0] ?? null;
  const shown = r.anomalies.filter((a) => a.kind === activeKind);

  return (
    <div className="wrap page data-page">
      <header className="prov-head">
        <span className="eyebrow">Dados</span>
        <h1 className="title-1">Qualidade dos dados</h1>
        <p className="lede lede-sm">
          Snapshot gerado a {fmtDate(s.generatedAt)}. Os dados são atualizados uma vez por mês e
          tudo o que a app mostra vem deste conjunto, publicado só depois de passar as verificações
          abaixo.
        </p>
      </header>

      <section className="highlights" aria-label="Em resumo">
        <div className="hl">
          <span className="hl-label">Locais</span>
          <span className="hl-value">{fmt(s.counts.locations)}</span>
          <span className="hl-caption">
            {fmt(s.counts.entities)} entidades · {fmt(s.counts.conventions)} convenções ·{" "}
            {s.areas.length} áreas
          </span>
        </div>
        <div className={`hl ${allPassed ? "positive" : "warning"}`}>
          <span className="hl-label">Verificações</span>
          <span className="hl-value">
            {passed}/{r.gates.length}
          </span>
          <span className="hl-caption">
            {allPassed ? "todas a passar" : `${r.gates.length - passed} a falhar`}
          </span>
        </div>
        <div className={`hl ${coords && coords.pct >= 99 ? "positive" : "neutral"}`}>
          <span className="hl-label">No mapa</span>
          <span className="hl-value">{coords ? `${coords.pct}%` : "—"}</span>
          <span className="hl-caption">
            {exact ? `${exact.pct}% com localização exata` : "cobertura de coordenadas"}
          </span>
        </div>
        <div className={`hl ${billed && billed.pct >= 90 ? "positive" : "neutral"}`}>
          <span className="hl-label">Ativas no último ano</span>
          <span className="hl-value">{billed ? `${billed.pct}%` : "—"}</span>
          <span className="hl-caption">
            {tr ? `convenções com exames pelo SNS até ${fmtMonth(tr.latestMonth)}` : "sem dados"}
          </span>
        </div>
      </section>

      <div className="detail">
        <div className="stack">
          <section className="panel">
            <h2 className="title-3">Verificações antes de publicar</h2>
            <ul className="gate-list">
              {r.gates.map((g) => (
                <li key={g.name} className={g.passed ? "" : "fail"}>
                  <span className={`dot ${g.passed ? "positive" : "warning"}`} aria-hidden="true" />
                  <span className="gate-name">
                    {GATES[g.name] ?? g.name}
                    <span className="sr-only">{g.passed ? " (passou)" : " (falhou)"}</span>
                  </span>
                  <span className="gate-detail">{g.detail}</span>
                </li>
              ))}
            </ul>
            <p className="hint hint-after">
              Se uma verificação falhar, o snapshot anterior continua a servir a app e a equipa
              recebe um alerta.
            </p>
          </section>

          <section className="panel">
            <h2 className="title-3">Cobertura de campos</h2>
            {coverageGroups.map((group) => (
              <div key={group} className="bar-group">
                <h3 className="bar-group-title">{group}</h3>
                {Object.entries(r.coverage)
                  .filter(([k]) => COVERAGE[k]?.group === group)
                  .map(([k, c]) => (
                    <Bar
                      key={k}
                      label={COVERAGE[k]?.label ?? k}
                      value={c.pct}
                      max={100}
                      text={`${c.pct}%`}
                      sub={fmt(c.count)}
                      tone={c.pct >= 95 ? "positive" : c.pct >= 70 ? "neutral" : "warning"}
                    />
                  ))}
              </div>
            ))}
            <p className="hint hint-after">
              Percentagem de registos com o campo preenchido. Azul: 95% ou mais. Âmbar: abaixo de
              70%.
            </p>
          </section>

          <section className="panel">
            <h2 className="title-3">Lista de exames</h2>
            <div className="mini-stats">
              <div>
                <b>{fmt(v.total)}</b>
                <span>linhas de exames</span>
              </div>
              <div>
                <b>{Math.round((v.withTag / v.total) * 100)}%</b>
                <span>com família reconhecida</span>
              </div>
              <div>
                <b>{fmt(v.withConvCode)}</b>
                <span>com código da tabela</span>
              </div>
              <div className={v.unmatched / v.total > 0.3 ? "warn" : ""}>
                <b>{fmt(v.unmatched)}</b>
                <span>sem correspondência</span>
              </div>
            </div>
            <p className="hint">
              Cada convenção lista os exames que faz em texto livre. Reconhecemos famílias por
              padrões e códigos da tabela MCDT. As linhas abaixo ficaram por reconhecer e são o
              próximo trabalho no dicionário.
            </p>
            <ul className="samples">
              {v.unmatchedSamples.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2 className="title-3">Anomalias</h2>
            <fieldset className="chips-set">
              <legend className="sr-only">Tipo de anomalia</legend>
              <div className="chips">
                {anomaliesByKind.map(([k, n]) => (
                  <button
                    type="button"
                    key={k}
                    className={`chip${activeKind === k ? " on" : ""}`}
                    onClick={() => {
                      setKind(k);
                      setShownMax(25);
                    }}
                    aria-pressed={activeKind === k}
                  >
                    {ANOMALIES[k] ?? k}
                    <span className="n">{n}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            {activeKind && ANOMALY_HELP[activeKind] && (
              <p className="hint hint-after">{ANOMALY_HELP[activeKind]}</p>
            )}
            <table className="q anomaly-table">
              <tbody>
                {shown.slice(0, shownMax).map((a) => (
                  <tr key={`${a.kind}-${a.locationId}-${a.detail}`}>
                    <td className="anomaly-id">
                      {a.locationId != null ? (
                        <Link to={`/p/${a.locationId}`}>#{a.locationId}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > shownMax && (
              <div className="more-row">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setShownMax((n) => n + 100)}
                >
                  Mostrar mais ({fmt(shown.length - shownMax)} restantes)
                </button>
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h2 className="title-3">Fontes deste snapshot</h2>
            <dl className="src-list">
              <div>
                <dt>Rede de convencionados</dt>
                <dd>
                  ACSS / SPMS, lista de {s.source.sdmReportDate ?? "—"}
                  <small>
                    {s.source.sdmOrigin === "live" ? "obtida em direto" : "cópia guardada"}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Exames pedidos pelo SNS</dt>
                <dd>
                  {tr ? (
                    <>
                      Transparência SNS, até {fmtMonth(tr.latestMonth)}
                      <small>
                        12 meses desde {fmtMonth(tr.since.slice(0, 7))} ·{" "}
                        {tr.origin === "live" ? "em direto" : "cópia guardada"}
                      </small>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Reclamações e elogios</dt>
                <dd>
                  {ers ? (
                    <>
                      ERS, {fmtPeriod(ers.period)}
                      <small>
                        {ers.matched} de {fmt(s.counts.entities)} entidades cruzadas ·{" "}
                        <a href={ers.sourceUrl} target="_blank" rel="noopener noreferrer">
                          tabela
                        </a>
                      </small>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt>Tabela de exames</dt>
                <dd>
                  MCDT, versão {s.source.mcdtTableVersion ?? "—"}
                  <small>{fmt(s.counts.mcdtCodes)} códigos</small>
                </dd>
              </div>
              <div>
                <dt>Localização</dt>
                <dd>
                  {geo
                    ? `${fmt(geo.exact)} exatas · ${fmt(geo.approx)} aproximadas · ${fmt(geo.unresolved)} por resolver`
                    : "—"}
                  <small>para locais sem coordenadas na fonte, por código postal</small>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2 className="title-3">Sinais atribuídos aos locais</h2>
            {signalRows.map((x) => (
              <Bar
                key={x.code}
                label={x.label}
                value={x.n}
                max={maxSignal}
                text={fmt(x.n)}
                sub={`${Math.round((x.n / s.counts.locations) * 100)}%`}
                tone={x.tone}
              />
            ))}
            <p className="hint hint-after">
              Um local pode ter vários sinais. Os limiares são relativos dentro de cada área:
              procura no quartil superior, reclamações face à mediana e ao decil superior.
            </p>
          </section>

          <section className="panel">
            <h2 className="title-3">Convenções por área</h2>
            {r.byArea.map((a) => (
              <Bar
                key={a.area.code}
                label={a.area.name}
                value={a.conventions}
                max={maxArea}
                text={fmt(a.conventions)}
              />
            ))}
          </section>

          <section className="panel">
            <h2 className="title-3">Locais por região</h2>
            {r.byRegion.map((a) => (
              <Bar
                key={a.region}
                label={a.region}
                value={a.locations}
                max={maxRegion}
                text={fmt(a.locations)}
              />
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
