// 启动 Seam 的本地 Web 界面：bun src/server/main.ts
//   SEAM_PORT   端口，默认 4321
//   SEAM_TOKEN  固定令牌（默认每次启动随机生成）
import { randomBytes } from "node:crypto";
import app from "../web/index.html";
import { loadProjectEnv } from "../env";
import { defaultModelId, listModels, resolveModel, type ProviderName } from "../models";
import { defaultLogDir } from "../session";
import { pickFolderWithOsascript } from "./folder-picker";
import { createServer } from "./server";

loadProjectEnv();

const PROVIDERS: ProviderName[] = ["anthropic", "deepseek"];

const token = process.env.SEAM_TOKEN ?? randomBytes(24).toString("hex");

const server = createServer({
  port: Number(process.env.SEAM_PORT ?? 4321),
  token,
  logDir: defaultLogDir(),
  defaultWorkspace: process.cwd(),
  resolveModel,
  availableProviders: () =>
    PROVIDERS.filter((p) => {
      try {
        resolveModel(p);
        return true;
      } catch {
        return false;
      }
    }).map((name) => ({ name, models: listModels(name), defaultModel: defaultModelId(name) })),
  pickFolder: process.platform === "darwin" ? pickFolderWithOsascript : undefined,
  app,
  development: process.env.NODE_ENV !== "production",
});

console.log(`Seam is running. Open this link (it contains your access token):\n  http://127.0.0.1:${server.port}/?token=${token}`);
