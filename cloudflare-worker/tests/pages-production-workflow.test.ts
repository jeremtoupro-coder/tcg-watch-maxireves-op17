import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/op-watch-public-site.yml", import.meta.url),
  "utf8"
);

describe("Pages production workflow", () => {
  it("aligns the Direct Upload production branch with main before deploying", () => {
    const alignment = workflow.indexOf('"production_branch":"main"');
    const deployment = workflow.indexOf("npx wrangler pages deploy public-site");

    expect(alignment).toBeGreaterThan(-1);
    expect(deployment).toBeGreaterThan(alignment);
    expect(workflow).toContain("pages/projects/${PAGES_PROJECT}");
    expect(workflow).toContain("p.result?.production_branch!=='main'");
    expect(workflow).toContain("--branch=main");
    expect(workflow).not.toContain("--branch=op-watch-v1-test");
  });

  it("smokes the primary Pages domain and rejects anonymous cockpit access", () => {
    expect(workflow).toContain('url="https://${PAGES_PROJECT}.pages.dev/"');
    expect(workflow).toContain('"${url}cockpit/api/status"');
    expect(workflow).toContain('[ "$anon" = "401" ]');
    expect(workflow).toContain("x-op-watch-admin-password");
    expect(workflow).toContain("sessionStorage");
  });
});
