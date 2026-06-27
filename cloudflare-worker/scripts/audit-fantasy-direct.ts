import { writeFile } from "node:fs/promises";
import { auditConnector } from "../src/audit";
import { fantasySphere } from "../src/connectors/fantasySphere";

const audit = await auditConnector(fantasySphere);
const failures = audit.sources.filter((source) => source.error);

const report = {
  mode: "READ_ONLY_FANTASY_DIRECT_AUDIT",
  checkedAt: new Date().toISOString(),
  sourceCount: audit.sources.length,
  failedSources: failures.length,
  candidateCount: audit.candidates.length,
  audit
};

await writeFile(
  "fantasy-direct-audit.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

console.log(`Sources contrôlées: ${audit.sources.length}`);
console.log(`Sources en erreur: ${failures.length}`);
console.log(`Fiches détectées: ${audit.candidates.length}`);

for (const candidate of audit.candidates) {
  console.log(
    `${candidate.matchedReferences.join(",")} | ${candidate.availability} | ` +
    `${candidate.language} | ${candidate.priceText ?? "prix inconnu"} | ${candidate.title}`
  );
}

if (failures.length > 0) {
  process.exitCode = 1;
}
