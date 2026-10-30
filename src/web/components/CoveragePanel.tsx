import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SeamEvent } from "../../events";
import { coverageAtRun, listRuns, type ReadCoverage } from "../../insight";
import { listFiles } from "../api";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** total：截至所选这次运行的累计覆盖；current：这次运行里读到的部分 */
interface Cov {
  total: ReadCoverage;
  current: ReadCoverage;
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: string[];
  /** 子树里的文件数 / 用 read_file 读过的文件数（注入的 SEAM.md 不算读过） */
  total: number;
  seen: number;
  /** 这次运行读到的文件数 */
  fresh: number;
}

function buildTree(paths: string[], cov: Cov): Dir {
  const root: Dir = { name: "", dirs: new Map(), files: [], total: 0, seen: 0, fresh: 0 };
  for (const path of paths) {
    const parts = path.split("/");
    const seen = path in cov.total.files;
    const fresh = path in cov.current.files;
    let dir = root;
    for (const d of [root, ...parts.slice(0, -1)]) {
      if (typeof d === "string") {
        let next = dir.dirs.get(d);
        if (!next) dir.dirs.set(d, (next = { name: d, dirs: new Map(), files: [], total: 0, seen: 0, fresh: 0 }));
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

/**
 * 阅读覆盖：工作区文件树里点亮 agent 用 read_file 读过的文件；状态只来自日志。
 * 按次查看：显示截至所选这次的累计覆盖，这次读到的文件单独高亮
 */
export function CoveragePanel({ sessionId, events }: { sessionId: string; events: SeamEvent[] }) {
  const { t } = useI18n();
  const runs = useMemo(() => listRuns(events), [events]);
  // null 表示跟着最新一次走；回放退到更早的步骤时，选中的次数不能超过已有的次数
  const [picked, setPicked] = useState<number | null>(null);
  const run = Math.min(picked ?? runs.length, runs.length);
  const cov = useMemo(() => coverageAtRun(events, run), [events, run]);
  const [listing, setListing] = useState<{ files: string[]; truncated: boolean } | null>(null);
  const [missing, setMissing] = useState(false);
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

  if (!listing && !missing) return null;

  return (
    <div className="p-4">
      {runs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 mb-1 h-7 max-w-full gap-1.5 px-2 text-xs text-muted-foreground">
              <span className="shrink-0">{t.coverage.run(run)}</span>
              <span className="min-w-0 truncate font-normal">{runs[run - 1]?.text}</span>
              <ChevronDown className="!size-3 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 max-w-80 overflow-y-auto">
            <DropdownMenuRadioGroup value={String(run)} onValueChange={(v) => setPicked(Number(v) === runs.length ? null : Number(v))}>
              {runs.map((r) => (
                <DropdownMenuRadioItem key={r.index} value={String(r.index)} className="text-xs">
                  <span className="shrink-0 text-muted-foreground">{t.coverage.run(r.index)}</span>
                  <span className="min-w-0 truncate">{r.text}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="text-sm font-medium">{t.coverage.summary(tree.fresh, tree.seen, tree.total)}</div>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t.coverage.basis}</p>
      {missing && <p className="mb-3 text-xs text-muted-foreground">{t.coverage.missing}</p>}
      {listing?.truncated && <p className="mb-3 text-xs text-muted-foreground">{t.coverage.truncated(listing.files.length)}</p>}
      {/* 切换次数时重新挂载，让目录按这一次重新决定是否展开 */}
      <DirContents key={run} dir={tree} cov={cov} depth={0} />
    </div>
  );
}

function DirContents({ dir, cov, depth }: { dir: Dir; cov: Cov; depth: number }) {
  return (
    <ul>
      {[...dir.dirs.values()].map((d) => (
        <DirRow key={d.name} dir={d} cov={cov} depth={depth} />
      ))}
      {dir.files.map((p) => (
        <FileRow key={p} path={p} cov={cov} depth={depth} />
      ))}
    </ul>
  );
}

function DirRow({ dir, cov, depth }: { dir: Dir; cov: Cov; depth: number }) {
  // 含有这次读过文件的目录默认展开；这次一个都没读时，展开累计读过的目录
  const [open, setOpen] = useState(Object.keys(cov.current.files).length > 0 ? dir.fresh > 0 : dir.seen > 0);
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded py-0.5 text-left text-sm hover:bg-accent/60"
        style={{ paddingLeft: depth * 12 }}
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span
          className={cn(
            "min-w-0 truncate",
            dir.fresh > 0 ? "font-medium text-foreground" : dir.seen > 0 ? "text-muted-foreground" : "text-muted-foreground/60",
          )}
        >
          {dir.name}
        </span>
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          {dir.seen}/{dir.total}
        </span>
      </button>
      {open && <DirContents dir={dir} cov={cov} depth={depth + 1} />}
    </li>
  );
}

function FileRow({ path, cov, depth }: { path: string; cov: Cov; depth: number }) {
  const { t } = useI18n();
  const fresh = cov.current.files[path];
  const read = cov.total.files[path];
  const injected = path === cov.total.injected;
  // 这次读到的文件显示这次读了哪些行，之前读过的显示累计
  const shown = fresh ?? read;
  const detail = shown ? (shown.full ? t.coverage.full(shown.total) : t.coverage.partial(shown.ranges, shown.total)) : undefined;
  return (
    <li className="flex min-w-0 items-center gap-2 py-0.5 text-sm" style={{ paddingLeft: depth * 12 + 18 }} title={path}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fresh ? "bg-foreground" : "bg-transparent")} />
      <span
        className={cn(
          "min-w-0 truncate",
          fresh ? "font-medium text-foreground" : read || injected ? "text-muted-foreground" : "text-muted-foreground/60",
        )}
      >
        {path.split("/").at(-1)}
      </span>
      <span className={cn("ml-auto flex shrink-0 gap-2 text-xs", fresh ? "text-foreground" : "text-muted-foreground")}>
        {injected && <span>{t.coverage.injected}</span>}
        {detail && <span>{fresh ? t.coverage.thisRun(detail) : detail}</span>}
      </span>
    </li>
  );
}
