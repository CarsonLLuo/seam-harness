import { Languages, Monitor, Moon, PanelLeftClose, PanelLeftOpen, SquarePen, Sun } from "lucide-react";
import type { SessionSummary } from "../api";
import { useI18n } from "../i18n/i18n";
import type { ThemePref } from "../theme";
import {
  DropdownMenu,
  DropdownMenuContent,
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

export function Sidebar(props: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  theme: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
}) {
  const { t, lang, toggle } = useI18n();
  const shortcut = navigator.platform.toLowerCase().includes("mac") ? "⌘B" : "Ctrl+B";

  // 收起后只留一条窄栏：展开、新会话，底部是主题和语言
  if (props.collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-sidebar-surface py-2">
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
      </aside>
    );
  }

  const time = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" });

  const groups: Group[] = ["today", "yesterday", "week", "older"];
  const byGroup = new Map<Group, SessionSummary[]>();
  for (const s of props.sessions) {
    const g = groupOf(s.startedAt);
    byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/70 bg-sidebar-surface">
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
                  <button
                    key={s.id}
                    onClick={() => props.onSelect(s.id)}
                    className={cn(
                      "block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/70",
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
    </aside>
  );
}
