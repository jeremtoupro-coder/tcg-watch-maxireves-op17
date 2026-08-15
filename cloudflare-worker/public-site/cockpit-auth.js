(() => {
  const ALLOWED_EMAIL = 'jrm.touitou@gmail.com';
  const login = document.getElementById('login');
  const loginForm = document.getElementById('loginForm');
  const emailInput = document.getElementById('cockpitEmail');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('loginError');
  const status = document.getElementById('authStatus');
  const forgot = document.getElementById('forgotPassword');
  const logout = document.getElementById('logout');
  const resetPanel = document.getElementById('cockpitResetForm');
  if (!login || !loginForm || !emailInput || !passwordInput || !loginError || !resetPanel) return;

  async function authFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
    const response = await fetch(path, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin'
    });
    const raw = await response.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${response.status} — réponse non JSON du service`);
      }
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function displayLogin(message = '') {
    if (typeof window.showLogin === 'function') window.showLogin(message);
    else login.classList.remove('hidden');
  }

  async function openCockpitFromSession() {
    try {
      await authFetch('/cockpit/api/auth/session', { method: 'GET' });
      if (typeof window.load === 'function') await window.load();
      return true;
    } catch {
      displayLogin();
      return false;
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginError.textContent = '';
    if (status) status.textContent = '';
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (email !== ALLOWED_EMAIL) {
      loginError.textContent = 'Cette adresse e-mail n’est pas autorisée.';
      return;
    }
    const submit = loginForm.querySelector('button[type="submit"],button:not([type])');
    if (submit) submit.disabled = true;
    try {
      await authFetch('/cockpit/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      passwordInput.value = '';
      if (typeof window.load === 'function') await window.load();
    } catch (error) {
      displayLogin();
      loginError.textContent = error.message || String(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  forgot?.addEventListener('click', async () => {
    loginError.textContent = '';
    if (status) status.textContent = '';
    const email = emailInput.value.trim().toLowerCase();
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
      if (status) status.textContent = 'Si la demande est autorisée, le lien de réinitialisation a été envoyé sur ta boîte Gmail.';
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
      if (status) status.textContent = 'Mot de passe modifié. Tu peux maintenant te connecter.';
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || String(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

  logout?.addEventListener('click', async event => {
    event.preventDefault();
    try {
      await authFetch('/cockpit/api/auth/logout', { method: 'POST' });
    } catch {
      // Le cookie local est supprimé par le serveur quand il est joignable.
    }
    displayLogin();
  });

  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    loginForm.classList.add('hidden');
    resetPanel.classList.remove('hidden');
  } else {
    openCockpitFromSession();
  }
})();
