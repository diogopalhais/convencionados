import { isPseudonymNif, type Location, type Signal } from "@sns-conv/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { MapView } from "../components/MapView";
import { loadSnapshot, useAsync } from "../data";
import { stripAccents } from "../search";
import { useDocumentTitle, useTheme } from "../theme";
import { LoadError } from "./Home";

const NATURE: Record<string, string> = {
  PCLAB: "Laboratório de análises",
  PRIV: "Entidade privada",
  "HOSP-PRIV": "Hospital privado",
  "HOSP-IPSS": "Hospital do setor social",
  MISERIC: "Misericórdia",
  IPSS: "IPSS",
  ASSOCIA: "Associação",
  MUTUAL: "Mutualidade",
  FUNDA: "Fundação",
  "PUB-NE": "Entidade pública",
};

const fmtPhone = (p: string) => p.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
const fmtMonth = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const fmtPeriod = (p: string) => `${p.endsWith("S1") ? "1.º" : "2.º"} semestre de ${p.slice(0, 4)}`;
const EXAMS_COLLAPSED = 8;
/** Permite quebra de linha só depois do @ em emails longos. */
const breakEmail = (e: string) => {
  const i = e.indexOf("@");
  if (i < 0) return e;
  return (
    <>
      {e.slice(0, i + 1)}
      <wbr />
      {e.slice(i + 1)}
    </>
  );
};

type Tone = "positive" | "warning" | "neutral";
const fmtInt = (n: number) => n.toLocaleString("pt-PT");

/** Valências que correspondem à pesquisa que trouxe o utente até aqui. */
function matchedTexts(loc: Location, q: string): Set<string> {
  const terms = stripAccents(q)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const out = new Set<string>();
  if (terms.length === 0) return out;
  for (const c of loc.conventions)
    for (const v of c.valencias) {
      const t = stripAccents(v.text).toLowerCase();
      if (terms.some((term) => t.includes(term)) || v.convCodes.includes(q.trim())) out.add(v.text);
    }
  return out;
}

function PhoneIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function Provider() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const originParam = params.get("o");
  const { theme } = useTheme();
  const snap = useAsync(() => loadSnapshot(), []);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  const [showAllExams, setShowAllExams] = useState<Record<string, boolean>>({});
  const loc = useMemo(() => snap.data?.locations.find((l) => l.id === Number(id)), [snap.data, id]);
  useDocumentTitle(loc?.name ?? "Prestador");
  const entities = useMemo(
    () => new Map(snap.data?.entities.map((e) => [e.nif, e]) ?? []),
    [snap.data],
  );

  if (snap.error)
    return (
      <div className="wrap page">
        <LoadError detail={snap.error} />
      </div>
    );
  if (!snap.data) return <div className="loading">a carregar…</div>;
  if (!loc)
    return (
      <div className="wrap page">
        <div className="empty">
          <b>Prestador não encontrado</b>
          <span>Este identificador não existe no snapshot {snap.data.version}.</span>
          <Link to="/" className="btn small">
            Voltar à pesquisa
          </Link>
        </div>
      </div>
    );

  const owner = entities.get(loc.nif);
  const tr = snap.data.source.transparencia;
  const ers = snap.data.source.ersRec;
  const sig = (code: Signal["code"]) => loc.signals.find((s) => s.code === code);
  const matched = matchedTexts(loc, q);
  const origin = (() => {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(originParam ?? "");
    return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
  })();
  const fullAddress =
    `${loc.address.street}, ${loc.address.postalCode ?? ""} ${loc.address.locality ?? ""}`.trim();
  // abre o local no Google Maps (ficha do sítio, com avaliações), não o modo de direções
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${loc.name}, ${fullAddress}`,
  )}`;
  const areas = [...new Map(loc.conventions.map((c) => [c.area.code, c.area])).values()];
  const lastMonth = loc.conventions.reduce(
    (m, c) => (c.activity && c.activity.lastMonth > m ? c.activity.lastMonth : m),
    "",
  );

  // requisições pelo SNS da entidade (12 meses), cada par NIF × área contado uma vez
  const entityRequests = (() => {
    const seen = new Set<string>();
    let total = 0;
    for (const l of snap.data.locations)
      for (const c of l.conventions) {
        if (c.entityNif !== loc.nif || !c.activity || seen.has(c.area.code)) continue;
        seen.add(c.area.code);
        total += c.activity.requests;
      }
    return total;
  })();

  // ---- Destaques: 4 factos que decidem, no padrão dos tiles da App Store ----
  interface Highlight {
    key: string;
    label: string;
    value: string;
    caption: string;
    tone: Tone;
  }
  const hl: Highlight[] = [];
  const stale = sig("stale");
  if (tr)
    hl.push(
      sig("active")
        ? {
            key: "sns",
            label: "Aceita o SNS",
            value: "Sim",
            caption: `exames pelo SNS em ${fmtMonth(lastMonth)}`,
            tone: "positive",
          }
        : stale
          ? {
              key: "sns",
              label: "Aceita o SNS",
              value: "Confirme",
              caption: lastMonth
                ? `sem exames pelo SNS desde ${fmtMonth(lastMonth)}`
                : "sem exames pelo SNS há mais de um ano",
              tone: "warning",
            }
          : {
              key: "sns",
              label: "Aceita o SNS",
              value: "Sem dados",
              caption: "atividade não publicada",
              tone: "neutral",
            },
    );
  if (ers) {
    const c = owner?.complaints;
    const many = sig("many-complaints");
    const few = sig("few-complaints");
    const praised = sig("praised");
    hl.push(
      c
        ? {
            key: "ers",
            label: "Reclamações",
            value: many ? "Muitas" : few ? "Poucas" : praised ? "Elogiado" : `${c.complaints}`,
            caption: `${c.complaints} reclamações · ${c.praise} elogios · ${fmtPeriod(c.period).replace("semestre de", "sem.")}`,
            tone: many ? "warning" : few || praised ? "positive" : "neutral",
          }
        : {
            key: "ers",
            label: "Reclamações",
            value: "Sem registo",
            caption: `não consta da tabela da ERS, ${fmtPeriod(ers.period).replace("semestre de", "sem.")}`,
            tone: "neutral",
          },
    );
  }
  if (tr)
    hl.push(
      entityRequests > 0
        ? {
            key: "demand",
            label: "Procura",
            value: sig("high-volume") ? "Muito procurado" : "Normal",
            caption: `${fmtInt(entityRequests)} exames pelo SNS em 12 meses`,
            tone: sig("high-volume") ? "positive" : "neutral",
          }
        : {
            key: "demand",
            label: "Procura",
            value: "Sem dados",
            caption: "atividade não publicada",
            tone: "neutral",
          },
    );
  {
    const starts = loc.conventions
      .map((c) => c.startDate)
      .filter((d): d is string => !!d)
      .sort();
    if (starts[0]) {
      const year = Number(starts[0].slice(0, 4));
      const years = Number(snap.data.version.slice(0, 4)) - year;
      hl.push({
        key: "since",
        label: "Parceiro do SNS",
        value: years >= 1 ? `${years} ${years === 1 ? "ano" : "anos"}` : "Novo",
        caption: `convenção desde ${year}`,
        tone: years >= 10 ? "positive" : "neutral",
      });
    }
  }
  const regional = sig("regional");
  const approx = sig("approx-location");

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: loc.name, text: fullAddress, url });
      else {
        await navigator.clipboard.writeText(url);
        flash("Ligação copiada");
      }
    } catch {
      /* cancelado pelo utilizador */
    }
  };
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(done);
    } catch {
      flash("Não foi possível copiar");
    }
  };
  const backTo = q ? `/?q=${encodeURIComponent(q)}` : "/";

  return (
    <div className="wrap page provider">
      <Link to={backTo} className="back">
        ← {q ? `Resultados para “${q}”` : "Pesquisa"}
      </Link>

      <header className="prov-head">
        <div className="badges">
          {areas.map((a) => (
            <span key={a.code} className="badge accent">
              {a.name}
            </span>
          ))}
          {owner?.legalNature && (
            <span className="badge">{NATURE[owner.legalNature] ?? owner.legalNature}</span>
          )}
        </div>
        <h1 className="title-1">{loc.name}</h1>
        <p className="lede lede-sm">
          {loc.address.street}, {loc.address.postalCode} {loc.address.locality}
        </p>
        <div className="actions">
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn primary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              Marcar exame <ChevronIcon />
            </button>
            {menuOpen && (
              <div className="menu" role="menu" aria-label="Opções de marcação">
                {loc.phones.map((ph) => (
                  <a
                    key={ph}
                    role="menuitem"
                    href={`tel:+351${ph}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <PhoneIcon />
                    <span>
                      Ligar
                      <small>{fmtPhone(ph)}</small>
                    </span>
                  </a>
                ))}
                {loc.emailSns24 && (
                  <a
                    role="menuitem"
                    href={`mailto:${loc.emailSns24}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <MailIcon />
                    <span>
                      Enviar email
                      <small>{loc.emailSns24}</small>
                    </span>
                  </a>
                )}
                {loc.email && loc.email !== loc.emailSns24 && (
                  <a
                    role="menuitem"
                    href={`mailto:${loc.email}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <MailIcon />
                    <span>
                      {loc.emailSns24 ? "Enviar email geral" : "Enviar email"}
                      <small>{loc.email}</small>
                    </span>
                  </a>
                )}
                <a
                  role="menuitem"
                  href="https://www.sns24.gov.pt/pt/servico/exames-e-resultados/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                >
                  <CalendarIcon />
                  <span>
                    Marcar no SNS 24
                    <small>com a requisição eletrónica</small>
                  </span>
                </a>
              </div>
            )}
          </div>
          <a className="btn" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapIcon /> Abrir no Google Maps
          </a>
          <button type="button" className="btn ghost" onClick={share}>
            <ShareIcon /> Partilhar
          </button>
          {toast && (
            <span className="toast" role="status">
              {toast}
            </span>
          )}
        </div>
      </header>

      <section className="highlights" aria-label="Em resumo">
        {hl.map((h) => (
          <div key={h.key} className={`hl ${h.tone}`}>
            <span className="hl-label">{h.label}</span>
            <span className="hl-value">{h.value}</span>
            <span className="hl-caption">{h.caption}</span>
          </div>
        ))}
      </section>
      {(regional || approx) && (
        <div className="notices">
          {regional && (
            <p className="notice">
              <span className="tag warning">Só vale na região</span> {regional.detail}
            </p>
          )}
          {approx && (
            <p className="notice">
              <span className="tag warning">Localização aproximada</span> {approx.detail}
            </p>
          )}
        </div>
      )}

      <div className="detail">
        <div className="stack">
          <section className="panel">
            <h2 className="title-3">Lista de exames com convenção</h2>
            {q.trim() && (
              <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
                {matched.size > 0
                  ? `Inclui o que pesquisou: ${[...matched].slice(0, 3).join(" · ")}`
                  : `“${q}” não aparece com esse nome; confirme por telefone.`}
              </p>
            )}
            {loc.conventions.map((c) => {
              const expanded = showAllExams[c.contractCode] ?? false;
              const sorted = [...c.valencias].sort(
                (a, b) => Number(matched.has(b.text)) - Number(matched.has(a.text)),
              );
              const items = expanded ? sorted : sorted.slice(0, EXAMS_COLLAPSED);
              return (
                <section key={c.contractCode} className="conv">
                  <div className="conv-head">
                    <b>{c.area.name}</b>
                    <span className="meta">
                      {c.startDate ? `desde ${c.startDate.slice(0, 4)}` : ""}
                      {c.scope
                        ? /nacional/i.test(c.scope)
                          ? " · vale em todo o país"
                          : ` · só ${c.scope.toLowerCase()}`
                        : ""}
                      {tr && c.area.code !== "K"
                        ? c.activity
                          ? ` · exames pelo SNS até ${fmtMonth(c.activity.lastMonth)}`
                          : " · sem exames pelo SNS em 12 meses"
                        : ""}
                    </span>
                  </div>
                  {c.providerName && (
                    <div className="hint">
                      prestado por {c.providerName}
                      {isPseudonymNif(c.entityNif) ? "" : ` (NIF ${c.entityNif})`}
                    </div>
                  )}
                  {c.valencias.length > 0 ? (
                    <>
                      <ul className="val-list">
                        {items.map((v) => (
                          <li key={v.text} className={matched.has(v.text) ? "hit" : ""}>
                            {v.text}
                            {v.convCodes.length > 0 && (
                              <span className="codes">{v.convCodes.join(" ")}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {c.valencias.length > EXAMS_COLLAPSED && (
                        <button
                          type="button"
                          className="btn small ghost"
                          style={{ marginTop: 8 }}
                          onClick={() =>
                            setShowAllExams((s) => ({ ...s, [c.contractCode]: !expanded }))
                          }
                        >
                          {expanded ? "Mostrar menos" : `Mostrar todos (${c.valencias.length})`}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="hint">A fonte não lista os exames desta convenção.</div>
                  )}
                  {c.notes && (
                    <div className="hint" style={{ marginTop: 8 }}>
                      Nota da fonte: {c.notes}
                    </div>
                  )}
                </section>
              );
            })}
          </section>

          {loc.signals.length > 0 && (
            <section className="plain">
              <h2 className="title-3">Mais sobre este local</h2>
              <ul className="signal-list">
                {loc.signals.map((sg) => (
                  <li key={sg.code} className={sg.tone}>
                    <b>{sg.label}.</b> {sg.detail}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="panel contact-card" aria-label="Contactos e morada">
            <h2 className="title-3">Contactos e morada</h2>
            {loc.phones[0] && (
              <div className="contact-row">
                <PhoneIcon />
                <span className="contact-body">
                  <span className="contact-label">Telefone</span>
                  <span className="contact-value">{fmtPhone(loc.phones[0])}</span>
                  {loc.phones.length > 1 && (
                    <span className="contact-sub">
                      também {loc.phones.slice(1).map(fmtPhone).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="contact-actions">
                  <a className="btn small primary" href={`tel:+351${loc.phones[0]}`}>
                    Ligar
                  </a>
                  <button
                    type="button"
                    className="copy-inline"
                    onClick={() => copy(loc.phones[0]!, "Número copiado")}
                  >
                    <CopyIcon /> Copiar
                  </button>
                </span>
              </div>
            )}
            <div className="contact-row">
              <PinIcon />
              <span className="contact-body">
                <span className="contact-label">Morada</span>
                <span className="contact-value">
                  {loc.address.street}
                  <br />
                  {loc.address.postalCode} {loc.address.locality}
                </span>
                {loc.address.parishName && (
                  <span className="contact-sub">{loc.address.parishName}</span>
                )}
              </span>
              <span className="contact-actions">
                <a
                  className="btn small primary"
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Maps
                </a>
                <button
                  type="button"
                  className="copy-inline"
                  onClick={() => copy(fullAddress, "Morada copiada")}
                >
                  <CopyIcon /> Copiar
                </button>
              </span>
            </div>
            {(loc.emailSns24 ?? loc.email) && (
              <div className="contact-row">
                <MailIcon />
                <span className="contact-body">
                  <span className="contact-label">
                    {loc.emailSns24 ? "Marcações por email" : "Email"}
                  </span>
                  <span className="contact-value email">
                    {breakEmail(loc.emailSns24 ?? loc.email ?? "")}
                  </span>
                  {loc.emailSns24 && loc.email && loc.emailSns24 !== loc.email && (
                    <span className="contact-sub">geral: {loc.email}</span>
                  )}
                </span>
                <span className="contact-actions">
                  <a className="btn small primary" href={`mailto:${loc.emailSns24 ?? loc.email}`}>
                    Escrever
                  </a>
                  <button
                    type="button"
                    className="copy-inline"
                    onClick={() => copy(loc.emailSns24 ?? loc.email ?? "", "Email copiado")}
                  >
                    <CopyIcon /> Copiar
                  </button>
                </span>
              </div>
            )}
            {toast && (
              <span className="toast" role="status">
                {toast}
              </span>
            )}
            <div className="contact-foot">
              <span>
                {owner?.name ?? "Entidade"}
                {isPseudonymNif(loc.nif) ? (
                  ""
                ) : (
                  <>
                    {" · NIF "}
                    <span className="mono">{loc.nif}</span>
                  </>
                )}
                {loc.uls ? ` · ${loc.uls}` : ""}
              </span>
              {ers && owner?.complaints && (
                <span>
                  <a
                    href="https://www.ers.pt/pt/reclamacoes-em-numeros/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ERS: reclamações em números
                  </a>
                  {" · "}
                  <a
                    href="https://www.ers.pt/pt/utentes/formularios/reclamacoes-online/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Reclamar
                  </a>
                </span>
              )}
            </div>
          </section>

          {loc.coords && (
            <section className="map-card" aria-label="Mapa do local">
              <MapView key={theme} theme={theme} locations={[loc]} origin={origin} fitOnChange />
            </section>
          )}

          <section className="plain">
            <h2 className="title-3">Antes de ir</h2>
            <p className="note">
              Leve a requisição (P1) e o cartão de utente. Ligue para confirmar disponibilidade e
              lista de espera. Também pode marcar no{" "}
              <a
                href="https://www.sns24.gov.pt/pt/servico/exames-e-resultados/"
                target="_blank"
                rel="noopener noreferrer"
              >
                SNS 24
              </a>
              .
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
