import type { SessionSummary } from "../api";
import { useI18n } from "../i18n/i18n";

const DOT: Record<SessionSummary["status"] | "waiting", string> = {
  running: "bg-foreground animate-pulse",
  waiting: "bg-amber-500 animate-pulse",
  completed: "bg-muted-foreground/60",
  error: "bg-destructive",
  aborted: "bg-muted-foreground",
  max_turns: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
};

export function StatusBadge({ status }: { status: SessionSummary["status"] | "waiting" }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {t.status[status]}
    </span>
  );
}
