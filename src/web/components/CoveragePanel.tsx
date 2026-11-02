import { Fragment, useEffect, useMemo, useState } from "react";
import type { SeamEvent } from "../../events";
import { coverageAtRun, listRuns, readRuns, type ReadCoverage } from "../../insight";
import { listFiles } from "../api";
import { useI18n } from "../i18n/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** total：截至所选这次运行的累计覆盖；current：这次运行里读到的部分 */
interface Cov {
  total: ReadCoverage;
  current: ReadCoverage;
}

interface Dir {
  name: string;
  path: string;
  dirs: Map<string, Dir>;
  files: string[];
  /** 子树里的文件数 / 用 read_file 读过的文件数（注入的 SEAM.md 不算读过） */
  total: number;
  seen: number;
  /** 这次运行读到的文件数 */
  fresh: number;
}

function buildTree(paths: string[], cov: Cov): Dir {
  const root: Dir = { name: "", path: "", dirs: new Map(), files: [], total: 0, seen: 0, fresh: 0 };
  for (const path of paths) {
    const parts = path.split("/");
    const seen = path in cov.total.files;
    const fresh = path in cov.current.files;
    let dir = root;
    for (const d of [root, ...parts.slice(0, -1)]) {
      if (typeof d === "string") {
        let next = dir.dirs.get(d);
        if (!next) dir.dirs.set(d, (next = { name: d, path: dir.path ? `${dir.path}/${d}` : d, dirs: new Map(), files: [], total: 0, seen: 0, fresh: 0 }));
        dir = next;
      }
      dir.total++;
      if (seen) dir.seen++;
      if (fresh) dir.fresh++;
    }
    dir.files.push(path);
  }
  return root;
}

/** 树上的一行。folded：整个没读过的目录；unread：读过的目录里合在一起的没读文件 */
type Row = { depth: number; parent: number } & (
  | { kind: "dir"; dir: Dir; label: string }
  | { kind: "folded"; dir: Dir }
  | { kind: "file"; path: string }
  | { kind: "unread"; dir: Dir; count: number }
);

/** 侧栏很窄：没读过的目录和文件默认折叠，只有一个子目录的链条压成一行 */
function treeRows(top: Dir, cov: Cov, opened: Set<string>): Row[] {
  const rows: Row[] = [];
  const visit = (dir: Dir, depth: number, parent: number) => {
    let label = dir.name;
    while (depth > 0 && dir.dirs.size === 1 && dir.files.length === 0) {
      const only = [...dir.dirs.values()][0]!;
      if (only.seen === 0 && !opened.has(only.path)) break;
      dir = only;
      label += `/${only.name}`;
    }
    const self = rows.push({ kind: "dir", dir, label, depth, parent }) - 1;
    for (const d of dir.dirs.values()) {
      if (d.seen === 0 && !opened.has(d.path)) rows.push({ kind: "folded", dir: d, depth: depth + 1, parent: self });
      else visit(d, depth + 1, self);
    }
    const unread = dir.files.filter((p) => !(p in cov.total.files) && p !== cov.total.injected);
    const fold = unread.length >= 2 && dir.seen > 0 && !opened.has(`${dir.path}/`);
    for (const p of dir.files) if (!fold || !unread.includes(p)) rows.push({ kind: "file", path: p, depth: depth + 1, parent: self });
    if (fold) rows.push({ kind: "unread", dir, count: unread.length, depth: depth + 1, parent: self });
  };
  visit(top, 0, -1);
  return rows;
}

const ROW = 24;
const TONE = ["text-muted-foreground/60", "text-muted-foreground", "text-foreground"];

/**
 * 阅读覆盖：工作区文件树里点亮 agent 用 read_file 读过的文件；状态只来自日志。
 * 按次查看：显示截至所选这次的累计覆盖，这次读到的文件和通往它的路径单独高亮
 */
