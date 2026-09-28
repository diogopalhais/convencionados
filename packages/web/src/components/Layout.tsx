import { NavLink, Outlet } from "react-router";
import { BRAND, NOT_OFFICIAL } from "../brand";
import { loadSnapshot, useAsync } from "../data";
import { useTheme } from "../theme";

function SunIcon() {
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
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </svg>
  );
}
function AutoIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function MoonIcon() {
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
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function Layout() {
  const snap = useAsync(() => loadSnapshot(), []);
  const { theme, pref, cycle } = useTheme();
  const prefLabel =
    pref === "system" ? "a seguir o sistema" : pref === "light" ? "claro" : "escuro";
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2a7 7 0 0 0-7 7c0 5 6 10.5 6.6 11a.6.6 0 0 0 .8 0C13 19.5 19 14 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
              </svg>
            </span>
            {BRAND}
          </NavLink>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/" end>
              Pesquisar
            </NavLink>
            <NavLink to="/qualidade">Dados</NavLink>
          </nav>
          <button
            type="button"
            className="icon-btn"
            onClick={cycle}
            aria-label={`Aparência: ${prefLabel}. Mudar`}
            title={`Aparência: ${prefLabel}`}
          >
            {pref === "system" ? <AutoIcon /> : theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="wrap footer-inner">
          <div>
            <b>{BRAND}</b>
            <p>
              Lista de prestadores com convenção ativa com o SNS, obtida todos os meses do Sistema
              de Dados Mestre (SPMS/ACSS). Confirme sempre a disponibilidade junto do prestador
              antes de se deslocar.
            </p>
            <p className="footer-notice">{NOT_OFFICIAL}</p>
            <p>
              <NavLink to="/privacidade">Privacidade, fontes e contacto</NavLink>
            </p>
          </div>
          <div>
            <b>Dados</b>
            {snap.data ? (
              <p>
                Snapshot {snap.data.version} · {snap.data.counts.locations.toLocaleString("pt-PT")}{" "}
                locais · {snap.data.counts.entities} entidades
                <br />
                <NavLink to="/qualidade">Relatório de qualidade</NavLink>
              </p>
            ) : snap.error ? (
              <p>Dados indisponíveis de momento.</p>
            ) : (
              <p>a carregar…</p>
            )}
          </div>
          <div>
            <b>Fontes</b>
            <p>
              <a
                href="https://www.acss.min-saude.pt/2025/03/25/rede-de-prestadores-convencionados/"
                target="_blank"
                rel="noopener noreferrer"
              >
                ACSS · Rede de Prestadores Convencionados
              </a>
              <br />
              <a href="https://transparencia.sns.gov.pt/" target="_blank" rel="noopener noreferrer">
                Portal da Transparência do SNS
              </a>
              <br />
              <a
                href="https://www.sns24.gov.pt/pt/servico/exames-e-resultados/"
                target="_blank"
                rel="noopener noreferrer"
              >
                SNS 24 · marcação de exames
              </a>
              <br />
              <a
                href="https://www.ers.pt/pt/reclamacoes-em-numeros/"
                target="_blank"
                rel="noopener noreferrer"
              >
                ERS · Reclamações em números
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
