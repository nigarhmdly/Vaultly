# Vaultly

Vaultly is a full-stack personal diary / journal application designed as a portfolio project.

## Main features

- Register and login
- Hashed passwords with bcrypt
- Session authentication
- Private per-user journal entries
- Create, edit and save diary entries
- Select custom entry date
- Mood tracking
- Tags
- Full text search
- Mood filtering
- Sorting
- Favorites
- Pin entries
- Archive entries
- Trash + restore
- Permanent delete
- Empty trash
- Calendar view
- Journal statistics / insights
- Word count
- Profile editing
- Bio
- Password change
- Light / dark mode
- JSON data export
- JSON data import
- Responsive design
- SQLite database
- Helmet security headers

## Tech stack

- Frontend: HTML5, CSS3, Vanilla JavaScript
- Backend: Node.js + Express
- Database: SQLite with better-sqlite3
- Authentication: express-session
- Password hashing: bcryptjs
- Security headers: helmet

## Run locally

Install Node.js first.

Then open the Vaultly folder in terminal and run:

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

The database file `vaultly.db` is created automatically.

## Production note

Set a strong session secret before deployment:

```bash
SESSION_SECRET=your-long-secret npm start
```

If deploying behind HTTPS, update the session cookie in `server.js` to use:

```js
secure: true
```

## Database

### users
- id
- name
- email
- password
- bio
- theme
- created_at

### entries
- id
- user_id
- title
- content
- entry_date
- mood
- tags
- favorite
- pinned
- archived
- deleted
- created_at
- updated_at

Each diary entry is linked to the authenticated account by `user_id`, so users only see their own entries.

## Railway deployment

This project is prepared for Railway.

1. Push the contents of this folder to a GitHub repository.
2. In Railway, create a project from that GitHub repository.
3. Add a Volume to the Vaultly service and mount it at `/data`.
4. Add these Variables in Railway:

```text
NODE_ENV=production
DB_PATH=/data/vaultly.db
SESSION_SECRET=put-a-long-random-secret-here
```

5. Deploy the service. `railway.json` already tells Railway to run `npm start` and use `/api/health` as the health check.
6. Generate a public domain from Railway's Networking/Domain settings.

### Why the Volume matters

Vaultly uses SQLite. The database path is configurable with `DB_PATH`. On Railway it should point to `/data/vaultly.db`, where `/data` is the persistent Volume. This keeps accounts, profile pictures, and diary entries across redeploys.

### Production security

When `NODE_ENV=production`, Vaultly uses secure session cookies and requires `SESSION_SECRET` to be set. Railway sits behind a proxy, so the server is configured to trust the first proxy hop.
