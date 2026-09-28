import type { Coords, McdtCode } from "@sns-conv/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MapView } from "../components/MapView";
import { loadMcdt, loadSnapshot, useAsync } from "../data";
import { formatKm, geocodePostalCode, getPosition, PostalIndex } from "../geo";
import { findMcdtCode, type Hit, Index, stripAccents } from "../search";
import { useDocumentTitle, useTheme } from "../theme";

const DEBOUNCE_MS = 320;
const RECENTS_KEY = "sns-conv-recents";
const MAX_SUGGEST = 6;
const PAGE = 40;
const EXAMPLES = ["ecografia tiróide", "TAC", "análises clínicas", "holter", "748.0"];
type Sort = "relevance" | "distance" | "name";

function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
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
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function CrosshairIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
    </svg>
  );
}

/** Falha a carregar a lista: mensagem em linguagem simples e um botão para tentar de novo. */
export function LoadError({ detail }: { detail: string }) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <div className="error-box" role="alert">
      <b>Não foi possível carregar a lista de prestadores</b>
      <p>
        {offline
          ? "Parece que está sem ligação à internet. Quando voltar a ter rede, tente de novo."
          : "Pode ser uma falha temporária. Tente de novo dentro de instantes."}
      </p>
      <button type="button" className="btn primary" onClick={() => window.location.reload()}>
        Tentar de novo
      </button>
      <p className="hint">Detalhe técnico: {detail}</p>
    </div>
  );
}

