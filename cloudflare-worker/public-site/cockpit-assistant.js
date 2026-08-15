(() => {
  const form = document.getElementById('assistantForm');
  if (!form) return;

  const textArea = document.getElementById('assistantText');
  const requests = document.getElementById('requests');
  const button = form.querySelector('button[type="submit"],button');
  const card = form.closest('.card');
  const heading = card?.querySelector('h3');
  const detail = card?.querySelector('.detail');
  const notice = card?.querySelector('.notice');

  const style = document.createElement('style');
  style.textContent = `
    .assistant-status{display:flex;align-items:center;gap:8px;margin:12px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#091827;font-size:12px;color:var(--muted)}
    .assistant-answer{margin-top:10px;padding:12px;border-radius:12px;background:#0d2136;border:1px solid #294563;white-space:pre-wrap;font-size:13px;line-height:1.55;color:#eaf1fa}
    .assistant-error{margin-top:10px;padding:10px 12px;border-radius:10px;background:#361b24;color:#ffadb4;font-size:12px;white-space:pre-wrap}
    .assistant-sources{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.assistant-sources a{color:#a9d3ff;text-decoration:none;border:1px solid #315170;border-radius:999px;padding:5px 8px;font-size:11px;background:#0a192a}.assistant-meta{margin-top:8px;color:#7188a5;font-size:10px}
  `;
  document.head.appendChild(style);

  if (heading) heading.textContent = 'Assistant ChatGPT';
  if (detail) detail.textContent = "Discute directement avec l'assistant OpenAI depuis le cockpit. Il reçoit l'état réel d'OP Watch et peut faire des recherches web quand nécessaire.";
  if (notice) notice.textContent = "Mode sécurisé : ChatGPT peut analyser, diagnostiquer et proposer des changements, mais il ne possède aucun accès d'écriture à GitHub, Cloudflare, Discord ou à la production. Une modification de prod devra toujours passer par une validation explicite.";
  if (textArea) textArea.placeholder = "Ex : pourquoi Micromania est encore orange ? Vérifie aussi si une route publique propre existe aujourd'hui.";
  if (button) button.textContent = 'Envoyer à ChatGPT';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const assistantState = () => typeof state !== 'undefined' ? state?.assistant : null;

  function sourcesHtml(row) {
    const list = Array.isArray(row.sources) ? row.sources : [];
    if (!list.length) return '';
    return `<div class="assistant-sources">${list.map(source => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || 'Source')}</a>`).join('')}</div>`;
  }

  function assistantRequestsHtml() {
    const assistant = assistantState();
    const configured = Boolean(assistant?.configured);
    const status = `<div class="assistant-status"><span class="dot ${configured ? 'green' : 'amber'}"></span><b>${configured ? 'API OpenAI connectée' : 'Clé OpenAI à configurer'}</b>${assistant?.model ? ` · ${escapeHtml(assistant.model)}` : ''} · recherche web ${assistant?.webSearch ? 'ON' : 'OFF'} · écriture prod ${assistant?.writeAccess ? 'ON' : 'OFF'}</div>`;
    const rows = [...(state?.control?.assistantRequests || [])].reverse();
    if (!rows.length) return status + '<div class="detail" style="margin-top:12px">Aucune conversation pour le moment.</div>';
    return status + rows.map(row => {
      const when = new Date(row.createdAt).toLocaleString('fr-FR');
      const label = row.status === 'done' ? 'répondu' : row.status === 'error' ? 'erreur' : row.status;
      const answer = row.answer ? `<div class="assistant-answer">${escapeHtml(row.answer)}</div>` : '';
      const error = row.error ? `<div class="assistant-error">${escapeHtml(row.error)}</div>` : '';
      const usage = row.usage?.totalTokens ? ` · ${escapeHtml(row.usage.totalTokens)} tokens` : '';
      const model = row.model ? ` · ${escapeHtml(row.model)}` : '';
      return `<div class="request"><small>${escapeHtml(when)} · ${escapeHtml(label)}</small><p><b>Toi :</b> ${escapeHtml(row.text)}</p>${answer}${error}${sourcesHtml(row)}${row.status === 'pending' ? `<div class="actions"><button class="btn ghost" onclick="cancelRequest('${escapeHtml(row.id)}')">Annuler</button></div>` : ''}<div class="assistant-meta">${model}${usage}</div></div>`;
    }).join('');
  }

  // `render()` du cockpit appelle cette fonction globale. On remplace donc
  // uniquement le rendu de l'onglet Assistant, sans toucher aux autres vues.
  renderRequests = () => {
    if (requests && typeof state !== 'undefined' && state) requests.innerHTML = assistantRequestsHtml();
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = textArea?.value.trim() || '';
    if (!text) return;
    if (!assistantState()?.configured) {
      toast('OPENAI_API_KEY doit d’abord être configurée');
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'ChatGPT réfléchit…';
    }
    try {
      await api('/cockpit/api/assistant', {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      if (textArea) textArea.value = '';
      toast('Réponse ChatGPT reçue');
      await load();
    } catch (error) {
      toast(error.message || String(error));
      await load().catch(() => {});
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Envoyer à ChatGPT';
      }
    }
  });

  if (typeof state !== 'undefined' && state) renderRequests();
})();
