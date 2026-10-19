import type { SessionSummary } from "../api";
import { useI18n } from "../i18n/i18n";

const DOT: Record<SessionSummary["status"], string> = {
  running: "bg-fact animate-pulse",
  completed: "bg-fact",
  error: "bg-destructive",
  aborted: "bg-muted-foreground",
  max_turns: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
};

export function StatusBadge({ status }: { status: SessionSummary["status"] }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {t.status[status]}
    </span>
  );
}
