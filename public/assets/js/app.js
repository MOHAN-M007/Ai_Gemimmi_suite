(() => {
  const inputs = document.querySelectorAll('.input-row input');
  inputs.forEach((input) => {
    input.addEventListener('focus', () => input.parentElement.classList.add('is-focus'));
    input.addEventListener('blur', () => input.parentElement.classList.remove('is-focus'));
  });

  const resolveBotId = () => {
    const fromBody = document.body.dataset.bot;
    if (fromBody) return fromBody;
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const map = {
      'image-generation.html': 'image',
      'report-generation.html': 'report',
      'paper-analysis.html': 'paper',
      'data-analytics.html': 'data'
    };
    return map[page] || null;
  };

  const sendButtons = document.querySelectorAll('.send-btn');
  sendButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.input-row');
      const input = row ? row.querySelector('input') : null;
      if (!input || !input.value.trim()) {
        return;
      }

      const thread = document.querySelector('.chat-thread');
      if (!thread) return;

      const text = input.value.trim();
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-card user';
      userBubble.innerHTML = '<div class="chat-meta">You</div><p></p>';
      userBubble.querySelector('p').textContent = text;
      thread.appendChild(userBubble);
      userBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

      const assistantBubble = document.createElement('div');
      assistantBubble.className = 'chat-card';
      assistantBubble.innerHTML = '<div class="chat-meta">Assistant</div><p>Thinking…</p>';
      thread.appendChild(assistantBubble);
      assistantBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

      input.value = '';
      btn.classList.add('is-sent');
      setTimeout(() => btn.classList.remove('is-sent'), 600);

      const botId = resolveBotId();
      if (!botId) {
        assistantBubble.querySelector('p').textContent = 'No bot configured for this page.';
        return;
      }

      try {
        const res = await fetch(`/api/bot/${botId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });

        if (res.status === 401) {
          window.location.href = '/login.html';
          return;
        }

        const data = await res.json();
        if (!res.ok) {
          assistantBubble.querySelector('p').textContent = data.error || 'Request failed.';
          return;
        }

        assistantBubble.querySelector('p').textContent = data.text || 'No response text returned.';
      } catch (err) {
        assistantBubble.querySelector('p').textContent = 'Request failed. Try again.';
      }
    });
  });

  const navLinks = document.querySelectorAll('.nav-links a');
  const current = window.location.pathname.split('/').pop() || 'index.html';
  navLinks.forEach((link) => {
    const target = link.getAttribute('href');
    if (target === current) {
      link.classList.add('active');
    }
  });
})();
