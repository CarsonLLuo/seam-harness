import type { SessionSummary } from "../api";
import { useI18n } from "../i18n/i18n";
import { StatusBadge } from "./StatusBadge";

export function Sidebar(props: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNewTask: () => void;
}) {
  const { t, lang, toggle } = useI18n();
  const time = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="text-base font-semibold tracking-tight">{t.appName}</span>
        <button
          onClick={toggle}
          className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t.language}
        </button>
      </div>
      <div className="px-3">
        <button
          onClick={props.onNewTask}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          {t.newTask}
        </button>
      </div>
      <div className="mt-5 px-4 pb-2 text-xs font-medium text-muted-foreground">{t.sessions}</div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {props.sessions.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t.noSessions}</p>}
        {props.sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => props.onSelect(s.id)}
            className={`mb-0.5 block w-full rounded-md px-2 py-2 text-left hover:bg-muted ${
              props.selected === s.id ? "bg-muted" : ""
            }`}
          >
            <div className="truncate text-sm">{s.task}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={s.status} />
              <span className="truncate">
                {time.format(s.startedAt)} · {s.model}
              </span>
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
