import { copyFile } from "node:fs/promises";

await import("./audit-fantasy-direct");
await copyFile("fantasy-direct-audit.json", "fantasy-sphere-probe.json");
