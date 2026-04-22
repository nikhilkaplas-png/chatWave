const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let localCfg = {};
try {
    localCfg = require('./config.local');
} catch (_) {}

const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || localCfg.ANTHROPIC_API_KEY || '').trim();

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const COMPANION_DISPLAY_NAME = 'ChatWave AI';
const COMPANION_COOLDOWN_MS = 4000;

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users');
const { appendMessage: appendRoomMessage, getHistory: getRoomHistory } = require('./utils/roomHistory');
const { ClaudeCompanion } = require('./companion/ClaudeCompanion');
const authRouter = require('./routes/auth');

const companion = new ClaudeCompanion({
    apiKey: ANTHROPIC_API_KEY,
    model: CLAUDE_MODEL,
});
const AI_DISPLAY_NAME = COMPANION_DISPLAY_NAME.trim();
const companionAskCooldownMs = Number(COMPANION_COOLDOWN_MS) || 4000;
const lastCompanionAsk = new Map();

const PORT = Number(process.env.PORT) || 3001;
const publicDirectoryPath = path.join(__dirname, '../public');

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production-chatwave',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
    },
});

app.use(cookieParser());
app.use(express.json());
app.use(sessionMiddleware);

app.use('/api', authRouter);

app.get('/health', (req, res) => {
    res.status(200).type('text/plain').send('ok');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDirectoryPath, 'home.html'));
});

app.get('/join', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    res.sendFile(path.join(publicDirectoryPath, 'join.html'));
});

app.use(express.static(publicDirectoryPath, { index: false }));

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
    console.log('New websocket connection');

    socket.on('join', ({ room }, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};
        const sess = socket.request.session;
        if (!sess || !sess.userId || !sess.username) {
            return done('Not signed in. Open the app in the browser and log in first.');
        }
        const username = String(sess.username).trim();
        const roomName = String(room || '').trim().toLowerCase();
        if (!roomName) {
            return done('Room is required');
        }
        const { error, user } = addUser({ id: socket.id, username, room: roomName });
        if (error) return done(error);
        socket.join(user.room);
        socket.emit('personChatMessage', { text: 'Welcome to the chat', username: user.username });
        socket.broadcast.to(user.room).emit('personChatMessage', { text: `joined the chat`, username: user.username });
        io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) });
        done();
    });

    socket.on('typing', ({ isTyping }) => {
        const user = getUser(socket.id);
        if (!user) return;
        socket.broadcast.to(user.room).emit('userTyping', {
            username: user.username,
            isTyping: Boolean(isTyping),
        });
    });

    socket.on('sendMessage', (eventData, callback) => {
        const user = getUser(socket.id);
        if (!user) return callback('User not found');
        const text = String(eventData.text ?? '').slice(0, 4000);
        const payload = { text, username: user.username, room: user.room };
        appendRoomMessage(user.room, { username: user.username, text });
        io.to(user.room).emit('personChatMessage', payload);
        callback();
    });

    socket.on('askCompanion', async ({ prompt, stream }, callback) => {
        const done = typeof callback === 'function' ? callback : () => {};
        const user = getUser(socket.id);
        if (!user) return done('User not found');
        if (!companion.isConfigured()) {
            return done(
                'AI companion is not configured. Set ANTHROPIC_API_KEY in `.env` or `src/config.local.js`.'
            );
        }
        const trimmed = String(prompt ?? '').trim().slice(0, 4000);
        if (!trimmed) return done('Prompt is required');

        const now = Date.now();
        const last = lastCompanionAsk.get(socket.id) || 0;
        if (now - last < companionAskCooldownMs) {
            return done('Please wait a moment before asking again.');
        }
        lastCompanionAsk.set(socket.id, now);

        const requestId = crypto.randomUUID();
        const messages = companion.buildMessages(getRoomHistory(user.room), trimmed);

        try {
            let reply = '';
            if (stream) {
                reply = await companion.streamCompletion(messages, (chunk) => {
                    socket.emit('aiChunk', { requestId, chunk });
                });
            } else {
                reply = await companion.complete(messages);
            }
            if (!reply) reply = '(No response)';

            appendRoomMessage(user.room, { username: user.username, text: trimmed });
            appendRoomMessage(user.room, { username: AI_DISPLAY_NAME, text: reply });
            io.to(user.room).emit('personChatMessage', {
                text: reply,
                username: AI_DISPLAY_NAME,
                isAi: true,
                companionRequestId: stream ? requestId : null,
            });
            if (stream) socket.emit('aiDone', { requestId });
            done();
        } catch (err) {
            console.error('askCompanion', err);
            const msg = err.message || 'Companion request failed';
            socket.emit('companionError', { message: msg });
            done(msg);
        }
    });

    socket.on('sendLocation', (latitude, longitude) => {
        const user = getUser(socket.id);
        if (!user) return;
        io.to(user.room).emit('personChatMessage', {
            text: '',
            username: user.username,
            isLocation: true,
            url: `https://google.com/maps?q=${latitude},${longitude}`,
            latitude: latitude,
            longitude: longitude,
        });
    });

    socket.on('sendAudio', (eventData) => {
        const user = getUser(socket.id);
        if (!user) return;
        io.to(user.room).emit('personChatMessage', {
            text: '',
            username: user.username,
            isAudio: true,
            audioData: eventData.audioData,
        });
    });

    socket.on('disconnect', () => {
        const user = removeUser(socket.id);
        if (user) {
            io.to(user.room).emit('userTyping', { username: user.username, isTyping: false });
            io.to(user.room).emit('personChatMessage', {
                text: `${user.username} has left the chat`,
                username: user.username,
            });
            io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) });
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
});
