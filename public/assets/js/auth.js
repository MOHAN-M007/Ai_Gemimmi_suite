(() => {
  const loginForm = document.querySelector('[data-login-form]');
  const nicknameForm = document.querySelector('[data-nickname-form]');
  const errorBox = document.querySelector('[data-error]');

  const showError = (msg) => {
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.style.display = 'block';
    }
  };

  const hideError = () => {
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.style.display = 'none';
    }
  };

  const redirectBySession = async () => {
    try {
      const res = await fetch('/api/session');
      const data = await res.json();
      if (!data.authenticated) return;
      if (!data.nickname) {
        if (location.pathname !== '/nickname.html') {
          location.href = '/nickname.html';
        }
        return;
      }
      if (location.pathname === '/login.html' || location.pathname === '/nickname.html') {
        location.href = '/index.html';
      }
    } catch (err) {
      // ignore
    }
  };

  redirectBySession();

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const uid = loginForm.querySelector('[name="uid"]').value.trim();
      const password = loginForm.querySelector('[name="password"]').value.trim();

      if (!uid || !password) {
        showError('UID and password are required.');
        return;
      }

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, password })
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error || 'Login failed.');
          return;
        }
        if (data.needsNickname) {
          location.href = '/nickname.html';
        } else {
          location.href = '/index.html';
        }
      } catch (err) {
        showError('Login failed. Try again.');
      }
    });
  }

  if (nicknameForm) {
    nicknameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();
      const nickname = nicknameForm.querySelector('[name="nickname"]').value.trim();
      if (!nickname) {
        showError('Nickname is required.');
        return;
      }
      try {
        const res = await fetch('/api/nickname', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname })
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error || 'Unable to save nickname.');
          return;
        }
        location.href = '/index.html';
      } catch (err) {
        showError('Unable to save nickname.');
      }
    });
  }
})();
