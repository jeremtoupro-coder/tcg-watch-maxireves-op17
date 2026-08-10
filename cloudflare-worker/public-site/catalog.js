(() => {
  const input = document.getElementById('productRef');
  if (!input) return;

  const style = document.createElement('style');
  style.textContent = '.official-picks{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.official-pick{border:1px solid #343945;background:#12161d;color:#e6e9ee;border-radius:999px;padding:7px 10px;font:inherit;font-size:.82rem;cursor:pointer}.official-pick:hover{border-color:#6b5730;background:#181b22}.official-meta{font-size:.78rem;color:#8d949f;margin-top:9px}';
  document.head.appendChild(style);

  const datalist = document.createElement('datalist');
  datalist.id = 'officialProducts';
  document.body.appendChild(datalist);
  input.setAttribute('list', datalist.id);
  input.placeholder = 'Choisir une sortie officielle ou saisir OP-17…';

  const group = input.closest('.formGroup');
  const picks = document.createElement('div');
  picks.className = 'official-picks';
  const meta = document.createElement('div');
  meta.className = 'official-meta';
  meta.textContent = 'Chargement des sorties officielles surveillées…';
  group?.append(picks, meta);

  function prettyDate(value) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(value || '')) return '';
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(`${value}T12:00:00Z`));
  }

  fetch('/api/calendar', { headers: { Accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('calendar unavailable');
      return response.json();
    })
    .then(data => {
      const products = Array.isArray(data.activeProducts) ? data.activeProducts : [];
      datalist.innerHTML = products.map(product => {
        const label = String(product.label || product.id || '').replace(/"/g, '&quot;');
        return `<option value="${product.id}" label="${label} · ${prettyDate(product.releaseDate)}"></option>`;
      }).join('');
      picks.innerHTML = products.slice(0, 10).map(product =>
        `<button type="button" class="official-pick" data-ref="${product.id}">${product.id}${product.releaseDate ? ` · ${prettyDate(product.releaseDate)}` : ''}</button>`
      ).join('');
      picks.querySelectorAll('[data-ref]').forEach(button => button.addEventListener('click', () => {
        input.value = button.dataset.ref;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }));
      meta.textContent = products.length
        ? `${products.length} sortie${products.length > 1 ? 's' : ''} officielle${products.length > 1 ? 's' : ''} actuellement dans la fenêtre de surveillance OP Watch.`
        : 'Aucune sortie active n’a été renvoyée par le calendrier officiel pour le moment.';
    })
    .catch(() => {
      meta.textContent = 'Le calendrier officiel est temporairement indisponible. Tu peux quand même saisir une référence manuellement.';
    });
})();
