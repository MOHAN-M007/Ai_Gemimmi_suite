const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const mime = require('mime-types');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
const usersPath = path.join(dataDir, 'users.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/uploads', express.static(uploadDir));

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      return cb(new Error('Audio/video files are not supported.'));
    }
    cb(null, true);
  }
});

const r2Enabled = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
const r2Client = r2Enabled ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
}) : null;

function truncateText(text, limit = 12000) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[Truncated ${text.length - limit} chars]`;
}

async function uploadToR2(file) {
  if (!r2Client) return null;
  const key = `uploads/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${file.originalname}`;
  const contentType = file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream';
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: fs.createReadStream(file.path),
    ContentType: contentType
  }));
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }
  return null;
}

async function extractFromFile(file) {
  if (!file) return { text: '', inlineImage: null };
  const buffer = fs.readFileSync(file.path);
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimeType = file.mimetype || mime.lookup(file.originalname) || '';

  if (mimeType.startsWith('image/')) {
    return {
      text: '',
      inlineImage: {
        mimeType,
        data: buffer.toString('base64')
      }
    };
  }

  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    return { text: truncateText(data.text || ''), inlineImage: null };
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: truncateText(result.value || ''), inlineImage: null };
  }
  if (ext === '.csv') {
    const records = parse(buffer, { columns: true, skip_empty_lines: true });
    const preview = JSON.stringify(records.slice(0, 30), null, 2);
    return { text: truncateText(`CSV preview (first rows):\n${preview}`), inlineImage: null };
  }
  if (ext === '.xlsx') {
    const wb = xlsx.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = xlsx.utils.sheet_to_csv(sheet);
    return { text: truncateText(`XLSX preview (CSV):\n${csv}`), inlineImage: null };
  }

  const fallback = buffer.toString('utf8');
  return { text: truncateText(fallback), inlineImage: null };
}

function buildSystemPrompt(botId, chartType) {
  if (botId === 'image') {
    return 'You are an image generation assistant. Return a concise caption plus the generated image.';
  }
  if (botId === 'report') {
    return 'You are a report generation assistant. Return a structured report with title, executive summary, sections, key findings, and conclusion.';
  }
  if (botId === 'paper') {
    return 'You are an academic paper analysis assistant. Return objective, methods, key results, limitations, and future work.';
  }
  if (botId === 'data') {
    const chartInstruction = chartType ? `Include output for a ${chartType} chart.` : 'Include a recommended chart type.';
    return `You are a data analytics assistant. Provide dataset overview, descriptive stats, patterns, and insights. ${chartInstruction}`;
  }
  return 'You are an assistant.';
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

app.post('/api/bot/:botId', upload.single('file'), async (req, res) => {
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
    const userText = (req.body && req.body.text) ? String(req.body.text) : '';
    const chartType = (req.body && req.body.chartType) ? String(req.body.chartType) : '';
    const file = req.file || null;
    const extracted = await extractFromFile(file);
    const fileUrl = file ? await uploadToR2(file) : null;
    const systemPrompt = buildSystemPrompt(botId, chartType);

    const parts = [];
    if (userText) {
      parts.push({ text: userText });
    }
    if (extracted.text) {
      parts.push({ text: `\n\n[File Content]\n${extracted.text}` });
    }
    if (extracted.inlineImage) {
      parts.push({
        inline_data: {
          mime_type: extracted.inlineImage.mimeType,
          data: extracted.inlineImage.data
        }
      });
    }
    if (parts.length === 0) {
      parts.push({ text: 'No input provided.' });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemPrompt }]
        },
        generationConfig: botId === 'image' ? { responseModalities: ['TEXT', 'IMAGE'] } : {},
        contents: [
          {
            role: 'user',
            parts
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Bot request failed', details: data });
    }
    const partsOut = data?.candidates?.[0]?.content?.parts || [];
    const textParts = partsOut.filter(p => typeof p.text === 'string').map(p => p.text);
    const text = textParts.join('\n\n').trim();
    const imagePart = partsOut.find(p => p.inlineData || p.inline_data);
    const inline = imagePart ? (imagePart.inlineData || imagePart.inline_data) : null;
    const image = inline && inline.data ? `data:${inline.mimeType || inline.mime_type};base64,${inline.data}` : null;
    if (file && fs.existsSync(file.path)) {
      fs.unlink(file.path, () => {});
    }
    res.json({ text, image, fileUrl, raw: data });
  } catch (err) {
    res.status(500).json({ error: 'Bot request failed' });
  }
});

app.use((err, req, res, next) => {
  if (err) {
    const message = err.message || 'Upload failed';
    return res.status(400).json({ error: message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
