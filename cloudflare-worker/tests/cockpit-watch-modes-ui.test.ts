import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public-site/cockpit/index.html", import.meta.url), "utf8");
const authScript = readFileSync(new URL("../public-site/cockpit-auth.js", import.meta.url), "utf8");
const pagesWorker = readFileSync(new URL("../public-site/_worker.js", import.meta.url), "utf8");

describe("cockpit deux circuits", () => {
  it("affiche des vues distinctes Nouvelles sorties et One Piece ALL", () => {
    expect(html).toContain('data-tab="products">🆕 Nouvelles sorties');
    expect(html).toContain('data-tab="allwatch">♻️ One Piece ALL');
    expect(html).toContain('id="products" class="view"');
    expect(html).toContain('id="allwatch" class="view"');
    expect(html).toContain("Aucun doublon avec les sorties");
  });

  it("explique la cadence et les limites de couverture ALL", () => {
    expect(html).toContain("Discovery catalogue environ toutes les 15 minutes");
    expect(html).toContain("Fast Watch toutes les minutes");
    expect(html).toContain("il ne double pas les requêtes marchands");
    expect(html).toContain("Une boutique en attente de flux partenaire reste aveugle ici aussi");
  });

  it("garde le JavaScript embarqué syntaxiquement valide", () => {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script as string)).not.toThrow();
  });

  it("n'active qu'une authentification e-mail/cookie sans mot de passe en sessionStorage", () => {
    const combined = `${html}\n${authScript}`;
    expect(combined).not.toContain("opwatch-cockpit-password");
    expect(combined).not.toContain("x-op-watch-admin-password");
    expect(combined).not.toContain("sessionStorage");
    expect(authScript.match(/loginForm\.addEventListener\('submit'/g)).toHaveLength(1);
    expect(authScript).not.toContain("stopImmediatePropagation");
    expect(html).toContain('id="cockpitEmail"');
  });

  it("charge les scripts statiquement sans réécriture HTML fragile dans Pages", () => {
    expect(html).toContain('<script src="/cockpit-auth.js"></script>');
    expect(pagesWorker).not.toContain("html.replace");
    expect(pagesWorker).not.toContain("request.body,");
    expect(pagesWorker).toContain("await request.arrayBuffer()");
  });
});