export function CoveragePanel({ sessionId, events }: { sessionId: string; events: SeamEvent[] }) {
  const { t } = useI18n();
  const runs = useMemo(() => listRuns(events), [events]);
  // null 表示跟着最新一次走；回放退到更早的步骤时，选中的次数不能超过已有的次数
  const [picked, setPicked] = useState<number | null>(null);
  const run = Math.min(picked ?? runs.length, runs.length);
  const cov = useMemo(() => coverageAtRun(events, run), [events, run]);
  const byFile = useMemo(() => readRuns(events), [events]);
  // 每次运行读了几个文件、其中几个是第一次读
  const perRun = useMemo(() => {
    const out = runs.map(() => ({ read: 0, first: 0 }));
    for (const rs of Object.values(byFile))
      rs.forEach((r, i) => {
        const c = out[r - 1];
        if (c) (c.read++, i === 0 && c.first++);
      });
    return out;
  }, [runs, byFile]);
  const [listing, setListing] = useState<{ files: string[]; truncated: boolean } | null>(null);
  const [missing, setMissing] = useState(false);
  const [focus, setFocus] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // agent 写文件或执行命令后，工作区里的文件可能变了，重新列一次
  const changes = events.filter((e) => e.type === "tool_result" && (e.data.name === "write_file" || e.data.name === "run_command")).length;

  useEffect(() => {
    let cancelled = false;
    listFiles(sessionId)
      .then((l) => !cancelled && (setListing(l), setMissing(false)))
      .catch(() => !cancelled && (setListing(null), setMissing(true)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, changes]);

  // 日志里读过、但现在已经不在工作区里的文件也要显示：日志才是事实来源
  const paths = useMemo(() => {
    const all = new Set(listing?.files ?? []);
    for (const p of Object.keys(cov.total.files)) all.add(p);
    if (cov.total.injected) all.add(cov.total.injected);
    return [...all].sort();
  }, [listing, cov]);
  const tree = useMemo(() => buildTree(paths, cov), [paths, cov]);
  // 聚焦的目录不在了（工作区变了）就回到根
  let top: Dir | undefined = tree;
  for (const name of focus ? focus.split("/") : []) top = top?.dirs.get(name);
  top ??= tree;
  const rows = useMemo(() => treeRows(top, cov, opened), [top, cov, opened]);

  if (!listing && !missing) return null;

  const crumbs = top.path ? top.path.split("/") : [];
  const maxDepth = Math.max(1, ...rows.map((r) => r.depth));
  const step = Math.max(12, Math.min(20, Math.floor(110 / maxDepth)));
  const x = (r: Row) => 6 + r.depth * step;
  const y = (i: number) => i * ROW + ROW / 2;
  const tone = (r: Row) =>
    r.kind === "dir" ? (r.dir.fresh > 0 ? 2 : r.dir.seen > 0 ? 1 : 0) : r.kind === "file" ? (r.path in cov.current.files ? 2 : r.path in cov.total.files ? 1 : 0) : 0;
  const open = (key: string) => setOpened((s) => new Set(s).add(key));

  return (
    <div className="p-4">
      {runs.length > 0 && (
        <>
          {/* 次数做成圆形数字：选中的实心，有读取的浅底，没读文件的虚线圈 */}
          <div className="flex gap-1 overflow-x-auto">
            {runs.map((r) => {
              const n = perRun[r.index - 1]!;
              const on = r.index === run;
              return (
                <Tooltip key={r.index}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setPicked(r.index === runs.length ? null : r.index)}
                      aria-label={t.coverage.run(r.index)}
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                        on
                          ? "bg-foreground text-background"
                          : n.read
                            ? "bg-accent text-foreground hover:bg-accent/70"
                            : "border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-accent/60",
                      )}
                    >
                      {r.index}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <div className="text-muted-foreground">{t.coverage.run(r.index)}</div>
                    <div>{t.coverage.runTip(n.read, n.first)}</div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <div className="mt-1 mb-3 flex min-w-0 gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">{t.coverage.run(run)}</span>
            <span className="min-w-0 truncate">{runs[run - 1]?.text}</span>
          </div>
        </>
      )}
      <div className="text-sm font-medium">
        {runs.length > 0 && tree.fresh === 0 ? t.coverage.summaryNone(tree.seen, tree.total) : t.coverage.summary(tree.fresh, tree.seen, tree.total)}
      </div>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t.coverage.basis}</p>
      {missing && <p className="mb-3 text-xs text-muted-foreground">{t.coverage.missing}</p>}
      {listing?.truncated && <p className="mb-3 text-xs text-muted-foreground">{t.coverage.truncated(listing.files.length)}</p>}
      {crumbs.length > 0 && (
        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <button className="hover:text-foreground" onClick={() => setFocus("")}>
            {t.coverage.root}
          </button>
          {crumbs.map((name, i) => (
            <Fragment key={i}>
              <span>/</span>
              {i < crumbs.length - 1 ? (
                <button className="hover:text-foreground" onClick={() => setFocus(crumbs.slice(0, i + 1).join("/"))}>
                  {name}
                </button>
              ) : (
                <span className="text-foreground">{name}</span>
              )}
            </Fragment>
          ))}
        </div>
      )}
      <div className="relative">
        <svg className="pointer-events-none absolute inset-0" width="100%" height={rows.length * ROW} aria-hidden>
          {rows.map((r, i) => {
            if (r.parent < 0) return null;
            const p = rows[r.parent]!;
            const s = tone(r);
            return (
              <path
                key={`e${i}`}
                d={`M${x(p)} ${y(r.parent) + 4}V${y(i)}H${x(r) - 4}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={s === 2 ? 1.5 : 1}
                className={s === 2 ? "text-foreground" : s === 1 ? "text-muted-foreground/60" : "text-border"}
              />
            );
          })}
          {rows.map((r, i) => {
            const s = tone(r);
            const cls = s ? TONE[s] : "text-muted-foreground/50";
            const fill = s ? "currentColor" : "none";
            const op = s === 1 ? 0.6 : undefined;
            const dash = r.kind === "folded" || r.kind === "unread" ? "2 1.5" : undefined;
            return r.kind === "dir" || r.kind === "folded" ? (
              <rect key={`n${i}`} x={x(r) - 3.5} y={y(i) - 3.5} width={7} height={7} rx={1.5} fill={fill} fillOpacity={op} stroke="currentColor" strokeDasharray={dash} className={cls} />
            ) : (
              <circle key={`n${i}`} cx={x(r)} cy={y(i)} r={3} fill={fill} fillOpacity={op} stroke="currentColor" strokeDasharray={dash} className={cls} />
            );
          })}
        </svg>
        <ul>
          {rows.map((r, i) => (
            <TreeRow
              key={i}
              row={r}
              indent={x(r) + 10}
              tone={tone(r)}
              cov={cov}
              run={run}
              runsOf={r.kind === "file" ? (byFile[r.path] ?? []).filter((n) => n <= run) : []}
              rootLabel={top === tree ? t.coverage.root : top.name}
              onFocus={setFocus}
              onOpen={open}
            />
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-foreground" />
          {t.coverage.legend.fresh}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          {t.coverage.legend.seen}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full border border-muted-foreground/60" />
          {t.coverage.legend.unseen}
        </span>
        <span>{t.coverage.legend.runs}</span>
      </div>
    </div>
  );
}

function TreeRow({
  row,
  indent,
  tone,
  cov,
  run,
  runsOf,
  rootLabel,
  onFocus,
  onOpen,
}: {
  row: Row;
  indent: number;
  tone: number;
  cov: Cov;
  run: number;
  runsOf: number[];
  rootLabel: string;
  onFocus: (path: string) => void;
  onOpen: (key: string) => void;
}) {
  const { t } = useI18n();
  const base = "flex h-6 w-full min-w-0 items-center gap-2 rounded pr-1 text-left text-sm";
  const name = cn("min-w-0 truncate", TONE[tone], tone === 2 && "font-medium");
  const count = "ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground";

  if (row.kind === "dir") {
    const label = (
      <>
        <span className={cn(name, row.depth === 0 && "text-foreground")}>{row.depth === 0 ? rootLabel : row.label}</span>
        <span className={count}>
          {row.dir.seen}/{row.dir.total}
        </span>
      </>
    );
    return (
      <li>
        {row.depth === 0 ? (
          <div className={base} style={{ paddingLeft: indent }}>
            {label}
          </div>
        ) : (
          <button className={cn(base, "hover:bg-accent/60")} style={{ paddingLeft: indent }} title={row.dir.path} onClick={() => onFocus(row.dir.path)}>
            {label}
          </button>
        )}
      </li>
    );
  }
  if (row.kind === "folded")
    return (
      <li>
        <button className={cn(base, "hover:bg-accent/60")} style={{ paddingLeft: indent }} title={row.dir.path} onClick={() => onOpen(row.dir.path)}>
          <span className={name}>{row.dir.name}/</span>
          <span className={cn(count, "text-muted-foreground/60")}>0/{row.dir.total}</span>
        </button>
      </li>
    );
  if (row.kind === "unread")
    return (
      <li>
        <button className={cn(base, "text-xs hover:bg-accent/60")} style={{ paddingLeft: indent }} onClick={() => onOpen(`${row.dir.path}/`)}>
          <span className="min-w-0 truncate text-muted-foreground/60">{t.coverage.unreadFiles(row.count)}</span>
        </button>
      </li>
    );

  const fresh = cov.current.files[row.path];
  const read = cov.total.files[row.path];
  const injected = row.path === cov.total.injected;
  // 这次读到的文件显示这次读了哪些行，之前读过的显示累计；放在悬停提示里，行内只放次数
  const shown = fresh ?? read;
  const detail = shown ? (shown.full ? t.coverage.full(shown.total) : t.coverage.partial(shown.ranges, shown.total)) : undefined;
  return (
    <li className={base} style={{ paddingLeft: indent }} title={detail ? `${row.path}\n${fresh ? t.coverage.thisRun(detail) : detail}` : row.path}>
      <span className={cn(name, injected && "text-muted-foreground")}>{row.path.split("/").at(-1)}</span>
      <span className="ml-auto flex shrink-0 gap-1.5 pl-2 text-xs tabular-nums">
        {injected && <span className="text-muted-foreground">{t.coverage.injected}</span>}
        {runsOf.length > 3 && <span className="text-muted-foreground">…</span>}
        {runsOf.slice(-3).map((n) => (
          <span key={n} className={n === run ? "font-medium text-foreground" : "text-muted-foreground"}>
            {n}
          </span>
        ))}
      </span>
    </li>
  );
}
