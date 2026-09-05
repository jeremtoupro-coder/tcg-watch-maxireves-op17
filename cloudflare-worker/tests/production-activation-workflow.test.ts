import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/watch-maxireves.yml", import.meta.url),
  "utf8"
);

describe("production activation workflow", () => {
  it("requires all five Durable Object bindings in every production phase", () => {
    expect(workflow.match(/b\.length!==5/g)).toHaveLength(3);
    expect(workflow.match(/x=>x\.name==='PROTECTED_STORE_SCOUT'/g)).toHaveLength(3);
    expect(workflow).not.toContain("b.length!==4");
  });

  it("requires Brave for the protected scout and installs it before smoke", () => {
    expect(workflow).toContain("DISCORD_WEBHOOK_URL BRAVE_SEARCH_API_KEY");
    expect(workflow).toContain("npx wrangler secret put BRAVE_SEARCH_API_KEY");
    expect(workflow.indexOf("secret put BRAVE_SEARCH_API_KEY")).toBeLessThan(workflow.indexOf("Smoke standby"));
  });

  it("supports an optional external dead-man without making it a deployment dependency", () => {
    expect(workflow).toContain("secrets.EXTERNAL_DEADMAN_PING_URL");
    expect(workflow).toContain('if [ -n "$EXTERNAL_DEADMAN_PING_URL" ]');
    expect(workflow).toContain("secret put EXTERNAL_DEADMAN_PING_URL");
  });
});
