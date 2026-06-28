import { writeFile } from "node:fs/promises";

export async function writeJsonReport(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
