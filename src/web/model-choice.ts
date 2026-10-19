// 新会话默认用哪个模型：记住上次的选择。
import type { ProviderInfo } from "./api";

export interface ModelChoice {
  provider: string;
  model: string;
}

const STORAGE_KEY = "seam.model";

/** 上次选的模型；如果它已经不可用（比如去掉了 Key），就用第一个供应商的默认模型 */
export function initialModelChoice(providers: ProviderInfo[], saved: string | null): ModelChoice | null {
  if (saved) {
    const [provider, ...rest] = saved.split("/");
    const model = rest.join("/");
    if (providers.some((p) => p.name === provider && p.models.includes(model))) return { provider: provider!, model };
  }
  const first = providers[0];
  return first ? { provider: first.name, model: first.defaultModel } : null;
}

export const loadModelChoice = () => localStorage.getItem(STORAGE_KEY);
export const saveModelChoice = (c: ModelChoice) => localStorage.setItem(STORAGE_KEY, `${c.provider}/${c.model}`);