export function Home() {
  const snap = useAsync(() => loadSnapshot(), []);
  const mcdt = useAsync(() => loadMcdt(), []);
  const loadError = snap.error ?? mcdt.error ?? null;
  const { theme } = useTheme();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // estado da pesquisa vive no URL (partilhável); o input tem um rascunho com debounce
  const q = params.get("q") ?? "";
  const areaCodes = useMemo(
    () => new Set((params.get("area") ?? "").split(",").filter(Boolean)),
    [params],
  );
  const sortParam = (params.get("sort") as Sort | null) ?? null;
  const radiusKm = Number(params.get("raio") ?? 0) || 0;

  const [draft, setDraft] = useState(q);
  const postal = useMemo(
    () => (snap.data ? new PostalIndex(snap.data.locations) : undefined),
    [snap.data],
  );
  const [pending, setPending] = useState(false);
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [cp, setCp] = useState("");
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [hover, setHover] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // debounce: o URL (e a lista) só mudam quando o utilizador para de escrever
  useEffect(() => {
    if (draft === q) {
      setPending(false);
      return;
    }
    setPending(true);
    const t = window.setTimeout(() => {
      update({ q: draft.trim() || null });
      setPending(false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [draft, q, update]);

  // sincroniza o rascunho quando o q muda por fora (exemplos, navegação)
  useEffect(() => {
    setDraft(q);
  }, [q]);

  // paginação reinicia quando a pesquisa muda (sem efeito: o estado guarda a chave da pesquisa)
  const searchKey = `${q}|${[...areaCodes].join(",")}|${origin?.lat ?? ""}|${radiusKm}|${sortParam ?? ""}`;
  const [pageState, setPageState] = useState({ key: searchKey, visible: PAGE });
  const visible = pageState.key === searchKey ? pageState.visible : PAGE;
  const showMore = () => setPageState({ key: searchKey, visible: visible + PAGE });

  useEffect(() => {
    const p = params.get("cp");
    // espera pelo índice local para não bater na API externa a cada carregamento
    if (p && !origin && postal) {
      setCp(p);
      geocodePostalCode(p, postal)
        .then((r) => {
          setOrigin(r.coords);
          setOriginLabel(r.label);
        })
        .catch(() => {
          /* código postal inválido no URL: ignorar */
        });
    }
  }, [params, origin, postal]);

  const index = useMemo(() => (snap.data ? new Index(snap.data) : null), [snap.data]);
  const code: McdtCode | null = useMemo(
    () => (mcdt.data ? findMcdtCode(q, mcdt.data) : null),
    [q, mcdt.data],
  );

  // só há resultados depois de uma intenção explícita: texto, área ou localização
  const active = q.trim().length >= 2 || areaCodes.size > 0 || origin !== null;
  const sort: Sort = sortParam ?? (origin ? "distance" : "relevance");

  const hits: Hit[] = useMemo(() => {
    if (!index || !active) return [];
    let list: Hit[];
    if (code) {
      const byCode = index.search({
        query: "",
        areaCodes: new Set([code.areaCode]),
        origin,
        convCode: code.convCode,
        limit: 3000,
      });
      list =
        byCode.length > 0
          ? byCode
          : index.search({ query: "", areaCodes: new Set([code.areaCode]), origin, limit: 3000 });
    } else {
      list = index.search({ query: q, areaCodes, origin, limit: 3000 });
    }
    if (origin && radiusKm > 0)
      list = list.filter((h) => h.distanceKm != null && h.distanceKm <= radiusKm);
    if (sort === "name")
      list = [...list].sort((a, b) => a.loc.name.localeCompare(b.loc.name, "pt"));
    else if (sort === "distance")
      list = [...list].sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    else if (origin)
      list = [...list].sort(
        (a, b) => b.score - a.score || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
      );
    return list;
  }, [index, active, code, q, areaCodes, origin, radiusKm, sort]);

  const areaCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!snap.data) return m;
    for (const l of snap.data.locations)
      for (const a of new Set(l.conventions.map((c) => c.area.code))) m.set(a, (m.get(a) ?? 0) + 1);
    return m;
  }, [snap.data]);
  const sortedAreas = useMemo(
    () =>
      (snap.data?.areas ?? [])
        .slice()
        .sort((a, b) => (areaCounts.get(b.code) ?? 0) - (areaCounts.get(a.code) ?? 0)),
    [snap.data, areaCounts],
  );

  const toggleArea = (c: string) => {
    const s = new Set(areaCodes);
    if (s.has(c)) s.delete(c);
    else s.add(c);
    update({ area: [...s].join(",") || null });
  };
  const locateByGps = async () => {
    setGeoBusy(true);
    setGeoError(null);
    try {
      const pos = await getPosition();
      setOrigin(pos);
      setOriginLabel("a minha localização");
      update({ cp: null });
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "Não foi possível obter a localização");
    } finally {
      setGeoBusy(false);
    }
  };
  const locateByPostalCode = async () => {
    if (!cp.trim()) return;
    setGeoBusy(true);
    setGeoError(null);
    try {
      const r = await geocodePostalCode(cp, postal);
      setOrigin(r.coords);
      setOriginLabel(r.label);
      update({ cp: cp.trim() });
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "Erro na geocodificação");
    } finally {
      setGeoBusy(false);
    }
  };
  const clearOrigin = () => {
    setOrigin(null);
    setOriginLabel(null);
    update({ cp: null, raio: null, sort: null });
  };
  /** Botão "Pesquisar": aplica o texto já (sem esperar o debounce) e resolve o código postal se houver. */
  const submit = async () => {
    update({ q: draft.trim() || null });
    if (!origin && cp.trim()) await locateByPostalCode();
  };
  const clearAll = () => {
    setDraft("");
    update({ q: null, area: null, sort: null, raio: null });
    inputRef.current?.focus();
  };

  const providerQuery = (() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (origin) p.set("o", `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`);
    const str = p.toString();
    return str ? `?${str}` : "";
  })();
  const onSelect = useCallback(
    (id: number) => navigate(`/p/${id}${providerQuery}`),
    [navigate, providerQuery],
  );
  const onHover = useCallback((id: number | null) => setHover(id), []);
  const mapLocations = useMemo(() => hits.map((h) => h.loc), [hits]);
  const total = snap.data?.counts.locations ?? 0;
  useDocumentTitle(
    active ? (q.trim() ? `${q.trim()} · resultados` : "Resultados") : "Onde fazer o seu P1",
  );

  // recentes: guardar pesquisas com resultados
  useEffect(() => {
    const term = q.trim();
    if (!term || hits.length === 0) return;
    setRecents((r) => {
      const next = [term, ...r.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 5);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }, [q, hits.length]);

  // sugestões enquanto escreve: áreas, exames da tabela MCDT e famílias de exame
  const suggestions = useMemo(() => {
    const term = stripAccents(draft.trim()).toLowerCase();
    if (term.length < 2 || draft.trim() === q.trim() || !snap.data) return [];
    const out: { text: string; kind: string }[] = [];
    const seen = new Set<string>();
    const push = (text: string, kind: string) => {
      const k = text.toLowerCase();
      if (seen.has(k) || out.length >= MAX_SUGGEST) return;
      seen.add(k);
      out.push({ text, kind });
    };
    for (const a of snap.data.areas)
      if (stripAccents(a.name).toLowerCase().includes(term)) push(a.name, "área");
    for (const c of mcdt.data?.codes ?? []) {
      const d = stripAccents(c.description).toLowerCase();
      if (d.startsWith(term)) push(c.description, "exame");
    }
    for (const c of mcdt.data?.codes ?? []) {
      const d = stripAccents(c.description).toLowerCase();
      if (!d.startsWith(term) && d.includes(term)) push(c.description, "exame");
    }
    return out;
  }, [draft, q, snap.data, mcdt.data]);

  return (
    <>
      <section className={`wrap hero${active ? " compact" : ""}`} aria-label="Pesquisa">
        <span className="eyebrow">Convencionados SNS</span>
        <h1 className="display">
          Onde fazer o seu P1.
          <br />
          <em>Perto de si, com convenção.</em>
        </h1>
        <p className="lede">
          Escreva o exame tal como está na requisição, ou o código. Mostramos os prestadores com
          convenção ativa, a partir da lista oficial, atualizada todos os meses.
        </p>

        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="field query">
            <SearchIcon />
            <input
              ref={inputRef}
              id="q"
              type="search"
              placeholder="Exame, código do P1 ou prestador"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && clearAll()}
              autoComplete="off"
              aria-label="Exame, código do P1 ou prestador"
            />
            {pending && <span className="searching" aria-hidden="true" />}
            {draft && !pending && (
              <button type="button" className="clear" onClick={clearAll} aria-label="Limpar exame">
                <CloseIcon />
              </button>
            )}
          </div>

          <div className="field location">
            <PinIcon />
            {origin ? (
              <span className="loc-chip">
                {originLabel}
                <button
                  type="button"
                  className="clear"
                  onClick={clearOrigin}
                  aria-label="Remover localização"
                >
                  <CloseIcon />
                </button>
              </span>
            ) : (
              <input
                id="cp"
                inputMode="numeric"
                placeholder="Código postal"
                value={cp}
                onChange={(e) => setCp(e.target.value)}
                autoComplete="postal-code"
                aria-label="Código postal"
              />
            )}
            <button
              type="button"
              className={`locate${geoBusy ? " busy" : ""}`}
              onClick={locateByGps}
              disabled={geoBusy}
              aria-label="Usar a minha localização"
              title="Usar a minha localização"
            >
              <CrosshairIcon />
            </button>
          </div>

          <button type="submit" className="btn primary" disabled={geoBusy}>
            Pesquisar
          </button>
        </form>
        {geoError && (
          <span className="geo-error" role="alert">
            {geoError}
          </span>
        )}
        {suggestions.length > 0 && (
          <div className="suggest" role="listbox" aria-label="Sugestões">
            {suggestions.map((sg) => (
              <button
                type="button"
                key={`${sg.kind}:${sg.text}`}
                role="option"
                aria-selected={false}
                onClick={() => {
                  setDraft(sg.text);
                  update({ q: sg.text });
                }}
              >
                {sg.text}
                <span className="kind">{sg.kind}</span>
              </button>
            ))}
          </div>
        )}

        {!active && recents.length > 0 && (
          <div className="recents">
            <span>Recentes:</span>
            {recents.map((r) => (
              <button type="button" key={r} className="btn small" onClick={() => update({ q: r })}>
                {r}
              </button>
            ))}
          </div>
        )}
        {!active && (
          <div className="examples">
            <span>Experimente:</span>
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} onClick={() => update({ q: ex })}>
                {ex}
              </button>
            ))}
          </div>
        )}
      </section>

      {loadError && (
        <section className="wrap" aria-label="Erro">
          <LoadError detail={loadError} />
        </section>
      )}

      {!loadError && !active && (
        <section className="wrap intro" aria-label="Sobre">
          <div className="tiles">
            <div className="tile">
              <span className="big">{total ? total.toLocaleString("pt-PT") : "—"}</span>
              <h2 className="title-3">locais com convenção ativa</h2>
              <p>
                Moradas, contactos e lista de exames de cada local, tal como registados pela ACSS.
              </p>
            </div>
            <div className="tile">
              <span className="big">{snap.data?.areas.length ?? "—"}</span>
              <h2 className="title-3">áreas de exame</h2>
              <p>De análises clínicas a radiologia, cardiologia, endoscopia e medicina física.</p>
            </div>
            <div className="tile">
              <span className="big">{snap.data?.version.slice(5).replace("-", "/") ?? "—"}</span>
              <h2 className="title-3">data da lista</h2>
              <p>
                A lista é atualizada uma vez por mês e só publicada se passar nas verificações de
                qualidade.
              </p>
            </div>
          </div>

          <div>
            <div className="section-head">
              <h2 className="title-2">Ou comece por uma área</h2>
              <p>Pode combinar várias áreas e depois adicionar a sua localização.</p>
            </div>
            <div className="areas-grid" style={{ marginTop: 16 }}>
              {sortedAreas.map((a) => (
                <button
                  type="button"
                  key={a.code}
                  className="area-card"
                  onClick={() => toggleArea(a.code)}
                >
                  <b>{a.name}</b>
                  <span>{areaCounts.get(a.code) ?? 0}</span>
                </button>
              ))}
              {!snap.data &&
                [1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 52 }} />
                ))}
            </div>
          </div>
        </section>
      )}

      {!loadError && active && (
        <section className="wrap results" aria-label="Resultados">
          {code && (
            <div className="code-hit">
              <span className="mono">{code.convCode}</span>
              <b>{code.description}</b>
              <span className="hint">
                área {code.areaCode}
                {code.group ? ` · ${code.group}` : ""}
              </span>
              {code.price != null && (
                <span className="price">preço conv. {code.price.toFixed(2)} €</span>
              )}
            </div>
          )}

          <fieldset className="chips">
            <legend className="sr-only">Filtrar por área</legend>
            {sortedAreas.map((a) => (
              <button
                type="button"
                key={a.code}
                className={`chip${areaCodes.has(a.code) ? " on" : ""}`}
                onClick={() => toggleArea(a.code)}
                aria-pressed={areaCodes.has(a.code)}
              >
                {a.name}
                <span className="n">{areaCounts.get(a.code) ?? 0}</span>
              </button>
            ))}
          </fieldset>

          <div className="toolbar">
            <span className="count" aria-live="polite" aria-atomic="true">
              {!index
                ? "a carregar…"
                : `${hits.length.toLocaleString("pt-PT")} prestador${hits.length === 1 ? "" : "es"}`}{" "}
              {index && q.trim().length >= 2 && <small>para “{q}”</small>}
            </span>
            <label className="control">
              Ordenar
              <select
                id="sort"
                value={sort}
                onChange={(e) =>
                  update({
                    sort:
                      e.target.value === (origin ? "distance" : "relevance")
                        ? null
                        : e.target.value,
                  })
                }
              >
                <option value="relevance">Relevância e atividade</option>
                <option value="distance" disabled={!origin}>
                  Distância
                </option>
                <option value="name">Nome</option>
              </select>
            </label>
            {origin && (
              <label className="control">
                Raio
                <select
                  id="raio"
                  value={radiusKm}
                  onChange={(e) => update({ raio: e.target.value === "0" ? null : e.target.value })}
                >
                  <option value={0}>Qualquer</option>
                  <option value={5}>5 km</option>
                  <option value={10}>10 km</option>
                  <option value={25}>25 km</option>
                  <option value={50}>50 km</option>
                </select>
              </label>
            )}
            <fieldset className="segmented">
              <legend className="sr-only">Vista</legend>
              <button
                type="button"
                className={view === "list" ? "on" : ""}
                onClick={() => setView("list")}
              >
                Lista
              </button>
              <button
                type="button"
                className={view === "map" ? "on" : ""}
                onClick={() => setView("map")}
              >
                Mapa
              </button>
            </fieldset>
          </div>

          <div className={`split${view === "map" ? " map-first" : ""}`}>
            <div className="list">
              {!index && [1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}
              {index && hits.length === 0 && (
                <div className="empty">
                  <b>Sem prestadores para esta pesquisa</b>
                  <span>
                    Experimente um termo mais geral (por exemplo “ecografia” em vez do órgão),
                    remova filtros de área
                    {radiusKm > 0 ? " ou alargue o raio" : ""}.
                  </span>
                  <button type="button" className="btn small" onClick={clearAll}>
                    Limpar pesquisa
                  </button>
                </div>
              )}
              {hits.slice(0, visible).map((h) => (
                <Link
                  key={h.loc.id}
                  to={`/p/${h.loc.id}${providerQuery}`}
                  className={`card${hover === h.loc.id ? " hover" : ""}`}
                  onMouseEnter={() => setHover(h.loc.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="card-top">
                    <h3>{h.loc.name}</h3>
                    {h.distanceKm != null && <span className="dist">{formatKm(h.distanceKm)}</span>}
                    {origin && h.distanceKm == null && (
                      <span className="dist none" title="sem coordenadas na fonte">
                        sem coords
                      </span>
                    )}
                  </div>
                  <div className="addr">
                    {h.loc.address.street}
                    {h.loc.address.postalCode ? ` · ${h.loc.address.postalCode}` : ""}{" "}
                    {h.loc.address.locality ?? ""}
                    {h.loc.address.municipalityName &&
                    h.loc.address.municipalityName !== h.loc.address.locality
                      ? `, ${h.loc.address.municipalityName}`
                      : ""}
                    {h.loc.coordsSource === "approx" && (
                      <span className="approx" title="Localização aproximada pelo código postal">
                        ≈
                      </span>
                    )}
                  </div>
                  <div className="tags">
                    {(h.matchedValencias.length > 0 ||
                      (code &&
                        h.loc.conventions.some((c) =>
                          c.valencias.some((v) => v.convCodes.includes(code.convCode)),
                        ))) && <span className="tag positive">Exame confirmado</span>}
                    {h.loc.signals
                      .filter((sg) => sg.tone === "warning")
                      .slice(0, 1)
                      .map((sg) => (
                        <span key={sg.code} className="tag warning">
                          {sg.label}
                        </span>
                      ))}
                    <span className="facts-line">
                      {h.loc.signals
                        .filter((sg) => sg.tone === "positive" || sg.code === "high-volume")
                        .slice(0, 3)
                        .map((sg) => sg.label)
                        .join(" · ")}
                    </span>
                  </div>
                  {h.loc.signals.find((sg) => sg.tone === "warning") && (
                    <div className="warn-note">
                      {h.loc.signals.find((sg) => sg.tone === "warning")!.detail}
                    </div>
                  )}
                  <div className="areas">
                    {[...new Map(h.loc.conventions.map((c) => [c.area.code, c.area])).values()].map(
                      (a) => (
                        <span
                          key={a.code}
                          className={`area-pill${areaCodes.has(a.code) || code?.areaCode === a.code ? " match" : ""}`}
                        >
                          {a.name}
                        </span>
                      ),
                    )}
                  </div>
                  {h.matchedValencias.length > 0 && (
                    <div className="match-line">
                      {h.matchedValencias.map((v, i) => (
                        <span key={v}>
                          {i > 0 ? " · " : ""}
                          <mark>{v}</mark>
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
              {hits.length > visible && (
                <div className="more">
                  <button type="button" className="btn" onClick={showMore}>
                    Mostrar mais {Math.min(PAGE, hits.length - visible)} de {hits.length - visible}
                  </button>
                </div>
              )}
            </div>
            <section
              className="map-wrap"
              aria-label="Mapa dos resultados; os mesmos prestadores estão na lista"
            >
              <MapView
                key={theme}
                theme={theme}
                locations={mapLocations}
                origin={origin}
                highlightId={hover}
                onSelect={onSelect}
                onHover={onHover}
              />
            </section>
          </div>
        </section>
      )}
    </>
  );
}
