import { X } from "lucide-react";
import { useI18n } from "../i18n/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconButton } from "./IconButton";

/** 右侧辅助面板。目前只有“原始记录”一个标签，M4 的任务地图和阅读覆盖图会放在这里 */
export function RawPanel({ value, onClose }: { value: unknown; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <aside className="flex w-[clamp(280px,34vw,460px)] shrink-0 flex-col border-l border-border/70 bg-sidebar-surface">
      <Tabs defaultValue="raw" className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-border/70 pr-2 pl-3">
          <TabsList>
            <TabsTrigger value="raw">{t.raw.title}</TabsTrigger>
          </TabsList>
          <IconButton label={t.raw.close} onClick={onClose}>
            <X />
          </IconButton>
        </div>
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
    </aside>
  );
}
