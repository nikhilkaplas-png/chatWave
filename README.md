# ChatWave

Real-time group chat in the browser: rooms, live messages, optional location and voice clips, typing indicators, and a **Claude (Anthropic)** AI companion that answers from the server only (API keys stay off the client).

## Stack

- **Node.js** — HTTP server, static files, Socket.IO
- **Express** — serves `public/`
- **Socket.IO 2.x** — WebSockets for chat events
- **Anthropic SDK** — AI companion (`src/companion/ClaudeCompanion.js`)

## Features

- Join a room with a display name (`public/index.html` → `chat.html`)
- Text messages broadcast to everyone in the room
- “Someone is typing…” for other participants
- Share geolocation (map link + preview)
- Short audio messages (recorded in-browser, sent as data URL)
- **Ask AI** — prompt + optional streaming (`aiChunk` / final message to the room); uses recent room text as context on the server
- In-memory user list and per-room message history for the companion (not persisted across restarts)

## Requirements

- **Node.js** 14+ (use 18+ if you hit tooling warnings)
- An **Anthropic API key** if you want the AI companion

## Quick start

```bash
git clone <your-repo-url>
cd chatApp
npm install
```

1. Copy **`.env.example`** to **`.env`** in the project root (same folder as `package.json`).
2. Set **`ANTHROPIC_API_KEY`** in `.env` (see [Environment variables](#environment-variables)).
3. Start the server:

```bash
npm start
```

For local development with auto-restart:

```bash
npm run dev
```

4. Open **http://localhost:3001** (or the port shown in the terminal; use `PORT` in `.env` to change the default **3001**).

5. Enter a display name and room on the join form, then chat. Open the same room in another browser or tab to test multi-user behavior.

### API key without `.env` (optional)

Copy `src/config.local.example.js` to **`src/config.local.js`**, set `ANTHROPIC_API_KEY` there, and keep that file out of git (it is listed in `.gitignore`). `.env` and `config.local.js` are both supported; `.env` is usually simpler.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For AI companion | Anthropic secret key (`sk-ant-…`). Never commit it. |
| `CLAUDE_MODEL` | No | Default: `claude-haiku-4-5`. Override e.g. `claude-sonnet-4-6`. |
| `PORT` | No | HTTP port. Default **3001**. On **Render**, `PORT` is set for you. |

The app loads **`.env`** from the project root automatically (`dotenv` in `src/index.js`).

## Deploying (e.g. Render)

1. Connect the GitHub repo and create a **Web Service**.
2. **Build command:** `npm install` (or leave default if install runs automatically).
3. **Start command:** `npm start`
4. In **Environment**, add **`ANTHROPIC_API_KEY`** and any optional variables above. Do not commit secrets to the repository; GitHub push protection will block known secret patterns.
5. The server listens on **`process.env.PORT`** when set, so Render’s assigned port works without code changes.

Point the browser at your Render URL; Socket.IO uses the same host as the page.

## Project layout

```
├── public/           # Static UI (HTML, CSS, JS)
│   ├── index.html    # Join form → chat.html?username=&room=
│   ├── chat.html     # Main chat UI
│   └── js/chat.js    # Socket.IO client
├── src/
│   ├── index.js      # Express + Socket.IO server
│   ├── companion/    # Claude integration
│   └── utils/        # users, room history for AI context
├── .env.example      # Template for local `.env`
└── package.json
```

## Security notes

- Do not hardcode API keys in tracked files.
- Chat usernames in payloads are overridden with the server-known user for normal messages where applicable; treat any client-sent metadata as untrusted for future features.
- For production, prefer **HTTPS/WSS** (TLS in front of Node), rate limits, and persistence if you need audit logs or multi-instance scaling.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run `node src/index.js` |
| `npm run dev` | Run with `nodemon` for file watching |

## License

ISC (see `package.json`).
