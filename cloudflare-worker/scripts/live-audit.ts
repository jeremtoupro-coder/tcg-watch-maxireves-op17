import { writeFile } from "node:fs/promises";
import { auditConnector } from "../src/audit";
import { fantasySphere } from "../src/connectors/fantasySphere";
import { maxireves } from "../src/connectors/maxireves";
import { oupi } from "../src/connectors/oupi";
import { pixelheart } from "../src/connectors/pixelheart";
import { evaluateCandidates } from "../src/engine";

const connectors = [maxireves, oupi, pixelheart, fantasySphere];
const stores = [];

for (const connector of connectors) {
  console.log(`\n=== ${connector.name} ===`);
  const result = await auditConnector(connector);
  stores.push(result);

  for (const source of result.sources) {
    const status = source.error ? `ERREUR: ${source.error}` : `HTTP ${source.status}`;
    console.log(
      `${status} | ${source.responseBytes ?? 0} octets | ${source.durationMs} ms | ` +
      `${source.productLinksSeen} liens produit | ${source.candidates.length} cible(s)`
    );
  }

  for (const candidate of result.candidates) {
    console.log(
      `- ${candidate.matchedReferences.join(", ")} | ${candidate.availability} | ` +
      `${candidate.language} | ${candidate.priceText ?? "prix inconnu"} | ${candidate.title}`
    );
    console.log(`  ${candidate.url}`);
  }
}

const candidates = stores.flatMap((store) => store.candidates);
const evaluation = await evaluateCandidates(candidates, {
  AUDIT_MODE: "true",
  WRITE_STATE: "false",
  DISCORD_MODE: "dry-run"
});

console.log("\n=== Évaluation des alertes ===");
console.log(`Candidats uniques : ${evaluation.uniqueCandidates}`);
console.log(`Événements détectés : ${evaluation.changes.length}`);
console.log(`Alertes correspondantes : ${evaluation.alertMatches.length}`);
console.log(`Messages Discord envoyés : ${evaluation.discordDispatch.sent}`);

const report = {
  mode: "ONE_SHOT_LIVE_EVALUATION",
  checkedAt: new Date().toISOString(),
  requestCount: connectors.reduce((total, connector) => total + connector.sources.length, 0),
  stores,
  evaluation
};

await writeFile("audit-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log("\nRapport écrit dans cloudflare-worker/audit-report.json");

const unreachableStores = stores
  .filter((store) => store.sources.length === 0 || store.sources.every((source) => Boolean(source.error)))
  .map((store) => store.storeName);

if (unreachableStores.length > 0) {
  throw new Error(`Boutique(s) pilote totalement inaccessible(s): ${unreachableStores.join(", ")}`);
}
