// ================================================================
// FILE: public/js/dating_chat.js (수정된 전체 내용)
// ================================================================
let currentConversationId = null;
let currentConversation = null;
let characterInfo = {};
let isSending = false;
let generationAbortController = null;

// 시간 설정 관련 상태
let timeMode = 'auto';
let manualTime = 'morning';
let currentMessageTime = '';

document.addEventListener('DOMContentLoaded', async () => {
    // --- [수정된 부분 시작] ---
    const urlParams = new URLSearchParams(window.location.search);
    currentConversationId = urlParams.get('id');
    if (!currentConversationId || !/^\d+$/.test(currentConversationId)) {
        alert('잘못된 접근입니다. 대화 ID가 올바르지 않습니다.');
        window.location.href = '/dating';
        return;
    }
    // --- [수정된 부분 끝] ---

    try {
        await loadConversationDetails(); 
        await loadMessages();
        setupEventListeners();
        updateCurrentTimeIcon();
    } catch (error) {
        console.error("대화 로드 실패:", error.message);
        alert('유효하지 않거나 접근 권한이 없는 대화입니다. 캐릭터를 먼저 선택해주세요.');
        window.location.href = '/dating';
    }
});

function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    messageInput.addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });
    sendButton.addEventListener('click', sendMessage);

    // --- [시간 설정 버튼 기능 추가] ---
    const timeSettingsBtn = document.getElementById('timeSettingsBtn');
    if (timeSettingsBtn) {
        timeSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showTimeSettingsModal();
        });
    }

    // --- [기억 확인 버튼 기능 추가] ---
    const memoryCheckBtn = document.getElementById('memoryCheckBtn');
    if (memoryCheckBtn) {
        memoryCheckBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await showCharacterMemoryModal();
        });
    }

    setupTimeSettingsModalEvents();
}

// ========================================================
// 현재 시간 아이콘 표시 함수
// ========================================================
function updateCurrentTimeIcon() {
    const currentTimeIconEl = document.getElementById('currentTimeIcon');
    if (currentTimeIconEl) {
        const timeLabel = getCurrentSelectedTime();
        currentTimeIconEl.innerHTML = getMessageTimeIconOnly(timeLabel);
    }
}

function getMessageTimeIconOnly(message_time) {
    switch(message_time) {
        case '아침':
            return '<i class="bi bi-sunrise-fill"></i>';
        case '낮':
            return '<i class="bi bi-sun-fill"></i>';
        case '밤':
        case '저녁':
            return '<i class="bi bi-sunset-fill"></i>';
        case '새벽':
            return '<i class="bi bi-cloud-moon-fill"></i>';
        default:
            return '';
    }
}

async function loadConversationDetails() {
    const response = await fetch(`/api/dating/conversation/${currentConversationId}`);
    if (!response.ok) {
        if (response.status === 401) window.location.href = '/login';
        throw new Error(`대화 정보를 불러올 수 없습니다. Status: ${response.status}`);
    }
    currentConversation = await response.json();
    
    document.title = `세카이 채팅`;
    document.getElementById('characterName').textContent = currentConversation.character_name;
    document.getElementById('characterAvatar').src = currentConversation.character_image;
    characterInfo.name = currentConversation.character_name;
    characterInfo.profile_image = currentConversation.character_image;

    updateAffectionDisplay();
    updateCurrentTimeIcon();
}

async function loadMessages() {
    try {
        const response = await fetch(`/api/dating/conversation/${currentConversationId}/messages`);
        if (!response.ok) throw new Error('메시지 로드 실패');
        const messages = await response.json();

        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        messages.forEach(addMessageToDisplay);
        scrollToBottom();
    } catch (error) {
        console.error(error);
    }
}

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const content = messageInput.value.trim();

    if (!content) return;

    if (isSending && generationAbortController) {
        generationAbortController.abort();
    }

    generationAbortController = new AbortController();
    const signal = generationAbortController.signal;

    isSending = true;
    sendButton.disabled = true;
    sendButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
    messageInput.value = '';
    messageInput.style.height = 'auto';

    const messageTime = getCurrentSelectedTime();

    addMessageToDisplay({ role: 'user', content: content, message_time: messageTime });
    scrollToBottom();

    try {
        const response = await fetch('/api/dating/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentConversationId, content }),
            signal
        });
        if (!response.ok) throw new Error('메시지 전송 실패');

        const result = await response.json();
        
        addMessageToDisplay(result.characterResponse);
        if (result.affectionUpdate) {
            currentConversation.friendship_level = result.affectionUpdate.friendship_level;
            currentConversation.romantic_level = result.affectionUpdate.romantic_level;
            updateAffectionDisplay();
        }
        scrollToBottom();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted');
        } else {
            console.error(error);
            alert('메시지 전송에 실패했습니다.');
        }
    } finally {
        isSending = false;
        sendButton.disabled = false;
        sendButton.innerHTML = '<i class="bi bi-send"></i>';
        generationAbortController = null;
    }
}

function getMessageTimeDisplay(message_time) {
    switch(message_time) {
        case '아침':
            return '아침 <i class="bi bi-sunrise-fill"></i>';
        case '낮':
            return '낮 <i class="bi bi-sun-fill"></i>';
        case '밤':
        case '저녁':
            return '저녁 <i class="bi bi-sunset-fill"></i>';
        case '새벽':
            return '새벽 <i class="bi bi-cloud-moon-fill"></i>';
        default:
            return '';
    }
}

