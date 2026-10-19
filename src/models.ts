// 从环境变量解析模型、API Key 和 baseUrl（支持中转站）。
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(deepseekProvider());

export type ProviderName = "anthropic" | "deepseek";

const DEFAULTS: Record<ProviderName, { modelId: string; key: () => string | undefined; baseUrl: () => string | undefined }> = {
  anthropic: {
    modelId: "claude-sonnet-5-5",
    key: () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN, // .env 里留空的值是空字符串，所以用 ||
    baseUrl: () => process.env.ANTHROPIC_BASE_URL,
  },
  deepseek: {
    modelId: "deepseek-v4-pro",
    key: () => process.env.DEEPSEEK_API_KEY,
    baseUrl: () => process.env.DEEPSEEK_BASE_URL,
  },
};

export function resolveModel(provider: ProviderName, modelId?: string): { model: Model<Api>; apiKey: string } {
  const d = DEFAULTS[provider];
  if (!d) throw new Error(`Unknown provider "${provider}". Use anthropic or deepseek.`);
  const found = models.getModel(provider, modelId ?? d.modelId);
  if (!found) throw new Error(`Model not found: ${provider}/${modelId ?? d.modelId}`);
  const apiKey = d.key();
  if (!apiKey) throw new Error(`No API key for ${provider}. See README for the environment variables.`);
  const baseUrl = d.baseUrl();
  return { model: baseUrl ? { ...found, baseUrl } : found, apiKey };
}
