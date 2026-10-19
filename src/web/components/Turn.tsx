import { Check, ChevronRight, FilePen, FileText, Loader2, Search, SquareTerminal, Wrench, X, type LucideIcon } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReplayToolCall, ReplayTurn } from "../../replay";
import { useI18n } from "../i18n/i18n";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Raw = (value: unknown) => void;

const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  write_file: FilePen,
  search: Search,
  run_command: SquareTerminal,
};

/** 工具调用最值得一眼看到的参数 */
const KEY_ARG: Record<string, string> = { read_file: "path", write_file: "path", search: "pattern", run_command: "command" };

function textOf(content: unknown[] | undefined): string {
  return (content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("\n")
    .trim();
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>
  );
}

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral max-w-none text-[15px] leading-relaxed dark:prose-invert prose-p:my-2 prose-pre:bg-code-bg prose-pre:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-table:text-sm">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function Turn({
  turn,
  streaming,
  animate,
  onRaw,
}: {
  turn: ReplayTurn;
  streaming?: string;
  /** 只在运行过程中新出现的回合入场时播放动画，打开历史会话时不重播 */
  animate?: boolean;
  onRaw: Raw;
}) {
  const { t } = useI18n();
  const request = turn.requests.at(-1);
  const body = request?.body as { messages?: unknown[]; tools?: unknown[] } | undefined;
  const text = turn.assistant ? textOf(turn.assistant.content) : streaming;
  const usage = turn.assistant?.usage as
    | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
    | undefined;
  const input = usage ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : undefined;
  const userText = turn.user ? (typeof turn.user.content === "string" ? turn.user.content : textOf(turn.user.content as unknown[])) : "";

  return (
    <div className={cn("space-y-3", animate && "animate-in fade-in slide-in-from-bottom-1 duration-150 ease-smooth")}>
      {userText && <UserMessage text={userText} />}

      <div className="group/turn">
        {/* 轮次标题：harness 记录的事实，可打开原始请求 */}
        <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
          <span className="shrink-0 font-medium">{t.turn(turn.turn)}</span>
          {request && (
            <button onClick={() => onRaw(request)} className="min-w-0 truncate rounded px-1 hover:bg-accent/70 hover:text-foreground">
              {t.request(body?.messages?.length ?? 0, body?.tools?.length ?? 0)}
            </button>
          )}
          {usage && input !== undefined && <span className="tabular-nums opacity-0 transition-opacity group-hover/turn:opacity-100">{t.tokens(input, usage.output ?? 0)}</span>}
        </div>

        {text ? (
          <MarkdownText text={text} />
        ) : (
          !turn.assistant &&
          turn.toolCalls.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.thinking}
            </div>
          )
        )}
        {turn.assistant?.errorMessage && <p className="mt-2 text-sm text-destructive">{turn.assistant.errorMessage}</p>}

        {turn.toolCalls.length > 0 && (
          <div className={cn("space-y-1.5", text && "mt-3")}>
            {turn.toolCalls.map((c) => (
              <ToolCallRow key={c.call.toolCallId} call={c} animate={animate} onRaw={onRaw} />
            ))}
          </div>
        )}

        {turn.end && (
          <div className="mt-3 text-xs text-muted-foreground tabular-nums">
            {t.runEnded(t.status[turn.end.reason], (turn.end.durationMs / 1000).toFixed(1))}
            {turn.end.errorMessage && <span className="text-destructive"> — {turn.end.errorMessage}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallRow({ call, animate, onRaw }: { call: ReplayToolCall; animate?: boolean; onRaw: Raw }) {
  const { t } = useI18n();
  const { name, args } = call.call;
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const keyArg = args[KEY_ARG[name] ?? ""];
  const permission = call.permission;
  const result = call.result;
  const denied = permission?.decision === "deny";
  const resultText = result ? textOf(result.content) : "";

  const StatusIcon = !result ? Loader2 : denied || result.isError ? X : Check;
  const permissionLabel = !permission
    ? t.permission.pending
    : denied
      ? t.permission.deny
      : permission.by === "auto"
        ? t.permission.allowAuto
        : t.permission.allowUser;

  return (
    <Collapsible
      className={cn(
        "rounded-lg border border-border/60 bg-card/60",
        animate && "animate-in fade-in duration-150 ease-smooth",
      )}
    >
      <CollapsibleTrigger className="group/row flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/row:rotate-90" />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-[13px]">{name}</span>
        {typeof keyArg === "string" && <span className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">{keyArg}</span>}
        <StatusIcon
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0",
            !result && "animate-spin text-muted-foreground",
            result && (denied || result.isError ? "text-destructive" : "text-fact"),
          )}
        />
      </CollapsibleTrigger>

      {/* 模型自述：专用颜色、虚线竖条、明确标注；始终可见 */}
      <div className="mx-3 mb-2 border-l-2 border-dashed border-self-report pl-2 text-sm text-self-report" title={t.source.model}>
        <span className="font-medium">{t.modelSays}</span>{" "}
        <span className="italic">{typeof args.intent === "string" ? args.intent : t.intentMissing}</span>
      </div>

      {/* harness 记录的事实：展开后可见。高度动画放在外层，内边距放在内层，收起时高度才能真正归零 */}
      <CollapsibleContent
        className="overflow-hidden border-t border-border/60 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down duration-200 ease-smooth"
        title={t.source.harness}
      >
        <div className="px-3 py-2 text-sm">
          <div className={cn(denied ? "text-destructive" : "text-fact")}>
            {permissionLabel}
            {permission?.reason && <span className="text-muted-foreground"> — {permission.reason}</span>}
          </div>
          {result && !(denied && resultText === permission?.reason) && (
            <div className="mt-2">
              <div className={cn("mb-1 text-xs font-medium", result.isError ? "text-destructive" : "text-muted-foreground")}>
                {result.isError ? t.resultError : t.result}
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">{resultText}</pre>
            </div>
          )}
          <button onClick={() => onRaw(call)} className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t.viewRaw}
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
