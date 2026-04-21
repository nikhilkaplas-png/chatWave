const path = require('path');
const http = require('http');
const express = require('express');
const Filter = require('bad-words');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server)
const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users')

const PORT = 3001; //process.env.PORT || 3001;
const publicDirectoryPath = path.join(__dirname, '../public');

app.use(express.static(publicDirectoryPath));

io.on('connection', (socket) => {
    console.log('New websocket connection')
    socket.on('join', ({ username, room }, callback) => {
        const { error, user } = addUser({ id: socket.id, username, room })
        if (error) return callback(error)
        socket.join(user.room)
        socket.hbEventTime = Date.now()
        socket.emit('personChatMessage', { text: 'Welcome to the chat', username: user.username })
        socket.broadcast.to(user.room).emit('personChatMessage', { text: `joined the chat`, username: user.username })
        io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) })
        callback()
    })

    socket.on('typing', ({ isTyping }) => {
        const user = getUser(socket.id)
        if (!user) return
        socket.broadcast.to(user.room).emit('userTyping', {
            username: user.username,
            isTyping: Boolean(isTyping)
        })
    })

    socket.on('sendMessage', (eventData, callback) => {
        console.log('sendMessage', JSON.stringify(eventData))
        const user = getUser(socket.id)
        if (!user) return callback('User not found')
        const filter = new Filter()
        if (filter.isProfane(eventData.text)) return callback('Profanity is not allowed')
        io.to(user.room).emit('personChatMessage', eventData)
        callback()
    })

    socket.on('sendLocation', (latitude, longitude) => {
        const user = getUser(socket.id);
        if (!user) return;
        io.to(user.room).emit('personChatMessage', {
            text: '',
            username: user.username,
            isLocation: true,
            url: `https://google.com/maps?q=${latitude},${longitude}`,
            latitude: latitude,
            longitude: longitude
        });
    })

    socket.on('sendAudio', (eventData) => {
        const user = getUser(socket.id);
        if (!user) return;
        io.to(user.room).emit('personChatMessage', {
            text: '',
            username: user.username,
            isAudio: true,
            audioData: eventData.audioData // Cross-browser compatible base64
        });
    })

    socket.on('disconnect', () => {
        const user = removeUser(socket.id)
        if (user) {
            io.to(user.room).emit('userTyping', { username: user.username, isTyping: false })
            io.to(user.room).emit('personChatMessage', { text: `${user.username} has left the chat`, username: user.username })
            io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) })
        }
    })

})

server.listen(PORT, () => {console.log(`Server is running on port ${PORT}`)});
