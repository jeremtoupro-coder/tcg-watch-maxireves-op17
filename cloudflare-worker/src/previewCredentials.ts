import { createHmac } from "node:crypto";

const PREVIEW_AUDIT_CONTEXT = "op-watch-safe-preview-audit-v1";

/**
 * Produit un identifiant réservé à l'audit Preview sans réutiliser ni exposer
 * le jeton Cloudflare qui sert au déploiement.
 */
export function derivePreviewAuditToken(cloudflareApiToken: string): string {
  const key = cloudflareApiToken.trim();
  if (key.length < 20) {
    throw new Error("CLOUDFLARE_API_TOKEN est absent ou trop court pour dériver le jeton Preview.");
  }
  return createHmac("sha256", key).update(PREVIEW_AUDIT_CONTEXT).digest("hex");
}
