;(async function runChat() {
    const { room } = Qs.parse(location.search, { ignoreQueryPrefix: true });
    if (!room || !String(room).trim()) {
        window.location.href = '/join';
        return;
    }

    let me;
    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        if (!res.ok) {
            window.location.href = '/';
            return;
        }
        me = await res.json();
    } catch (_) {
        window.location.href = '/';
        return;
    }

    const username = me.username;
    const socket = io({ withCredentials: true });

    const $messageForm = document.querySelector('#chatForm');
    const $messageInput = document.querySelector('#message');
    const $messageButton = document.querySelector('#send');
    const $sendLocation = document.querySelector('#sendLocation');
    const $recordAudio = document.querySelector('#recordAudio');

    const $messages = document.querySelector('#messages');
    const $typingIndicator = document.querySelector('#typingIndicator');
    const $companionPrompt = document.querySelector('#companionPrompt');
    const $companionStream = document.querySelector('#companionStream');
    const $askCompanion = document.querySelector('#askCompanion');

    let activeCompanionRequestId = null;
    let $companionStreamEl = null;
    let companionStreamBody = null;

    function removeCompanionStreamEl() {
        if ($companionStreamEl && $companionStreamEl.parentNode) {
            $companionStreamEl.parentNode.removeChild($companionStreamEl);
        }
        $companionStreamEl = null;
        companionStreamBody = null;
    }

    const typingUsers = new Map();
    let typingStopTimer = null;
    let sentTypingActive = false;

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    const messageTemplate = document.querySelector('#message-template').innerHTML;
    const sidebarTemplate = document.querySelector('#sidebar-template').innerHTML;

    const capitalize = (str) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : '');

    function renderTypingIndicator() {
        if (!$typingIndicator) return;
        const names = [...typingUsers.values()];
        if (names.length === 0) {
            $typingIndicator.textContent = '';
            $typingIndicator.classList.remove('typing-indicator--visible');
            return;
        }
        $typingIndicator.classList.add('typing-indicator--visible');
        if (names.length === 1) {
            $typingIndicator.textContent = `${names[0]} is typing…`;
        } else if (names.length === 2) {
            $typingIndicator.textContent = `${names[0]} and ${names[1]} are typing…`;
        } else {
            $typingIndicator.textContent = `${names.length} people are typing…`;
        }
    }

    function clearLocalTypingBroadcast() {
        clearTimeout(typingStopTimer);
        typingStopTimer = null;
        if (sentTypingActive) {
            socket.emit('typing', { isTyping: false });
            sentTypingActive = false;
        }
    }

    socket.on('userTyping', ({ username: typerName, isTyping }) => {
        if (!typerName) return;
        if (typerName.toLowerCase() === username.toLowerCase()) return;
        const key = typerName.toLowerCase();
        if (isTyping) {
            typingUsers.set(key, capitalize(typerName));
        } else {
            typingUsers.delete(key);
        }
        renderTypingIndicator();
    });

    socket.on('roomData', ({ room: r, users }) => {
        const html = Mustache.render(sidebarTemplate, {
            room: r,
            users: users.map((u) => ({ ...u, username: capitalize(u.username) })),
        });
        document.querySelector('#sidebar').innerHTML = html;
    });

    socket.on('personChatMessage', (eventData) => {
        if (
            eventData.isAi &&
            eventData.companionRequestId &&
            eventData.companionRequestId === activeCompanionRequestId
        ) {
            removeCompanionStreamEl();
            activeCompanionRequestId = null;
        }

        const displayName = capitalize(eventData.username);
        const isOwn = displayName.toLowerCase() === username.toLowerCase();
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
                longitude: eventData.longitude,
            });
            $messages.insertAdjacentHTML('beforeend', html);
        } else if (isAudio && eventData.audioData) {
            const audioTemplate = document.querySelector('#audio-template').innerHTML;
            const html = Mustache.render(audioTemplate, {
                audioUrl: eventData.audioData,
                username: displayName,
                createdAt: moment().format('h:mm a'),
                messageClass: isOwn ? 'my-message' : 'other-message',
                avatar: displayName.charAt(0),
            });
            $messages.insertAdjacentHTML('beforeend', html);
        } else if (eventData.isAi) {
            const html = Mustache.render(messageTemplate, {
                message: eventData.text,
                username: displayName,
                createdAt: moment().format('h:mm a'),
                messageClass: 'other-message companion-ai',
                avatar: displayName.charAt(0) || '✨',
            });
            $messages.insertAdjacentHTML('beforeend', html);
        } else {
            const html = Mustache.render(messageTemplate, {
                message: eventData.text,
                username: displayName,
                createdAt: moment().format('h:mm a'),
                messageClass: isOwn ? 'my-message' : 'other-message',
                avatar: displayName.charAt(0),
            });
            $messages.insertAdjacentHTML('beforeend', html);
        }
        $messages.scrollTop = $messages.scrollHeight;
    });

    socket.on('aiChunk', ({ requestId, chunk }) => {
        if (!requestId || chunk == null || !$messages) return;
        activeCompanionRequestId = requestId;
        if (!$companionStreamEl || $companionStreamEl.dataset.requestId !== requestId) {
            removeCompanionStreamEl();
            activeCompanionRequestId = requestId;
            $companionStreamEl = document.createElement('div');
            $companionStreamEl.className = 'message other-message companion-streaming';
            $companionStreamEl.dataset.requestId = requestId;
            $companionStreamEl.innerHTML =
                '<div class="avatar">✨</div><div class="bubble"><div class="message-header"><span class="username">Claude</span><span class="timestamp">' +
                moment().format('h:mm a') +
                '</span></div><div class="message-body companion-stream-body"></div></div>';
            $messages.appendChild($companionStreamEl);
            companionStreamBody = $companionStreamEl.querySelector('.companion-stream-body');
        }
        if (companionStreamBody) companionStreamBody.appendChild(document.createTextNode(chunk));
        $messages.scrollTop = $messages.scrollHeight;
    });

    socket.on('aiDone', () => {});

    socket.on('companionError', ({ message }) => {
        removeCompanionStreamEl();
        activeCompanionRequestId = null;
        if (message) alert(message);
    });

    $messageInput.addEventListener('input', () => {
        const hasText = $messageInput.value.trim().length > 0;
        if (hasText) {
            if (!sentTypingActive) {
                socket.emit('typing', { isTyping: true });
                sentTypingActive = true;
            }
            clearTimeout(typingStopTimer);
            typingStopTimer = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
                sentTypingActive = false;
                typingStopTimer = null;
            }, 1200);
        } else {
            clearLocalTypingBroadcast();
        }
    });

    $messageInput.addEventListener('blur', () => {
        if (!$messageInput.value.trim()) {
            clearLocalTypingBroadcast();
        }
    });

    $messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        $messageButton.setAttribute('disabled', 'disabled');
        const message = $messageInput.value;
        const eventData = {
            text: message,
            username: username,
            room: room,
        };
        socket.emit('sendMessage', eventData, (error) => {
            $messageButton.removeAttribute('disabled');
            $messageInput.value = '';
            clearLocalTypingBroadcast();
            $messageInput.focus();
            if (error) {
                return console.log(message);
            }
            console.log('Message delivered');
        });
    });

    if ($askCompanion && $companionPrompt && $companionStream) {
        $askCompanion.addEventListener('click', () => {
            const prompt = $companionPrompt.value.trim();
            if (!prompt) return;
            const stream = $companionStream.checked;
            $askCompanion.disabled = true;
            socket.emit('askCompanion', { prompt, stream }, (err) => {
                $askCompanion.disabled = false;
                if (err) {
                    alert(err);
                    removeCompanionStreamEl();
                    activeCompanionRequestId = null;
                    return;
                }
                $companionPrompt.value = '';
            });
        });
    }

    $sendLocation.addEventListener('click', () => {
        if (!navigator.geolocation) {
            return alert('Geolocation is not supported by your browser');
        }
        navigator.geolocation.getCurrentPosition((position) => {
            socket.emit('sendLocation', position.coords.latitude, position.coords.longitude);
        });
    });

    socket.emit('join', { room: String(room).trim() }, (error) => {
        if (error) {
            alert(error);
            window.location.href = '/join';
        }
    });

    const $logoutBtn = document.getElementById('logout');
    if ($logoutBtn) {
        $logoutBtn.addEventListener('click', () => {
            // Leave current room but keep user signed in.
            window.location.href = '/join';
        });
    }

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
                    const reader = new FileReader();
                    reader.onload = function () {
                        const base64Audio = reader.result;
                        socket.emit('sendAudio', {
                            audioData: base64Audio,
                            username: username,
                            room: room,
                        });
                    };
                    reader.readAsDataURL(audioBlob);
                    stream.getTracks().forEach((track) => track.stop());
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
            mediaRecorder.stop();
            isRecording = false;
            $recordAudio.textContent = '🎤';
            $recordAudio.style.background = '';
        }
    });
})();
