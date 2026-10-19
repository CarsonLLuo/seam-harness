import { History, Lightbulb, PanelRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SeamEvent } from "../../events";
import { reconstruct } from "../../replay";
import { respondApproval, sendMessage, startTask, stopSession, subscribe, type ApprovalRequest, type Config } from "../api";
import { useI18n } from "../i18n/i18n";
import { eventsAtStep, replaySteps } from "../replay-steps";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { ApprovalBanner } from "./ApprovalBanner";
import { Composer } from "./Composer";
import { IconButton } from "./IconButton";
import { ModelPicker } from "./ModelPicker";
import { initialModelChoice, loadModelChoice, saveModelChoice } from "../model-choice";
import { ReplayBar } from "./ReplayBar";
import { StatusBadge } from "./StatusBadge";
import { Turn } from "./Turn";
import { WorkspacePicker } from "./WorkspacePicker";

interface ViewProps {
  rawOpen: boolean;
  onToggleRaw: () => void;
  onRaw: (value: unknown) => void;
}

/** 新会话：空白对话页 + 底部输入框，输入框工具栏里选模型和工作区 */
export function NewChat({ config, onCreated, ...view }: ViewProps & { config: Config; onCreated: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [choice, setChoice] = useState(() => initialModelChoice(config.providers, loadModelChoice()));
  const [workspace, setWorkspace] = useState(config.defaultWorkspace);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 每次打开新会话页随机选一条提示；切换语言时保持同一条
  const [tipIndex] = useState(() => Math.floor(Math.random() * t.tips.length));

  return (
    <div className="flex min-w-0 flex-1 flex-col animate-in fade-in duration-150 ease-smooth">
      <Header title={t.newSession} {...view} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          <h1 className="mb-2 text-center text-2xl font-semibold tracking-tight">{t.welcomeTitle}</h1>
          <p className="mx-auto mb-5 max-w-md text-center text-sm text-muted-foreground">{t.welcomeHint}</p>
          <div className="mx-auto mb-8 flex w-fit max-w-full items-start gap-2 rounded-2xl bg-muted/50 px-4 py-2 text-[13px] text-muted-foreground">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/80" aria-label={t.tipLabel} />
            <span>{t.tips[tipIndex]}</span>
          </div>
          {config.providers.length === 0 && <p className="mb-3 text-center text-sm text-destructive">{t.noProviders}</p>}
          <Composer
            placeholder={t.composerPlaceholder}
            value={draft}
            onValueChange={setDraft}
            running={false}
            disabled={!choice}
            onStop={() => undefined}
            onSubmit={async (task) => {
              setError(null);
              try {
                const { sessionId } = await startTask({ task, provider: choice!.provider, model: choice!.model, workspace, lang });
                onCreated(sessionId);
              } catch (err) {
                setError(`${t.errors.start} ${(err as Error).message}`);
                throw err;
              }
            }}
            toolbar={
              <>
                <ModelPicker
                  providers={config.providers}
                  value={choice}
                  onChange={(c) => {
                    setChoice(c);
                    saveModelChoice(c);
                  }}
                />
                <WorkspacePicker
                  value={workspace}
                  onChange={(path) => {
                    setError(null);
                    setWorkspace(path);
                  }}
                  canPickFolder={config.canPickFolder}
                  onError={setError}
                />
              </>
            }
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">{error ?? t.readOnlyHint}</p>
          <div className="mt-8">
            <div className="mb-2 text-xs font-medium text-muted-foreground">{t.examplesLabel}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {t.examples.map((example) => (
                <button
                  key={example}
                  onClick={() => setDraft(example)}
                  className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13px] leading-snug text-muted-foreground shadow-xs transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 已有会话：实时显示、继续追问、回放 */
export function SessionChat({ sessionId, onActivity, ...view }: ViewProps & { sessionId: string; onActivity: () => void }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<SeamEvent[]>([]);
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>({});
  // 服务端补发完历史事件后才会发第一条 status；在此之前收到的回合都算历史，不播入场动画
  const [animateFrom, setAnimateFrom] = useState<number | null>(null);
  const lastSeq = useRef(0);
  const turnCount = useRef(0);

  useEffect(
    () =>
      subscribe(sessionId, (m) => {
        if (m.kind === "event") {
          // 重连时服务端会从头补发事件，按序号去重
          if (m.event.seq <= lastSeq.current) return;
          lastSeq.current = m.event.seq;
          if (m.event.type === "turn_start") turnCount.current += 1;
          if (m.event.type === "permission") {
            // 某个请求已经有决定了，顺手收掉可能残留的确认卡
            const toolCallId = m.event.data.toolCallId;
            setApprovals((prev) => {
              if (!(toolCallId in prev)) return prev;
              const next = { ...prev };
              delete next[toolCallId];
              return next;
            });
          }
          setEvents((prev) => [...prev, m.event]);
        } else if (m.kind === "delta") setDeltas((prev) => ({ ...prev, [m.turn]: (prev[m.turn] ?? "") + m.text }));
        else if (m.kind === "approval") {
          setApprovals((prev) => ({ ...prev, [m.request.toolCallId]: m.request }));
        } else if (m.kind === "approval_resolved") {
          setApprovals((prev) => {
            const next = { ...prev };
            delete next[m.toolCallId];
            return next;
          });
        } else {
          setAnimateFrom((v) => v ?? turnCount.current);
          setRunning(m.running);
          // 运行结束后不应该还有挂起的确认；清掉重连时可能残留的旧卡片
          if (!m.running) setApprovals({});
          onActivity();
        }
      }),
    [sessionId, onActivity],
  );

  const steps = useMemo(() => replaySteps(events), [events]);
  const replaying = replayStep !== null;
  const visible = useMemo(
    () => (replaying ? eventsAtStep(events, steps, replayStep) : events),
    [events, steps, replayStep, replaying],
  );
  const session = useMemo(() => reconstruct(visible), [visible]);
  const full = useMemo(() => reconstruct(events), [events]);
  const start = full.start;
  const pendingApprovals = Object.values(approvals);
  const waiting = pendingApprovals.length > 0;
  const status = waiting ? "waiting" : running ? "running" : (full.end?.reason ?? "unknown");

  if (!start) return <div className="flex-1" />;

  const toggleReplay = () => setReplayStep(replaying ? null : 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col animate-in fade-in duration-150 ease-smooth">
      <Header
        title={start.task}
        meta={
          <>
            <StatusBadge status={status} />
            <span className="shrink-0">
              {start.model.provider}/{start.model.id}
            </span>
            <span className="min-w-0 truncate font-mono" title={start.workspace}>
              {start.workspace}
            </span>
          </>
        }
        actions={
          <IconButton label={replaying ? t.replay.exit : t.replay.toggle} active={replaying} onClick={toggleReplay} disabled={running || steps.length === 0}>
            <History />
          </IconButton>
        }
        {...view}
      />

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-6 pt-6 pb-10">
          {session.turns.map((turn, index) => (
            <Turn
              key={turn.turn}
              turn={turn}
              animate={!replaying && animateFrom !== null && index >= animateFrom}
              streaming={replaying || turn.assistant ? undefined : deltas[turn.turn]}
              approvals={approvals}
              onRaw={view.onRaw}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        {pendingApprovals[0] && (
          <ApprovalBanner
            key={pendingApprovals[0].toolCallId}
            request={pendingApprovals[0]}
            count={pendingApprovals.length}
            onRespond={async (body) => {
              await respondApproval(sessionId, pendingApprovals[0]!.toolCallId, body);
            }}
          />
        )}
        {replaying ? (
          <ReplayBar steps={steps.length} step={replayStep} onStep={setReplayStep} />
        ) : (
          <>
            <Composer
              placeholder={t.followUpPlaceholder}
              running={running}
              onStop={() => void stopSession(sessionId).catch(() => undefined)}
              onSubmit={async (text) => {
                setError(null);
                try {
                  await sendMessage(sessionId, text);
                } catch (err) {
                  setError(`${t.errors.send} ${(err as Error).message}`);
                  throw err;
                }
              }}
            />
            {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Header(props: ViewProps & { title: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{props.title}</div>
        {props.meta && (
          <div className="mt-0.5 flex min-w-0 items-center gap-3 text-xs whitespace-nowrap text-muted-foreground">{props.meta}</div>
        )}
      </div>
      {props.actions}
      <IconButton label={t.raw.toggle} active={props.rawOpen} onClick={props.onToggleRaw}>
        <PanelRight />
      </IconButton>
    </header>
  );
}
