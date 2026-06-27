import { copyFile } from "node:fs/promises";

process.env.DISCORD_MODE = "dry-run";
delete process.env.DISCORD_WEBHOOK_URL;

await import("./probe-fantasy-sphere");
await copyFile("fantasy-sphere-probe.json", "change-simulation-report.json");
