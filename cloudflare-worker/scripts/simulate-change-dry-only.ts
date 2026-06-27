process.env.DISCORD_MODE = "dry-run";
delete process.env.DISCORD_WEBHOOK_URL;

await import("./simulate-cloudflare-change.ts");
