import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteSession, getConfig, listSessions, type Config, type SessionSummary } from "./api";
import { useI18n } from "./i18n/i18n";
import { NewChat, SessionChat } from "./components/ChatView";
import { RawPanel } from "./components/RawPanel";
import { Sidebar } from "./components/Sidebar";
import { initialSelection, loadLastView, saveLastView } from "./startup";
import { applyTheme, loadThemePref, THEME_STORAGE_KEY, type ThemePref } from "./theme";

const SIDEBAR_KEY = "seam.sidebarCollapsed";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [raw, setRaw] = useState<unknown>(undefined);
  /** 拿到会话列表、决定好打开哪个会话之前不渲染主区域，避免先闪一下新会话页 */
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [theme, setTheme] = useState<ThemePref>(loadThemePref);

  useEffect(() => applyTheme(theme), [theme]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      localStorage.setItem(SIDEBAR_KEY, v ? "0" : "1");
      return !v;
    });
  }, []);

  // ⌘B / Ctrl+B 收起或展开侧栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  const refresh = useCallback(() => {
    listSessions().then(setSessions).catch(() => undefined);
  }, []);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => undefined);
    listSessions()
      .then((list) => {
        setSessions(list);
        setSelected(initialSelection(loadLastView(), list.map((s) => s.id)));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setUnauthorized(true);
      })
      .finally(() => setReady(true));
  }, []);

  const open = (id: string | null) => {
    setSelected(id);
    saveLastView(id);
    setRaw(undefined);
  };

  const view = {
    rawOpen,
    onToggleRaw: () => setRawOpen((v) => !v),
    onRaw: (value: unknown) => {
      setRaw(value);
      setRawOpen(true);
    },
  };

  if (unauthorized) {
    return (
      <div className="flex h-full items-center justify-center bg-content-area px-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-[15px] font-semibold">{t.unauthorized.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t.unauthorized.body}</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        <Sidebar
          sessions={sessions}
          selected={selected}
          onSelect={open}
          onNew={() => open(null)}
          onDelete={async (id) => {
            await deleteSession(id);
            refresh();
            if (selected === id) open(null);
          }}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          theme={theme}
          onThemeChange={(pref) => {
            localStorage.setItem(THEME_STORAGE_KEY, pref);
            setTheme(pref);
          }}
        />
        <main className="flex min-w-0 flex-1 bg-content-area">
          {!ready ? null : selected ? (
            <SessionChat key={selected} sessionId={selected} onActivity={refresh} {...view} />
          ) : (
            config && (
              <NewChat
                config={config}
                onCreated={(id) => {
                  refresh();
                  open(id);
                }}
                {...view}
              />
            )
          )}
        </main>
        <RawPanel value={raw} open={rawOpen} onClose={() => setRawOpen(false)} />
      </div>
    </TooltipProvider>
  );
}