function addMessageToDisplay(message) {
    const container = document.getElementById('messagesContainer');
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.role}`;
    const isUser = message.role === 'user';
    const avatarSrc = isUser ? '/images/characters/default.webp' : characterInfo.profile_image;
    const messageName = isUser ? '나' : characterInfo.name;
    let timeInfo = '';
    if (message.message_time) {
        timeInfo = `<div class="message-meta">${getMessageTimeDisplay(message.message_time)}</div>`;
    }
    messageEl.innerHTML = `
        <img src="${avatarSrc}" alt="${messageName}" class="message-avatar" onerror="this.src='/images/characters/default.webp'">
        <div class="message-content">
            <div class="message-bubble">${escapeHtml(message.content)}</div>
            ${timeInfo}
        </div>
    `;
    container.appendChild(messageEl);
}

function updateAffectionDisplay() {
    if (!currentConversation) return;
    const friendshipLevel = currentConversation.friendship_level || 50;
    const romanticLevel = currentConversation.romantic_level || 50;
    document.getElementById('friendshipBar').style.width = `${friendshipLevel}%`;
    document.getElementById('romanticBar').style.width = `${romanticLevel}%`;
    document.getElementById('friendshipValue').textContent = friendshipLevel;
    document.getElementById('romanticValue').textContent = romanticLevel;
    updateCurrentTimeIcon();
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===========================================
// 시간설정 모달 관련 기능
// ===========================================
function showTimeSettingsModal() {
    const modal = document.getElementById('timeSettingsModal');
    if (modal) {
        updateTimeSettingsModalView();
        let bsModal = bootstrap.Modal.getOrCreateInstance(modal);
        bsModal.show();
    }
}

function setupTimeSettingsModalEvents() {
    const timeModeAuto = document.getElementById('timeModeAuto');
    const timeModeManual = document.getElementById('timeModeManual');
    const manualTimeSelection = document.getElementById('manualTimeSelection');
    const saveBtn = document.getElementById('saveTimeSettingsBtn');

    if (timeModeAuto) {
        timeModeAuto.addEventListener('change', () => {
            if (timeModeAuto.checked) {
                timeMode = 'auto';
                updateTimeSettingsModalView();
                updateCurrentTimeIcon();
            }
        });
    }
    if (timeModeManual) {
        timeModeManual.addEventListener('change', () => {
            if (timeModeManual.checked) {
                timeMode = 'manual';
                updateTimeSettingsModalView();
                updateCurrentTimeIcon();
            }
        });
    }

    if (manualTimeSelection) {
        manualTimeSelection.querySelectorAll('input[name="current_time"]').forEach(radio => {
            radio.addEventListener('change', () => {
                manualTime = radio.value;
                updateCurrentTimeIcon();
            });
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const modal = document.getElementById('timeSettingsModal');
            let bsModal = bootstrap.Modal.getOrCreateInstance(modal);
            bsModal.hide();
        });
    }
}

function updateTimeSettingsModalView() {
    const manualTimeSelection = document.getElementById('manualTimeSelection');
    const timeModeAuto = document.getElementById('timeModeAuto');
    const timeModeManual = document.getElementById('timeModeManual');

    if (manualTimeSelection) {
        manualTimeSelection.style.display = (timeMode === 'manual') ? 'block' : 'none';
    }
    if (timeModeAuto) timeModeAuto.checked = (timeMode === 'auto');
    if (timeModeManual) timeModeManual.checked = (timeMode === 'manual');

    const autoTimeInfoEl = document.getElementById('autoTimeInfo');
    if (autoTimeInfoEl) {
        if (timeMode === 'auto') {
            const label = getMessageTimeDisplay(getSeoulTimeOfDay());
            autoTimeInfoEl.innerHTML = `<span class="me-2">${label}</span><span style="font-size:0.9em;color:#666;">(현재 서울 기준)</span>`;
            autoTimeInfoEl.style.display = 'block';
        } else {
            autoTimeInfoEl.style.display = 'none';
        }
    }

    if (timeMode === 'manual' && manualTimeSelection) {
        manualTimeSelection.querySelectorAll('input[name="current_time"]').forEach(radio => {
            radio.checked = (radio.value === manualTime);
        });
    }
}

function getCurrentSelectedTime() {
    if (timeMode === 'auto') {
        return getSeoulTimeOfDay();
    } else {
        switch(manualTime) {
            case 'morning': return '아침';
            case 'day': return '낮';
            case 'night': return '저녁';
            case 'dawn': return '새벽';
            default: return '아침';
        }
    }
}

function getSeoulTimeOfDay() {
    const now = new Date();
    const seoulHour = (now.getUTCHours() + 9) % 24;
    if (seoulHour >= 5 && seoulHour < 12) return '아침';
    if (seoulHour >= 12 && seoulHour < 18) return '낮';
    if (seoulHour >= 18 && seoulHour < 23) return '저녁';
    return '새벽';
}

// ===========================================
// 기억 확인 모달 관련 기능 구현
// ===========================================
async function showCharacterMemoryModal() {
    const modal = document.getElementById('memoryCheckModal');
    const memoryContent = document.getElementById('characterMemoryContent');
    if (!modal || !memoryContent) return;

    memoryContent.textContent = '기억을 불러오는 중...';
    let bsModal = bootstrap.Modal.getOrCreateInstance(modal);
    bsModal.show();

    try {
        const response = await fetch(`/api/dating/conversation/${currentConversationId}/memory`);
        if (!response.ok) throw new Error('기억 불러오기 실패');
        const data = await response.json();
        memoryContent.textContent = data.character_memory || '아직 특별한 기억이 없습니다.';
    } catch (err) {
        memoryContent.textContent = '기억을 불러올 수 없습니다.';
    }
}
// ================================================================
