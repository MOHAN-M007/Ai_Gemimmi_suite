(() => {
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  statusBar.innerHTML = '<span class="status-dot"></span><span class="status-text">Ready</span>';
  document.body.appendChild(statusBar);

  const setStatus = (state, text) => {
    const dot = statusBar.querySelector('.status-dot');
    const label = statusBar.querySelector('.status-text');
    label.textContent = text;
    dot.classList.remove('warn', 'error');
    if (state === 'warn') dot.classList.add('warn');
    if (state === 'error') dot.classList.add('error');
    statusBar.classList.add('show');
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => statusBar.classList.remove('show'), 3000);
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const fetchWithRetry = async (url, options, tries = 3) => {
    let lastErr;
    for (let i = 0; i < tries; i += 1) {
      try {
        const res = await fetch(url, options);
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error('waking');
        }
        return res;
      } catch (err) {
        lastErr = err;
        setStatus('warn', 'Waking up server...');
        await sleep(800 * (i + 1));
      }
    }
    throw lastErr;
  };

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
      const panel = btn.closest('.input-panel');
      const fileInput = panel ? panel.querySelector('.file-input') : null;
      const chartSelect = panel ? panel.querySelector('.chart-select') : null;

      const text = input ? input.value.trim() : '';
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      const chartType = chartSelect ? chartSelect.value : '';

      if (!text && !file) {
        return;
      }

      const thread = document.querySelector('.chat-thread');
      if (!thread) return;

      const userBubble = document.createElement('div');
      userBubble.className = 'chat-card user';
      userBubble.innerHTML = '<div class="chat-meta">You</div><p></p>';
      userBubble.querySelector('p').textContent = text || (file ? `Uploaded: ${file.name}` : '');
      thread.appendChild(userBubble);
      userBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

      const assistantBubble = document.createElement('div');
      assistantBubble.className = 'chat-card';
      assistantBubble.innerHTML = '<div class="chat-meta">Assistant</div><p>Thinking…</p>';
      thread.appendChild(assistantBubble);
      assistantBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

      if (input) input.value = '';
      if (fileInput) fileInput.value = '';
      btn.classList.add('is-sent');
      setTimeout(() => btn.classList.remove('is-sent'), 600);

      const botId = resolveBotId();
      if (!botId) {
        assistantBubble.querySelector('p').textContent = 'No bot configured for this page.';
        return;
      }

      try {
        const formData = new FormData();
        if (text) formData.append('text', text);
        if (chartType) formData.append('chartType', chartType);
        if (file) formData.append('file', file);

        const res = await fetchWithRetry(`/api/bot/${botId}`, {
          method: 'POST',
          body: formData
        });

        if (res.status === 401) {
          setStatus('error', 'Session expired. Please login again.');
          window.location.href = '/login.html';
          return;
        }

        const data = await res.json();
        if (!res.ok) {
          assistantBubble.querySelector('p').textContent = data.error || 'Request failed.';
          return;
        }

        assistantBubble.querySelector('p').textContent = data.text || 'No response text returned.';
        if (data.image) {
          const img = document.createElement('img');
          img.src = data.image;
          img.alt = 'Generated output';
          img.className = 'chat-image';
          assistantBubble.appendChild(img);
        }
        setStatus('success', 'Response received');
      } catch (err) {
        assistantBubble.querySelector('p').textContent = 'Server is waking up. Please try again in a moment.';
        setStatus('error', 'Request failed. Try again.');
      }
    });
  });

  const inputsForSend = document.querySelectorAll('.input-row input[type="text"]');
  inputsForSend.forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const panel = input.closest('.input-panel');
        const sendBtn = panel ? panel.querySelector('.send-btn') : null;
        if (sendBtn) sendBtn.click();
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
