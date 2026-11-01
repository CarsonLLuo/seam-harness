import { X } from "lucide-react";
import type { SeamEvent } from "../../events";
import { useI18n } from "../i18n/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CoveragePanel } from "./CoveragePanel";
import { IconButton } from "./IconButton";
import { TaskMapPanel } from "./TaskMapPanel";

export type PanelTab = "map" | "coverage" | "raw";

/** 当前会话的事件（回放时是回放到的那一步为止），供任务地图和阅读覆盖使用 */
export interface PanelSession {
  sessionId: string;
  events: SeamEvent[];
}

/** 右侧辅助面板：任务地图、阅读覆盖、原始记录 */
export function RawPanel({
  value,
  open,
  onClose,
  tab,
  onTab,
  session,
}: {
  value: unknown;
  open: boolean;
  onClose: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  session: PanelSession | null;
}) {
  const { t } = useI18n();
  return (
    // 面板常驻，用外层宽度做滑入滑出；内层固定宽度并裁掉，避免关闭时内容被压扁
    <aside
      inert={!open}
      aria-hidden={!open}
      className={cn(
        "shrink-0 overflow-hidden transition-[width] duration-200 ease-smooth",
        open ? "w-[clamp(280px,34vw,460px)]" : "w-0",
      )}
    >
      <div className="flex h-full w-[clamp(280px,34vw,460px)] flex-col border-l border-border bg-sidebar-surface">
        <Tabs value={tab} onValueChange={(v) => onTab(v as PanelTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-13 items-center justify-between pr-2 pl-3">
            <TabsList className="h-auto gap-0.5 bg-transparent p-0">
              {session && <TabsTrigger value="map" className="rounded-lg px-2.5 py-1 font-normal data-[state=active]:bg-accent data-[state=active]:shadow-none">{t.map.title}</TabsTrigger>}
              {session && <TabsTrigger value="coverage" className="rounded-lg px-2.5 py-1 font-normal data-[state=active]:bg-accent data-[state=active]:shadow-none">{t.coverage.title}</TabsTrigger>}
              <TabsTrigger value="raw" className="rounded-lg px-2.5 py-1 font-normal data-[state=active]:bg-accent data-[state=active]:shadow-none">{t.raw.title}</TabsTrigger>
            </TabsList>
            <IconButton label={t.raw.close} onClick={onClose}>
              <X />
            </IconButton>
          </div>
          {session && (
            <TabsContent value="map" className="mt-0 min-h-0 flex-1">
              <ScrollArea className="h-full">
                <TaskMapPanel events={session.events} />
              </ScrollArea>
            </TabsContent>
          )}
          {session && (
            <TabsContent value="coverage" className="mt-0 min-h-0 flex-1">
              <ScrollArea className="h-full">
                <CoveragePanel key={session.sessionId} sessionId={session.sessionId} events={session.events} />
              </ScrollArea>
            </TabsContent>
          )}
          <TabsContent value="raw" className="mt-0 min-h-0 flex-1">
            <ScrollArea className="h-full">
              {value === undefined ? (
                <p className="p-4 text-sm text-muted-foreground">{t.raw.empty}</p>
              ) : (
                <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
