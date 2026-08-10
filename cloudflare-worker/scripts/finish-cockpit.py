from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def patch(path, old, new, label):
    p=ROOT/path
    t=p.read_text()
    if t.count(old)!=1:
        raise SystemExit(f'{label}: expected 1, got {t.count(old)}')
    p.write_text(t.replace(old,new,1))

# Cockpit API: runtime bearer token for CI/internal checks, never exposed to browser.
patch('src/cockpitApi.ts',
'''    "access-control-allow-headers": "content-type,x-op-watch-admin-password",''',
'''    "access-control-allow-headers": "content-type,x-op-watch-admin-password,authorization",''',
'cors authorization')

patch('src/cockpitApi.ts',
'''async function authorized(request: Request): Promise<boolean> {
  const password = request.headers.get("x-op-watch-admin-password") ?? "";
  if (password.length < 12 || password.length > 200) return false;
  return constantTimeEqual(await sha256(password), ADMIN_PASSWORD_SHA256);
}''',
'''async function authorized(request: Request, env: RuntimeEnv): Promise<boolean> {
  const password = request.headers.get("x-op-watch-admin-password") ?? "";
  if (password.length >= 12 && password.length <= 200 && constantTimeEqual(await sha256(password), ADMIN_PASSWORD_SHA256)) {
    return true;
  }
  const expected = env.PREVIEW_AUDIT_TOKEN?.trim() ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "").trim() ?? "";
  return Boolean(expected && bearer) && constantTimeEqual(bearer, expected);
}''',
'authorized bearer')

patch('src/cockpitApi.ts',
'''  if (!await authorized(request)) return json(request, { error: "Mot de passe cockpit invalide." }, 401);''',
'''  if (!await authorized(request, env)) return json(request, { error: "Accès cockpit invalide." }, 401);''',
'authorized call')

# Keep disabled/manual/override products visible so they can be re-enabled.
patch('src/cockpitApi.ts',
'''  const runtimeLive = env.MONITORING_ENABLED === "true" &&
    env.WRITE_STATE === "true" &&
    env.DISCORD_MODE === "live" &&
    env.SCHEDULER_MODE === "live" &&
    env.RUNTIME_TEST_MODE !== "true" &&
    Boolean(env.STORE_MONITORS && env.CALENDAR_COORDINATOR);

  return {''',
'''  const runtimeLive = env.MONITORING_ENABLED === "true" &&
    env.WRITE_STATE === "true" &&
    env.DISCORD_MODE === "live" &&
    env.SCHEDULER_MODE === "live" &&
    env.RUNTIME_TEST_MODE !== "true" &&
    Boolean(env.STORE_MONITORS && env.CALENDAR_COORDINATOR);

  const activeById = new Map(calendar.activeProducts.map((product) => [product.id, product]));
  const manualById = new Map(control.manualProducts.map((product) => [product.id, product]));
  const controllableIds = [...new Set([
    ...activeById.keys(),
    ...manualById.keys(),
    ...Object.keys(control.productOverrides)
  ])].sort();
  const controllableProducts = controllableIds.map((id) => {
    const active = activeById.get(id);
    const manual = manualById.get(id);
    const override = control.productOverrides[id];
    return {
      id,
      label: active?.label ?? manual?.label ?? `${id} — référence désactivée`,
      releaseDate: active?.releaseDate ?? manual?.releaseDate ?? null,
      aliases: active?.aliases ?? manual?.aliases ?? [id],
      manual: Boolean(manual),
      active: Boolean(active),
      enabled: override?.enabled !== false && manual?.enabled !== false,
      stopAt: override?.stopAt ?? manual?.stopAt ?? null,
      game: manual?.game ?? "one-piece"
    };
  });

  return {''',
'controllable products setup')

patch('src/cockpitApi.ts',
'''      activeProducts: calendar.activeProducts,
      acceptedLanguages: calendar.acceptedLanguages ?? control.languages,''',
'''      activeProducts: calendar.activeProducts,
      controllableProducts,
      acceptedLanguages: calendar.acceptedLanguages ?? control.languages,''',
'controllable products response')

# UI: render all controllable products, delete manual products.
patch('public-site/cockpit/index.html',
'''    function renderProducts(){const overrides=state.control.productOverrides||{};const manualIds=new Set((state.control.manualProducts||[]).map(p=>p.id));$('productList').innerHTML=state.calendar.activeProducts.length?state.calendar.activeProducts.map(p=>{const o=overrides[p.id]||{};const enabled=o.enabled!==false;return `<div class="product"><div><strong>${esc(p.id)} — ${esc(p.label)}</strong><small>Sortie ${esc(p.releaseDate)}${manualIds.has(p.id)?' · manuel':' · calendrier/contrôle'}</small></div><label class="switch"><input type="checkbox" ${enabled?'checked':''} onchange="setProductEnabled('${esc(p.id)}',this.checked)"> Surveillé</label><input class="field date-mini" type="date" value="${esc(o.stopAt||'')}" title="Arrêter la surveillance après cette date" onchange="setProductStop('${esc(p.id)}',this.value)"></div>`}).join(''):'<div class="detail">Aucune référence active.</div>'}''',
'''    function renderProducts(){const products=state.calendar.controllableProducts||state.calendar.activeProducts||[];$('productList').innerHTML=products.length?products.map(p=>{const enabled=p.enabled!==false;const release=p.releaseDate?`Sortie ${esc(p.releaseDate)}`:'Date de sortie non chargée';return `<div class="product"><div><strong>${esc(p.id)} — ${esc(p.label)}</strong><small>${release}${p.manual?' · manuel':' · calendrier/contrôle'}${p.active?' · actif':' · hors circuit'}</small></div><label class="switch"><input type="checkbox" ${enabled?'checked':''} onchange="setProductEnabled('${esc(p.id)}',this.checked)"> Surveillé</label><div class="actions"><input class="field date-mini" type="date" value="${esc(p.stopAt||'')}" title="Arrêter la surveillance après cette date" onchange="setProductStop('${esc(p.id)}',this.value)">${p.manual?`<button class="btn danger" onclick="deleteManual('${esc(p.id)}')">Supprimer</button>`:''}</div></div>`}).join(''):'<div class="detail">Aucune référence configurée.</div>'}''',
'render controllable products')

patch('public-site/cockpit/index.html',
'''    window.setProductStop=(id,stopAt)=>control({action:'setProductOverride',id,stopAt},`Cutoff ${id} mis à jour`);
    window.cancelRequest=id=>control({action:'cancelAssistantRequest',id},'Demande annulée');''',
'''    window.setProductStop=(id,stopAt)=>control({action:'setProductOverride',id,stopAt},`Cutoff ${id} mis à jour`);
    window.deleteManual=id=>{if(confirm(`Supprimer ${id} du circuit ?`))control({action:'deleteManualProduct',id},`${id} supprimé`)};
    window.cancelRequest=id=>control({action:'cancelAssistantRequest',id},'Demande annulée');''',
'delete manual handler')

print('Cockpit finishing patches applied')
