import { Ellipsis, Languages, Monitor, Moon, PanelLeftClose, PanelLeftOpen, SquarePen, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SessionSummary } from "../api";
import { useI18n } from "../i18n/i18n";
import type { ThemePref } from "../theme";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { StatusBadge } from "./StatusBadge";

type Group = "today" | "yesterday" | "week" | "older";

function groupOf(ts: number, now = new Date()): Group {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - day) return "yesterday";
  if (ts >= startOfToday - 7 * day) return "week";
  return "older";
}

const THEME_ICONS: Record<ThemePref, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

function ThemeMenu({ value, onChange }: { value: ThemePref; onChange: (pref: ThemePref) => void }) {
  const { t } = useI18n();
  const Icon = THEME_ICONS[value];
  return (
    <DropdownMenu>
      {/* 提示和下拉菜单共用同一个按钮：两层触发器都用 asChild 合并到 Button 上 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t.theme.label}: ${t.theme[value]}`}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{`${t.theme.label}: ${t.theme[value]}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ThemePref)}>
          {(["system", "light", "dark"] as const).map((pref) => {
            const ItemIcon = THEME_ICONS[pref];
            return (
              <DropdownMenuRadioItem key={pref} value={pref}>
                <ItemIcon className="h-4 w-4" />
                {t.theme[pref]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 悬停时出现的 … 菜单。运行中（包括等待确认）的会话不能删除 */
function SessionMenu({ session, onDelete }: { session: SessionSummary; onDelete: () => void }) {
  const { t } = useI18n();
  const running = session.status === "running";
  return (
    // modal={false}：菜单关闭后马上打开确认框，避免两层模态抢焦点
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.sessionActions}
          className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem
          disabled={running}
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 />
          {t.deleteSession.action}
          {running && <span className="ml-auto pl-3 text-xs text-muted-foreground">{t.deleteSession.runningHint}</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteDialog({
  session,
  onClose,
  onConfirm,
}: {
  session: SessionSummary | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <AlertDialog
      open={session !== null}
      onOpenChange={(open) => {
        if (open || busy) return;
        setFailed(false);
        onClose();
      }}
    >
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{t.deleteSession.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">{session && t.deleteSession.body(session.task)}</AlertDialogDescription>
          {failed && <p className="text-sm text-destructive">{t.deleteSession.failed}</p>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t.deleteSession.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              // 等删除完成再关闭；失败时留在弹窗里显示原因
              e.preventDefault();
              if (!session) return;
              setBusy(true);
              try {
                await onConfirm(session.id);
                setFailed(false);
                onClose();
              } catch {
                setFailed(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.deleteSession.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Sidebar(props: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => Promise<void>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
}) {
  const { t, lang, toggle } = useI18n();
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘B" : "Ctrl+B";

  const time = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" });

  const groups: Group[] = ["today", "yesterday", "week", "older"];
  const byGroup = new Map<Group, SessionSummary[]>();
  for (const s of props.sessions) {
    const g = groupOf(s.startedAt);
    byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
  }

  const collapsed = props.collapsed;

  // 收起和展开共用同一个 aside 做宽度过渡，两套内容交叉淡入。
  // 隐藏的一套设为 inert，避免 Tab 键把焦点移到看不见的按钮上。
  return (
    <aside
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden border-r border-border/70 bg-sidebar-surface transition-[width] duration-200 ease-smooth",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div
        inert={!collapsed}
        aria-hidden={!collapsed}
        className={cn(
          "absolute inset-y-0 left-0 flex w-14 flex-col items-center gap-1 py-2 transition-opacity duration-100 ease-smooth",
          collapsed ? "opacity-100 delay-100" : "pointer-events-none opacity-0",
        )}
      >
        <IconButton label={`${t.expandSidebar} (${shortcut})`} onClick={props.onToggleCollapsed}>
          <PanelLeftOpen />
        </IconButton>
        <IconButton label={t.newSession} onClick={props.onNew}>
          <SquarePen />
        </IconButton>
        <div className="mt-auto flex flex-col items-center gap-1">
          <ThemeMenu value={props.theme} onChange={props.onThemeChange} />
          <IconButton label={t.languageHint} onClick={toggle}>
            <Languages />
          </IconButton>
        </div>
      </div>

      <div
        inert={collapsed}
        aria-hidden={collapsed}
        className={cn(
          "flex h-full w-64 flex-col transition-opacity duration-100 ease-smooth",
          collapsed ? "pointer-events-none opacity-0" : "opacity-100 delay-100",
        )}
      >
        <div className="flex h-12 items-center gap-1 pr-2 pl-4">
          <span className="flex-1 text-[15px] font-semibold tracking-tight">{t.appName}</span>
          <IconButton label={`${t.collapseSidebar} (${shortcut})`} onClick={props.onToggleCollapsed}>
            <PanelLeftClose />
          </IconButton>
          <IconButton label={t.newSession} onClick={props.onNew}>
            <SquarePen />
          </IconButton>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav className="px-2 pb-3">
            {props.sessions.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">{t.noSessions}</p>}
            {groups.map((g) => {
              const items = byGroup.get(g);
              if (!items) return null;
              return (
                <div key={g} className="mt-3 first:mt-1">
                  <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t.groups[g]}</div>
                  {items.map((s) => (
                    <div key={s.id} className="group relative">
                      <button
                        onClick={() => props.onSelect(s.id)}
                        className={cn(
                          "block w-full rounded-md px-2 py-1.5 text-left transition-colors group-focus-within:pr-8 group-hover:pr-8 group-has-[[data-state=open]]:pr-8 hover:bg-accent/70",
                          props.selected === s.id && "bg-accent",
                        )}
                      >
                        <div className="truncate text-sm">{s.task}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <StatusBadge status={s.status} />
                          <span className="truncate tabular-nums">
                            {g === "today" || g === "yesterday" ? time.format(s.startedAt) : date.format(s.startedAt)}
                          </span>
                        </div>
                      </button>
                      <SessionMenu session={s} onDelete={() => setDeleting(s)} />
                    </div>
                  ))}
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="flex items-center gap-1 border-t border-border/70 px-2 py-2">
          <button
            onClick={toggle}
            title={t.languageHint}
            className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          >
            <Languages className="h-4 w-4" />
            {t.language}
          </button>
          <ThemeMenu value={props.theme} onChange={props.onThemeChange} />
        </div>
      </div>

      <DeleteDialog session={deleting} onClose={() => setDeleting(null)} onConfirm={props.onDelete} />
    </aside>
  );
}
