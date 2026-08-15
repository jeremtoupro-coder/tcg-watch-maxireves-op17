(() => {
  const tabs = document.querySelector('.tabs');
  const settings = document.getElementById('settings');
  if (!tabs || !settings || document.getElementById('webscout')) return;

  const style = document.createElement('style');
  style.textContent = `
    .scout-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px}
    .scout-metric{padding:14px;border:1px solid var(--line);border-radius:14px;background:#091827}.scout-metric strong{display:block;font-size:23px}.scout-metric span{display:block;margin-top:3px;color:var(--muted);font-size:11px;font-weight:750}
    .scout-status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.scout-status h4{margin:0}.scout-query{margin-top:9px;padding:10px 12px;background:#071525;border:1px solid #294260;border-radius:11px;color:#c8d7e9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;overflow-wrap:anywhere}
    .scout-refs{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.scout-ref{padding:5px 8px;border-radius:999px;background:#0a2239;border:1px solid #2d4a68;color:#cde1f5;font-size:11px;font-weight:800}
    .scout-error{margin-top:10px;padding:10px 12px;border-radius:10px;background:#361b24;color:#ffadb4;font-size:12px}
    @media(max-width:850px){.scout-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.tab = 'webscout';
  tab.textContent = '🔭 Web Scout';
  const settingsTab = [...tabs.querySelectorAll('.tab')].find(item => item.dataset.tab === 'settings');
  tabs.insertBefore(tab, settingsTab || null);

  const view = document.createElement('section');
  view.id = 'webscout';
  view.className = 'view';
  view.innerHTML = `
    <div class="section-head"><div><h3>🔭 Web Scout</h3><p>Recherche Web indépendante pour découvrir des boutiques fiables qui ne sont pas encore dans les 24 connecteurs.</p></div><button id="refreshWebScout" class="btn">Actualiser l'état</button></div>
    <div class="card">
      <div class="scout-status"><div><div class="mode-kicker">Circuit 3 · découverte Web</div><h4 id="scoutHeadline">Chargement…</h4></div><span id="scoutPill" class="status gray"><span class="dot gray"></span>—</span></div>
      <p id="scoutSummary" class="detail" style="margin-bottom:0">Lecture du dernier passage Web Scout.</p>
      <div class="scout-grid">
        <div class="scout-metric"><strong id="scoutResults">—</strong><span>résultats Brave</span></div>
        <div class="scout-metric"><strong id="scoutCandidates">—</strong><span>candidats exploitables</span></div>
        <div class="scout-metric"><strong id="scoutVerified">—</strong><span>candidats vérifiés</span></div>
        <div class="scout-metric"><strong id="scoutAlerts">—</strong><span>pistes remontées</span></div>
        <div class="scout-metric"><strong id="scoutRejected">—</strong><span>résultats rejetés</span></div>
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3 style="margin-top:0">Cadence & couverture</h3>
        <div id="scoutCadence" class="detail">—</div>
        <div id="scoutRefs" class="scout-refs"></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Filtre de confiance</h3>
        <p class="detail">Un nouveau domaine n'est remonté que s'il présente HTTPS, une offre One Piece pertinente, des éléments légaux exploitables, une adresse physique française et une ancienneté de domaine suffisante. Facebook/Instagram ne sont acceptés que lorsqu'une publication peut être rattachée à un magasin déjà qualifié ou à un site qui passe ces contrôles.</p>
        <div class="notice">Le Web Scout ne branche jamais automatiquement une nouvelle boutique au Fast Watch. Il remonte une piste fiable sur Discord pour validation.</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Dernière recherche</h3>
      <div id="scoutLastRun" class="detail">Aucun passage enregistré pour le moment.</div>
      <div id="scoutQuery" class="scout-query hidden"></div>
      <div id="scoutReasons" class="detail" style="margin-top:10px"></div>
      <div id="scoutError" class="scout-error hidden"></div>
    </div>
  `;
  settings.parentNode.insertBefore(view, settings);

  const activateTab = () => {
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
    document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === 'webscout'));
  };
  tab.addEventListener('click', activateTab);

  const fmtDate = value => value ? new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'jamais';
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value ?? '—'); };
  let scoutState = null;
  let loading = false;

  function classifyScout(data) {
    if (!data?.bindingPresent) return { level: 'red', label: 'Binding absent', headline: 'Web Scout non déployé' };
    if (!data?.searchConfigured) return { level: 'amber', label: 'Clé Brave absente', headline: 'Web Scout en attente de configuration' };
    if (!data?.schedulerConfigured) return { level: 'amber', label: 'Scheduler OFF', headline: 'Web Scout prêt mais non planifié' };
    if (!data?.schedulerObserved?.observedRecently) return { level: 'red', label: 'Scheduler inactif', headline: 'Web Scout bloqué par le scheduler' };
    if (!data?.health) return { level: 'amber', label: 'Premier passage attendu', headline: 'Web Scout actif' };
    if (data.cadence?.overdue) return { level: 'red', label: 'Passage en retard', headline: 'Web Scout ne tourne plus à sa cadence' };
    if (data.health.status === 'completed') return { level: 'green', label: 'Opérationnel', headline: 'Web Scout opérationnel' };
    if (data.health.status === 'degraded') return { level: 'amber', label: 'Dégradé', headline: 'Web Scout fonctionne en mode dégradé' };
    if (data.health.status === 'disabled') return { level: 'amber', label: 'Désactivé', headline: 'Web Scout désactivé sur ce passage' };
    return { level: 'red', label: 'Erreur', headline: 'Web Scout en incident' };
  }

  function renderScout() {
    const data = scoutState;
    if (!data) return;
    const health = data.health;
    const status = classifyScout(data);
    const pill = document.getElementById('scoutPill');
    if (pill) {
      pill.className = `status ${status.level}`;
      pill.innerHTML = `<span class="dot ${status.level}"></span>${esc(status.label)}`;
    }
    setText('scoutHeadline', status.headline);
    const next = data.cadence?.nextScheduledAt ? fmtDate(data.cadence.nextScheduledAt) : '—';
    setText('scoutSummary', `${data.searchConfigured ? 'Brave Search connecté' : 'Brave Search non configuré'} · ${data.cadence?.label || 'cadence inconnue'} · prochain passage ${next}.`);
    setText('scoutResults', health?.searchResults ?? 0);
    setText('scoutCandidates', health?.candidates ?? 0);
    setText('scoutVerified', health?.verified ?? 0);
    setText('scoutAlerts', health?.alerted ?? 0);
    setText('scoutRejected', health?.rejected ?? 0);
    setText('scoutCadence', `Cadence : ${data.cadence?.label || '—'}. Brave : ${data.searchConfigured ? 'connecté' : 'non configuré'}. Scheduler configuré : ${data.schedulerConfigured ? 'LIVE' : 'OFF'}. Scheduler observé : ${data.schedulerObserved?.observedRecently ? 'OUI' : 'NON'}. Dernier passage : ${fmtDate(health?.checkedAt)}.${health ? ` Cache ignoré : ${health.skippedCached ?? 0}. Budget mensuel : ${health.monthlySearchRequests ?? '—'} / ${health.monthlySearchRequestCap ?? 744}.` : ''}`);

    const refs = document.getElementById('scoutRefs');
    if (refs) {
      const active = Array.isArray(health?.activeReferences) ? health.activeReferences : [];
      refs.innerHTML = active.length ? active.map(ref => `<span class="scout-ref">${esc(ref)}</span>`).join('') : '<span class="detail">Références du premier passage pas encore enregistrées.</span>';
    }

    const lastRun = document.getElementById('scoutLastRun');
    if (lastRun) lastRun.textContent = health ? `Statut ${health.status} le ${fmtDate(health.checkedAt)} · ${health.searchResults ?? 0} résultat(s) · ${health.verified ?? 0} vérifié(s) · ${health.alerted ?? 0} piste(s) remontée(s).` : 'Aucun passage Web Scout enregistré pour le moment.';
    const query = document.getElementById('scoutQuery');
    if (query) {
      query.textContent = health?.query || '';
      query.classList.toggle('hidden', !health?.query);
    }
    const reasons = document.getElementById('scoutReasons');
    if (reasons) {
      const rows = Object.entries(health?.rejectionReasons || {});
      reasons.innerHTML = rows.length
        ? `<b>Pourquoi les candidats ont été rejetés :</b><br>${rows.map(([reason,count])=>`${esc(count)} × ${esc(reason)}`).join('<br>')}`
        : 'Aucune raison de rejet détaillée enregistrée sur le dernier passage.';
    }
    const error = document.getElementById('scoutError');
    const errorText = health?.error || data.healthError || '';
    if (error) {
      error.textContent = errorText;
      error.classList.toggle('hidden', !errorText);
    }
  }

  async function refreshScout() {
    if (loading || typeof api !== 'function') return;
    loading = true;
    try {
      scoutState = await api('/cockpit/api/web-scout');
      renderScout();
    } catch (error) {
      scoutState = null;
      const errorBox = document.getElementById('scoutError');
      if (errorBox) {
        errorBox.textContent = error.message || String(error);
        errorBox.classList.remove('hidden');
      }
    } finally {
      loading = false;
    }
  }

  document.getElementById('refreshWebScout')?.addEventListener('click', () => refreshScout());

  window.addEventListener('opwatch:rendered', () => {
    if (typeof state !== 'undefined' && state) void refreshScout();
  });

  if (typeof state !== 'undefined' && state) void refreshScout();
})();
