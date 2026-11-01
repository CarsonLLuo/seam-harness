import { ChevronDown, Cpu } from "lucide-react";
import type { ProviderInfo } from "../api";
import { useI18n } from "../i18n/i18n";
import type { ModelChoice } from "../model-choice";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 输入框工具栏里的模型选择：按供应商分组列出可选模型 */
export function ModelPicker(props: {
  providers: ProviderInfo[];
  value: ModelChoice | null;
  onChange: (choice: ModelChoice) => void;
}) {
  const { t } = useI18n();
  const current = props.value ? `${props.value.provider}/${props.value.model}` : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 text-[13px] font-normal text-muted-foreground" aria-label={t.model} title={current}>
          <Cpu className="!size-3.5" />
          {props.value?.model ?? t.model}
          <ChevronDown className="!size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => {
            const [provider, ...rest] = v.split("/");
            props.onChange({ provider: provider!, model: rest.join("/") });
          }}
        >
          {props.providers.map((p, i) => (
            <div key={p.name}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{p.name}</DropdownMenuLabel>
              {p.models.map((m) => (
                <DropdownMenuRadioItem key={m} value={`${p.name}/${m}`} className="font-mono text-xs">
                  {m}
                </DropdownMenuRadioItem>
              ))}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
