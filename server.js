const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vaultly.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  bio TEXT DEFAULT '',
  theme TEXT DEFAULT 'light',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`).run();

try { db.prepare("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''").run(); } catch (_) {}

db.prepare(`
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  mood TEXT DEFAULT '😊',
  tags TEXT DEFAULT '[]',
  favorite INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`).run();

if (IS_PRODUCTION) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || (IS_PRODUCTION ? (() => { throw new Error('SESSION_SECRET is required in production'); })() : 'vaultly-development-secret-change-me'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ message: 'Please sign in.' });
  next();
}
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 10);
}
function getUser(id) {
  return db.prepare('SELECT id,name,email,theme,avatar,created_at FROM users WHERE id=?').get(id);
}
function ownedEntry(id, userId) {
  return db.prepare('SELECT * FROM entries WHERE id=? AND user_id=?').get(id, userId);
}

app.post('/api/register', async (req, res) => {
  try {
    let { name, email, password } = req.body;
    name = String(name || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');

    if (name.length < 2) return res.status(400).json({ message: 'Name is too short.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
      return res.status(409).json({ message: 'Email is already registered.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name,email,hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.status(201).json({ user: getUser(req.session.userId) });
  } catch {
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    req.session.userId = user.id;
    res.json({ user: getUser(user.id) });
  } catch {
    res.status(500).json({ message: 'Server error.' });
  }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', auth, (req, res) => res.json({ user: getUser(req.session.userId) }));

app.put('/api/profile', auth, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const avatar = String(req.body.avatar || '').trim();
  if (avatar && (!avatar.startsWith('data:image/') || avatar.length > 900000)) return res.status(400).json({ message: 'Invalid or too large profile image.' });
  const theme = ['light','dark'].includes(req.body.theme) ? req.body.theme : 'light';
  if (name.length < 2) return res.status(400).json({ message: 'Name is too short.' });
  db.prepare('UPDATE users SET name=?, theme=?, avatar=? WHERE id=?').run(name,theme,avatar,req.session.userId);
  res.json({ user: getUser(req.session.userId) });
});

app.put('/api/password', auth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  const { currentPassword, newPassword } = req.body;
  if (!(await bcrypt.compare(String(currentPassword||''), user.password))) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  if (String(newPassword||'').length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  const hash = await bcrypt.hash(String(newPassword), 12);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  res.json({ message: 'Password updated.' });
});

app.get('/api/entries', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM entries WHERE user_id=?
    ORDER BY pinned DESC, entry_date DESC, updated_at DESC
  `).all(req.session.userId);
  res.json(rows.map(r => ({...r, tags: JSON.parse(r.tags || '[]')})));
});

app.post('/api/entries', auth, (req, res) => {
  const { title, content, entry_date, mood } = req.body;
  const tags = cleanTags(req.body.tags);
  if (!String(title||'').trim() || !String(content||'').trim() || !entry_date) {
    return res.status(400).json({ message: 'Title, date and content are required.' });
  }
  const result = db.prepare(`
    INSERT INTO entries(user_id,title,content,entry_date,mood,tags)
    VALUES(?,?,?,?,?,?)
  `).run(req.session.userId, String(title).trim(), String(content).trim(), entry_date, mood || '😊', JSON.stringify(tags));
  const row = ownedEntry(Number(result.lastInsertRowid), req.session.userId);
  res.status(201).json({...row, tags: JSON.parse(row.tags || '[]')});
});

app.put('/api/entries/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (!ownedEntry(id, req.session.userId)) return res.status(404).json({ message: 'Entry not found.' });
  const { title, content, entry_date, mood } = req.body;
  const tags = cleanTags(req.body.tags);
  if (!String(title||'').trim() || !String(content||'').trim() || !entry_date) {
    return res.status(400).json({ message: 'Title, date and content are required.' });
  }
  db.prepare(`
    UPDATE entries SET title=?,content=?,entry_date=?,mood=?,tags=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND user_id=?
  `).run(String(title).trim(), String(content).trim(), entry_date, mood || '😊', JSON.stringify(tags), id, req.session.userId);
  const row = ownedEntry(id, req.session.userId);
  res.json({...row, tags: JSON.parse(row.tags || '[]')});
});

