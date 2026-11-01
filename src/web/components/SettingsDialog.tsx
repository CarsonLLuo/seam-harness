import * as Dialog from "@radix-ui/react-dialog";
import { Cpu, FolderOpen, Info, Settings2, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import { en } from "../i18n/messages.en";
import { zh } from "../i18n/messages.zh";
import type { ThemePref } from "../theme";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

type SectionId = "general" | "models" | "workspace" | "permissions" | "about";

/** 设置分区。以后加设置：要么在这里加一个分区，要么在已有分区里加一行 Row */
const SECTIONS: { id: SectionId; icon: LucideIcon }[] = [
  { id: "general", icon: Settings2 },
  { id: "models", icon: Cpu },
  { id: "workspace", icon: FolderOpen },
  { id: "permissions", icon: ShieldCheck },
  { id: "about", icon: Info },
];

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-3 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
            o.value === value && "bg-background text-foreground shadow-xs",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemePref;
  onThemeChange: (pref: ThemePref) => void;
}) {
  const { t, lang, toggle } = useI18n();
  const [section, setSection] = useState<SectionId>("general");
  const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

  const content: Record<SectionId, ReactNode> = {
    general: (
      <>
        <Row label={t.theme.label}>
          <Segmented
            value={props.theme}
            onChange={props.onThemeChange}
            options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: t.theme[v] }))}
          />
        </Row>
        <Row label={t.settings.language}>
          <Segmented
            value={lang}
            onChange={(v) => v !== lang && toggle()}
            options={[
              { value: "zh", label: zh.languageName },
              { value: "en", label: en.languageName },
            ]}
          />
        </Row>
      </>
    ),
    models: <Row label={t.settings.comingSoon} hint={t.settings.planned.models} />,
    workspace: <Row label={t.settings.comingSoon} hint={t.settings.planned.workspace} />,
    permissions: <Row label={t.settings.comingSoon} hint={t.settings.planned.permissions} />,
    about: (
      <Row
        label={t.settings.shortcuts}
        hint={
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <kbd className="font-mono">{mod}B</kbd>
            <span>{t.settings.shortcutSidebar}</span>
            <kbd className="font-mono">{mod},</kbd>
            <span>{t.settings.shortcutSettings}</span>
          </div>
        }
      />
    ),
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (open) setSection("general");
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[min(520px,calc(100vh-48px))] w-[min(720px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-background shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <nav className="w-48 shrink-0 bg-sidebar-surface px-2 py-3">
            <Dialog.Title className="px-2.5 pt-1.5 pb-3.5 text-[15px] font-semibold">{t.settings.title}</Dialog.Title>
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex h-8.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
                  section === id && "bg-accent text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.settings.sections[id]}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-13 shrink-0 items-center pr-3 pl-6">
              <h3 className="flex-1 text-[15px] font-medium">{t.settings.sections[section]}</h3>
              <Dialog.Close asChild>
                <IconButton label={t.raw.close}>
                  <X />
                </IconButton>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">{t.settings.title}</Dialog.Description>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{content[section]}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
