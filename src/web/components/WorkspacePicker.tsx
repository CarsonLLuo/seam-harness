import { ChevronDown, FolderOpen, FolderSearch, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { listWorkspaces, pickFolder } from "../api";
import { useI18n } from "../i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** 输入框工具栏里的工作区选择：最近用过的文件夹、系统对话框选择、手动输入路径 */
export function WorkspacePicker(props: {
  value: string;
  onChange: (path: string) => void;
  canPickFolder: boolean;
  onError: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const [recent, setRecent] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    listWorkspaces().then(setRecent).catch(() => undefined);
  }, []);

  const choose = async () => {
    setPicking(true);
    try {
      const path = await pickFolder({ lang, current: props.value });
      if (path) props.onChange(path);
    } catch (err) {
      props.onError(`${t.errors.pickFolder} ${(err as Error).message}`);
    } finally {
      setPicking(false);
    }
  };

  if (editing) {
    return (
      <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-accent/50 px-2 text-xs text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        <input
          autoFocus
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          aria-label={t.workspace}
          className="h-7 min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none"
        />
      </label>
    );
  }

  const options = recent.includes(props.value) ? recent : [props.value, ...recent];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={t.workspace}
          title={props.value}
          disabled={picking}
        >
          <FolderOpen className="!size-3.5" />
          <span className="truncate">{basename(props.value)}</span>
          <ChevronDown className="!size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-md">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t.recentWorkspaces}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={props.value} onValueChange={props.onChange}>
          {options.map((path) => (
            <DropdownMenuRadioItem key={path} value={path} title={path}>
              <div className="min-w-0">
                <div className="truncate">{basename(path)}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {props.canPickFolder && (
          <DropdownMenuItem onSelect={() => void choose()}>
            <FolderSearch />
            {t.chooseFolder}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setEditing(true)}>
          <PenLine />
          {t.typePath}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