app.patch('/api/entries/:id/state', auth, (req, res) => {
  const id = Number(req.params.id);
  const row = ownedEntry(id, req.session.userId);
  if (!row) return res.status(404).json({ message: 'Entry not found.' });
  const allowed = ['favorite','pinned','archived','deleted'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (typeof req.body[key] === 'boolean') {
      updates.push(`${key}=?`);
      values.push(req.body[key] ? 1 : 0);
    }
  }
  if (!updates.length) return res.status(400).json({ message: 'No state changes supplied.' });
  values.push(id, req.session.userId);
  db.prepare(`UPDATE entries SET ${updates.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(...values);
  res.json({ ok: true });
});

app.delete('/api/entries/:id', auth, (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE id=? AND user_id=?').run(Number(req.params.id), req.session.userId);
  if (!info.changes) return res.status(404).json({ message: 'Entry not found.' });
  res.json({ ok: true });
});

app.post('/api/trash/empty', auth, (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE user_id=? AND deleted=1').run(req.session.userId);
  res.json({ deleted: info.changes });
});

app.get('/api/stats', auth, (req, res) => {
  const userId = req.session.userId;
  const total = db.prepare('SELECT COUNT(*) n FROM entries WHERE user_id=? AND deleted=0').get(userId).n;
  const favorites = db.prepare('SELECT COUNT(*) n FROM entries WHERE user_id=? AND favorite=1 AND deleted=0').get(userId).n;
  const archived = db.prepare('SELECT COUNT(*) n FROM entries WHERE user_id=? AND archived=1 AND deleted=0').get(userId).n;
  const wordsRow = db.prepare('SELECT content FROM entries WHERE user_id=? AND deleted=0').all(userId);
  const words = wordsRow.reduce((n,r)=>n + String(r.content).trim().split(/\s+/).filter(Boolean).length, 0);
  const moodRows = db.prepare('SELECT mood, COUNT(*) n FROM entries WHERE user_id=? AND deleted=0 GROUP BY mood ORDER BY n DESC').all(userId);
  const monthRows = db.prepare(`
    SELECT substr(entry_date,1,7) month, COUNT(*) n
    FROM entries WHERE user_id=? AND deleted=0
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(userId);
  res.json({ total, favorites, archived, words, moods: moodRows, months: monthRows });
});

app.get('/api/export', auth, (req, res) => {
  const user = getUser(req.session.userId);
  const entries = db.prepare('SELECT * FROM entries WHERE user_id=? ORDER BY entry_date').all(req.session.userId)
    .map(r => ({...r, tags: JSON.parse(r.tags || '[]')}));
  res.setHeader('Content-Disposition', 'attachment; filename="vaultly-export.json"');
  res.json({ exportedAt: new Date().toISOString(), user: {name:user.name,email:user.email}, entries });
});

app.post('/api/import', auth, (req, res) => {
  if (!Array.isArray(req.body.entries)) return res.status(400).json({ message: 'Invalid import file.' });
  const insert = db.prepare(`
    INSERT INTO entries(user_id,title,content,entry_date,mood,tags,favorite,pinned,archived,deleted)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `);
  const tx = db.transaction((entries) => {
    let count = 0;
    for (const e of entries.slice(0,1000)) {
      if (!e.title || !e.content || !e.entry_date) continue;
      insert.run(req.session.userId, String(e.title).slice(0,200), String(e.content), e.entry_date,
        e.mood || '😊', JSON.stringify(cleanTags(e.tags)), e.favorite?1:0, e.pinned?1:0, e.archived?1:0, e.deleted?1:0);
      count++;
    }
    return count;
  });
  res.json({ imported: tx(req.body.entries) });
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Vaultly' }));

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vaultly is running on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
