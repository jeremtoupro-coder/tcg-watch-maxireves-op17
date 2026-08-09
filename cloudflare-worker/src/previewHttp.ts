/** Erreurs HTTP pouvant être dues à la propagation Cloudflare ou au réseau. */
export function isTransientPreviewStatus(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}
