import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand";

export type Theme = "light" | "dark";
/** Preferência guardada: seguir o sistema (HIG) ou forçar um modo. */
export type ThemePref = "system" | Theme;
const KEY = "sns-conv-theme";

interface ThemeCtx {
  /** modo efetivamente aplicado */
  theme: Theme;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  /** sistema → claro → escuro → sistema */
  cycle: () => void;
}
const Ctx = createContext<ThemeCtx>({
  theme: "light",
  pref: "system",
  setPref: () => {},
  cycle: () => {},
});

function readStored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}
function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(readStored);
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const theme: Theme = pref === "system" ? system : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#000000" : "#f5f5f7");
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* armazenamento indisponível: a preferência fica só nesta sessão */
    }
  }, [theme, pref]);
  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      pref,
      setPref,
      cycle: () => setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system")),
    }),
    [theme, pref],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}

/** Título do documento por página, para leitores de ecrã e separadores. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ${BRAND}` : BRAND;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
