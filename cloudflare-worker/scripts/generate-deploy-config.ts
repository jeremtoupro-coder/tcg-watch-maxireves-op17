import { mkdir, readFile, writeFile } from "node:fs/promises";

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
}

interface KvNamespace {
  id: string;
  title: string;
}

interface WranglerConfig {
  [key: string]: unknown;
  vars?: Record<string, string>;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const namespaceTitle = process.env.CLOUDFLARE_KV_NAMESPACE ?? "tcg-watch-state";

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont obligatoires.");
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces?per_page=100`,
  {
    headers: { Authorization: `Bearer ${apiToken}` }
  }
);

if (!response.ok) {
  throw new Error(`Impossible de lister les namespaces KV: HTTP ${response.status}`);
}

const payload = await response.json() as CloudflareEnvelope<KvNamespace[]>;
if (!payload.success) {
  throw new Error(`Cloudflare refuse la liste KV: ${JSON.stringify(payload.errors ?? [])}`);
}

const matches = payload.result.filter((namespace) => namespace.title === namespaceTitle);
if (matches.length !== 1) {
  throw new Error(
    `Namespace KV '${namespaceTitle}' introuvable ou ambigu (${matches.length} résultat(s)).`
  );
}

const baseConfig = JSON.parse(await readFile("wrangler.jsonc", "utf8")) as WranglerConfig;
const vars = { ...(baseConfig.vars ?? {}) };

vars.MONITORING_ENABLED = process.env.DEPLOY_MONITORING_ENABLED ?? vars.MONITORING_ENABLED ?? "false";
vars.WRITE_STATE = process.env.DEPLOY_WRITE_STATE ?? vars.WRITE_STATE ?? "false";
vars.DISCORD_MODE = process.env.DEPLOY_DISCORD_MODE ?? vars.DISCORD_MODE ?? "dry-run";

const cronExpression = process.env.DEPLOY_CRON?.trim();
const generatedConfig: WranglerConfig = {
  ...baseConfig,
  vars,
  kv_namespaces: [
    {
      binding: "TCG_STATE",
      id: matches[0].id
    }
  ],
  triggers: {
    crons: cronExpression ? [cronExpression] : []
  }
};

await writeFile(
  "wrangler.generated.json",
  `${JSON.stringify(generatedConfig, null, 2)}\n`,
  "utf8"
);

await mkdir(".wrangler/deploy", { recursive: true });
await writeFile(
  ".wrangler/deploy/config.json",
  `${JSON.stringify({ configPath: "../../wrangler.generated.json" }, null, 2)}\n`,
  "utf8"
);

console.log(
  `Configuration générée: KV=${namespaceTitle}, monitoring=${vars.MONITORING_ENABLED}, ` +
  `writeState=${vars.WRITE_STATE}, discord=${vars.DISCORD_MODE}, cron=${cronExpression ?? "désactivé"}`
);
