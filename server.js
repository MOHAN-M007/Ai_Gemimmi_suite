const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const usersPath = path.join(dataDir, 'users.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(session({
  name: 'suite.sid',
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/assets', express.static(path.join(publicDir, 'assets')));

function readUsers() {
  if (!fs.existsSync(usersPath)) {
    return { users: [] };
  }
  const raw = fs.readFileSync(usersPath, 'utf8');
  try {
    return JSON.parse(raw || '{"users":[]}');
  } catch (err) {
    console.error('Invalid users.json. Resetting to empty list.');
    return { users: [] };
  }
}

function writeUsers(data) {
  fs.writeFileSync(usersPath, JSON.stringify(data, null, 2));
}

function requireAuth(req, res, next) {
  if (!req.session.uid) {
    return res.redirect('/login.html');
  }
  if (!req.session.nickname && req.path !== '/nickname.html') {
    return res.redirect('/nickname.html');
  }
  next();
}

app.get('/', (req, res) => {
  if (!req.session.uid) {
    return res.redirect('/login.html');
  }
  if (!req.session.nickname) {
    return res.redirect('/nickname.html');
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get(['/*.html'], (req, res, next) => {
  const file = req.path.replace('/', '');
  if (file === 'login.html') {
    return res.sendFile(path.join(publicDir, 'login.html'));
  }
  if (file === 'nickname.html') {
    if (!req.session.uid) {
      return res.redirect('/login.html');
    }
    if (req.session.nickname) {
      return res.redirect('/index.html');
    }
    return res.sendFile(path.join(publicDir, 'nickname.html'));
  }
  requireAuth(req, res, () => {
    res.sendFile(path.join(publicDir, file));
  });
});

app.post('/api/login', (req, res) => {
  const { uid, password } = req.body;
  if (!uid || !password) {
    return res.status(400).json({ error: 'UID and password required' });
  }

  const data = readUsers();
  const user = data.users.find(u => u.uid === uid && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.uid = user.uid;
  req.session.nickname = user.nickname || '';

  res.json({
    ok: true,
    needsNickname: !user.nickname
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('suite.sid');
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!req.session.uid,
    uid: req.session.uid || null,
    nickname: req.session.nickname || null
  });
});

app.post('/api/nickname', (req, res) => {
  if (!req.session.uid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const nickname = (req.body.nickname || '').trim();
  if (!nickname) {
    return res.status(400).json({ error: 'Nickname required' });
  }

  const data = readUsers();
  const user = data.users.find(u => u.uid === req.session.uid);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.nickname = nickname;
  writeUsers(data);
  req.session.nickname = nickname;
  res.json({ ok: true, nickname });
});

app.post('/api/bot/:botId', async (req, res) => {
  if (!req.session.uid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const botId = req.params.botId;
  const model = process.env[`BOT_${botId.toUpperCase()}_MODEL`];
  const key = process.env[`BOT_${botId.toUpperCase()}_KEY`];

  if (!model || !key) {
    return res.status(501).json({ error: 'Bot API not configured' });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: (req.body && req.body.text) ? String(req.body.text) : '' }]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Bot request failed', details: data });
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ text, raw: data });
  } catch (err) {
    res.status(500).json({ error: 'Bot request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
