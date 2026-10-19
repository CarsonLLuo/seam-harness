import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type Messages } from "./messages.en";
import { zh } from "./messages.zh";

export type Lang = "en" | "zh";

const DICTS: Record<Lang, Messages> = { en, zh };
const STORAGE_KEY = "seam.lang";

interface I18n {
  lang: Lang;
  t: Messages;
  toggle: () => void;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "zh") return saved;
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  const toggle = () => {
    const next = lang === "en" ? "zh" : "en";
    localStorage.setItem(STORAGE_KEY, next);
    setLang(next);
  };
  return <Ctx.Provider value={{ lang, t: DICTS[lang], toggle }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
