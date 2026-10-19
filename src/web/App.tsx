import { useCallback, useEffect, useState } from "react";
import { getConfig, listSessions, type Config, type SessionSummary } from "./api";
import { NewTask } from "./components/NewTask";
import { RawPanel } from "./components/RawPanel";
import { SessionView } from "./components/SessionView";
import { Sidebar } from "./components/Sidebar";
import { useI18n } from "./i18n/i18n";

export function App() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(true);
  const [raw, setRaw] = useState<unknown | null>(null);

  const refresh = useCallback(() => {
    listSessions().then(setSessions).catch(() => undefined);
  }, []);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => undefined);
    refresh();
  }, [refresh]);

  // 有会话在运行时定期刷新列表里的状态
  useEffect(() => {
    if (!sessions.some((s) => s.status === "running")) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [sessions, refresh]);

  const open = (id: string) => {
    setSelected(id);
    setComposing(false);
    setRaw(null);
  };

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        selected={composing ? null : selected}
        onSelect={open}
        onNewTask={() => {
          setComposing(true);
          setRaw(null);
        }}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {composing ? (
          config && (
            <NewTask
              config={config}
              onStarted={(id) => {
                refresh();
                open(id);
              }}
            />
          )
        ) : selected ? (
          <SessionView key={selected} sessionId={selected} onRaw={setRaw} onEnded={refresh} />
        ) : (
          <p className="p-10 text-muted-foreground">{t.selectSession}</p>
        )}
      </main>
      {raw !== null && <RawPanel value={raw} onClose={() => setRaw(null)} />}
    </div>
  );
}
