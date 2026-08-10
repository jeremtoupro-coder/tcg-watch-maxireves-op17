import type { ConnectorDefinition } from "./types";

export function canonicalProductUrl(url: string, connector: ConnectorDefinition): string {
  if (!connector.canonicalizeProductUrl) return url;

  try {
    const canonical = connector.canonicalizeProductUrl(url).trim();
    return canonical || url;
  } catch {
    // Une normalisation défaillante ne doit jamais transformer une source
    // valide en disparition de produit. Le contrôle sémantique reste ensuite
    // appliqué à l'URL d'origine.
    return url;
  }
}
