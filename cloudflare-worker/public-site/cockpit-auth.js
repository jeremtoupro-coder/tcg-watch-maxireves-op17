(() => {
  const ALLOWED_EMAIL = 'jrm.touitou@gmail.com';
  const SESSION_SENTINEL = 'session-cookie-auth';
  const PASSWORD_KEY = 'opwatch-cockpit-password';
  const login = document.getElementById('login');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('loginError');
  const logout = document.getElementById('logout');
  if (!login || !loginForm || !passwordInput || !loginError) return;

  const card = loginForm.closest('.login-card');
  const heading = card?.querySelector('h2');
  const intro = heading?.nextElementSibling;
  if (heading) heading.textContent = 'Connexion';
  if (intro) intro.textContent = 'Accès privé réservé au propriétaire du cockpit.';

  const passwordField = passwordInput.closest('.field');
  const emailField = document.createElement('div');
  emailField.className = 'field';
  emailField.innerHTML = '<label>Adresse e-mail</label><input id="cockpitEmail" type="email" inputmode="email" autocomplete="username" required>';
  passwordField?.before(emailField);
  const emailInput = emailField.querySelector('input');
  if (emailInput) emailInput.value = ALLOWED_EMAIL;
  const passwordLabel = passwordField?.querySelector('label');
  if (passwordLabel) passwordLabel.textContent = 'Mot de passe';

  const submit = loginForm.querySelector('button');
  if (submit) submit.textContent = 'Se connecter';

  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.className = 'btn ghost';
  forgot.style.cssText = 'width:100%;margin-top:10px';
  forgot.textContent = 'Mot de passe oublié ?';
  loginForm.insertBefore(forgot, loginError);

  const help = document.createElement('div');
  help.className = 'detail';
  help.style.cssText = 'margin-top:12px;text-align:center';
  help.textContent = 'Seule l’adresse jrm.touitou@gmail.com est autorisée.';
  loginForm.appendChild(help);

  const resetPanel = document.createElement('form');
  resetPanel.id = 'cockpitResetForm';
  resetPanel.className = 'hidden';
  resetPanel.innerHTML = `
    <div class="field"><label>Nouveau mot de passe</label><input id="newCockpitPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    <div class="field"><label>Confirmer le mot de passe</label><input id="confirmCockpitPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    <button class="btn primary" style="width:100%">Enregistrer le nouveau mot de passe</button>
    <div id="resetError" class="error"></div>
  `;
  card?.appendChild(resetPanel);

  const status = document.createElement('div');
  status.className = 'detail';
  status.style.cssText = 'margin-top:12px;text-align:center';
  loginForm.appendChild(status);

  async function authFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const response = await fetch(path, { ...options, headers, cache: 'no-store', credentials: 'same-origin' });
    const raw = await response.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        const detail = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
        throw new Error(`HTTP ${response.status} — réponse non JSON du service${detail ? ` : ${detail}` : ''}`);
      }
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function setSessionFlag() {
    sessionStorage.setItem(PASSWORD_KEY, SESSION_SENTINEL);
  }

  function clearSessionFlag() {
    sessionStorage.removeItem(PASSWORD_KEY);
  }

  async function openCockpitFromSession() {
    try {
      await authFetch('/cockpit/api/auth/session', { method: 'GET' });
      setSessionFlag();
      if (typeof window.load === 'function') await window.load();
      return true;
    } catch {
      clearSessionFlag();
      return false;
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    loginError.textContent = '';
    status.textContent = '';
    const email = emailInput?.value.trim().toLowerCase() || '';
    const password = passwordInput.value;
    if (email !== ALLOWED_EMAIL) {
      loginError.textContent = 'Cette adresse e-mail n’est pas autorisée.';
      return;
    }
    if (submit) submit.disabled = true;
    try {
      await authFetch('/cockpit/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setSessionFlag();
      passwordInput.value = '';
      if (typeof window.load === 'function') await window.load();
    } catch (error) {
      clearSessionFlag();
      loginError.textContent = error.message || String(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  }, true);

  forgot.addEventListener('click', async () => {
    loginError.textContent = '';
    status.textContent = '';
    const email = emailInput?.value.trim().toLowerCase() || '';
    if (email !== ALLOWED_EMAIL) {
      loginError.textContent = 'Cette adresse e-mail n’est pas autorisée.';
      return;
    }
    forgot.disabled = true;
    forgot.textContent = 'Envoi en cours…';
    try {
      await authFetch('/cockpit/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      status.textContent = 'Si la demande est autorisée, le lien de réinitialisation a été envoyé sur ta boîte Gmail.';
    } catch (error) {
      loginError.textContent = error.message || String(error);
    } finally {
      forgot.disabled = false;
      forgot.textContent = 'Mot de passe oublié ?';
    }
  });

  resetPanel.addEventListener('submit', async event => {
    event.preventDefault();
    const errorBox = document.getElementById('resetError');
    if (errorBox) errorBox.textContent = '';
    const password = document.getElementById('newCockpitPassword')?.value || '';
    const confirm = document.getElementById('confirmCockpitPassword')?.value || '';
    if (password.length < 12) {
      if (errorBox) errorBox.textContent = 'Le mot de passe doit contenir au moins 12 caractères.';
      return;
    }
    if (password !== confirm) {
      if (errorBox) errorBox.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    const token = new URLSearchParams(location.search).get('reset') || '';
    const button = resetPanel.querySelector('button');
    if (button) button.disabled = true;
    try {
      await authFetch('/cockpit/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      history.replaceState({}, '', '/cockpit/');
      resetPanel.classList.add('hidden');
      loginForm.classList.remove('hidden');
      passwordInput.value = '';
      status.textContent = 'Mot de passe modifié. Tu peux maintenant te connecter.';
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || String(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

  logout?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try { await authFetch('/cockpit/api/auth/logout', { method: 'POST' }); } catch {}
    clearSessionFlag();
    location.reload();
  }, true);

  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    if (heading) heading.textContent = 'Nouveau mot de passe';
    if (intro) intro.textContent = 'Choisis un nouveau mot de passe pour le cockpit OP Watch.';
    loginForm.classList.add('hidden');
    resetPanel.classList.remove('hidden');
  } else {
    openCockpitFromSession();
  }
})();
