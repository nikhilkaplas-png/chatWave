const socket = io();
const $messageForm = document.querySelector('#chatForm')
const $messageInput = document.querySelector('#message')
const $messageButton = document.querySelector('#send')
const $sendLocation = document.querySelector('#sendLocation')
const $recordAudio = document.querySelector('#recordAudio')

const $messages = document.querySelector('#messages')
const $typingIndicator = document.querySelector('#typingIndicator')

// Who is currently typing (other users only; keyed by lowercase username)
const typingUsers = new Map()
let typingStopTimer = null
let sentTypingActive = false

// Audio recording variables
let mediaRecorder = null
let audioChunks = []
let isRecording = false

// templates
const messageTemplate = document.querySelector('#message-template').innerHTML
const sidebarTemplate = document.querySelector('#sidebar-template').innerHTML

// Options
const { username, room } = Qs.parse(location.search, { ignoreQueryPrefix: true })

// Helper to capitalize first letter
const capitalize = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : ''

function renderTypingIndicator() {
    if (!$typingIndicator) return
    const names = [...typingUsers.values()]
    if (names.length === 0) {
        $typingIndicator.textContent = ''
        $typingIndicator.classList.remove('typing-indicator--visible')
        return
    }
    $typingIndicator.classList.add('typing-indicator--visible')
    if (names.length === 1) {
        $typingIndicator.textContent = `${names[0]} is typing…`
    } else if (names.length === 2) {
        $typingIndicator.textContent = `${names[0]} and ${names[1]} are typing…`
    } else {
        $typingIndicator.textContent = `${names.length} people are typing…`
    }
}

function clearLocalTypingBroadcast() {
    clearTimeout(typingStopTimer)
    typingStopTimer = null
    if (sentTypingActive) {
        socket.emit('typing', { isTyping: false })
        sentTypingActive = false
    }
}

socket.on('userTyping', ({ username: typerName, isTyping }) => {
    if (!typerName) return
    if (typerName.toLowerCase() === username.toLowerCase()) return
    const key = typerName.toLowerCase()
    if (isTyping) {
        typingUsers.set(key, capitalize(typerName))
    } else {
        typingUsers.delete(key)
    }
    renderTypingIndicator()
})

socket.on('roomData', ({ room, users }) => {
    const html = Mustache.render(sidebarTemplate, {
        room,
        users: users.map(u => ({ ...u, username: capitalize(u.username) }) )
    })
    document.querySelector('#sidebar').innerHTML = html
})

socket.on('personChatMessage', (eventData) => {
    const displayName = capitalize(eventData.username)
    const isOwn = displayName.toLowerCase() === username.toLowerCase()
    const isLocation = eventData.isLocation;
    const isAudio = eventData.isAudio;

    if (isLocation && eventData.url) {
        const locationTemplate = document.querySelector('#location-template').innerHTML;
        const html = Mustache.render(locationTemplate, {
            url: eventData.url,
            username: displayName,
            createdAt: moment().format('h:mm a'),
            messageClass: isOwn ? 'my-message' : 'other-message',
            avatar: displayName.charAt(0),
            latitude: eventData.latitude,
            longitude: eventData.longitude
        });
        $messages.insertAdjacentHTML('beforeend', html);
    } else if (isAudio && eventData.audioData) {
        const audioTemplate = document.querySelector('#audio-template').innerHTML;
        const html = Mustache.render(audioTemplate, {
            audioUrl: eventData.audioData, // Now using base64 data
            username: displayName,
            createdAt: moment().format('h:mm a'),
            messageClass: isOwn ? 'my-message' : 'other-message',
            avatar: displayName.charAt(0)
        });
        $messages.insertAdjacentHTML('beforeend', html);
    } else {
        const html = Mustache.render(messageTemplate, {
            message: eventData.text,
            username: displayName,
            createdAt: moment().format('h:mm a'),
            messageClass: isOwn ? 'my-message' : 'other-message',
            avatar: displayName.charAt(0)
        });
        $messages.insertAdjacentHTML('beforeend', html);
    }
    $messages.scrollTop = $messages.scrollHeight;
})

$messageInput.addEventListener('input', () => {
    const hasText = $messageInput.value.trim().length > 0
    if (hasText) {
        if (!sentTypingActive) {
            socket.emit('typing', { isTyping: true })
            sentTypingActive = true
        }
        clearTimeout(typingStopTimer)
        typingStopTimer = setTimeout(() => {
            socket.emit('typing', { isTyping: false })
            sentTypingActive = false
            typingStopTimer = null
        }, 1200)
    } else {
        clearLocalTypingBroadcast()
    }
})

$messageInput.addEventListener('blur', () => {
    if (!$messageInput.value.trim()) {
        clearLocalTypingBroadcast()
    }
})

$messageForm.addEventListener('submit', (e) => {
    e.preventDefault()
    $messageButton.setAttribute('disabled', 'disabled')
    const message = $messageInput.value
    const eventData = {
        text: message,
        username: username,
        room: room
    }
    socket.emit('sendMessage', eventData, (error) => {
        $messageButton.removeAttribute('disabled')
        $messageInput.value = ''
        clearLocalTypingBroadcast()
        $messageInput.focus()
        if (error) {
            return console.log(message)
        }
        console.log('Message delivered')
    })
})

$sendLocation.addEventListener('click', () => {
    if (!navigator.geolocation) {
        return alert('Geolocation is not supported by your browser');
    }
    navigator.geolocation.getCurrentPosition((position) => {
        console.log('sendLocation', JSON.stringify(position))
        socket.emit('sendLocation', position.coords.latitude, position.coords.longitude);
    })
})

socket.emit('join', { username, room }, (error) => {
    if (error) {
        alert(error)
        location.href = '/'
    }
})

const $logoutBtn = document.getElementById('logout');
if ($logoutBtn) {
  $logoutBtn.addEventListener('click', () => {
    window.location.href = '/index.html';
  });
}

// Audio recording functionality
$recordAudio.addEventListener('click', async () => {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                
                // Convert to base64 for cross-browser compatibility
                const reader = new FileReader();
                reader.onload = function() {
                    const base64Audio = reader.result; // "data:audio/wav;base64,..."
                    
                    // Send audio message to server
                    socket.emit('sendAudio', {
                        audioData: base64Audio, // Cross-browser compatible
                        username: username,
                        room: room
                    });
                };
                reader.readAsDataURL(audioBlob);
                
                // Clean up
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            isRecording = true;
            $recordAudio.textContent = '⏹️';
            $recordAudio.style.background = '#ff6b6b';
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Microphone access denied. Please allow microphone access to record audio.');
        }
    } else {
        // Stop recording
        mediaRecorder.stop();
        isRecording = false;
        $recordAudio.textContent = '🎤';
        $recordAudio.style.background = '';
    }
});