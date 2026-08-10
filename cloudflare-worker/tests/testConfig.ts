import { aliasesForProduct, buildActiveWatchConfig, type OfficialProduct } from "../src/opwatchV1";

export const TEST_OP17: OfficialProduct = {
  id: "OP-17",
  family: "OP",
  label: "BOOSTER OP-17",
  releaseDate: "2026-08-28",
  aliases: aliasesForProduct("OP-17")
};

export const TEST_WATCH_CONFIG = buildActiveWatchConfig([TEST_OP17]);
