import { derivePreviewAuditToken } from "../src/previewCredentials";

process.stdout.write(derivePreviewAuditToken(process.env.CLOUDFLARE_API_TOKEN ?? ""));
