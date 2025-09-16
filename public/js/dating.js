// ================================================================
// FILE: public/js/dating.js (수정된 전체 내용)
// ================================================================

let newConversationModal;

document.addEventListener('DOMContentLoaded', () => {
    newConversationModal = new bootstrap.Modal(document.getElementById('newConversationModal'));
    loadConversations();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('newConversationBtn').addEventListener('click', () => {
        loadAvailableCharacters();
        newConversationModal.show();
    });
}

async function loadConversations() {
    try {
        const response = await fetch('/api/dating/conversations');
        if (!response.ok) {
            if (response.status === 401) window.location.href = '/login';
            throw new Error('대화 목록 로드 실패');
        }
        
        const conversations = await response.json();
        const listEl = document.getElementById('conversationList');
        const noConvoEl = document.getElementById('noConversations');
        
        if (conversations.length === 0) {
            listEl.innerHTML = '';
            noConvoEl.style.display = 'block';
            return;
        }

        noConvoEl.style.display = 'none';
        listEl.innerHTML = conversations.map(convo => {
            const lastMessageText = convo.last_message ? escapeHtml(convo.last_message.substring(0, 25)) + '...' : '대화를 시작해보세요.';
            
            // --- [수정] --- Card 클릭 시 이동할 URL을 실제 파일 경로로 변경
            const chatUrl = `/dating_chat.html?id=${convo.id}`;
            
            return `
            <div class="col-md-6 col-lg-4">
                <div class="card character-card h-100" onclick="location.href='${chatUrl}'">
                    <div class="card-body d-flex align-items-center">
                        <img src="${convo.character_image}" alt="${convo.character_name}" class="character-avatar me-3" onerror="this.src='/images/characters/default.webp'">
                        <div>
                            <h5 class="card-title mb-1">${escapeHtml(convo.character_name)}</h5>
                            <p class="card-text text-muted small mb-1">${lastMessageText}</p>
                            <p class="card-text text-muted" style="font-size: 0.75rem;">${new Date(convo.updated_at).toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            </div>
        `}).join('');

    } catch (error) {
        console.error(error);
        document.getElementById('conversationList').innerHTML = `<p class="text-danger">오류 발생: ${error.message}</p>`;
    }
}

async function loadAvailableCharacters() {
    try {
        const response = await fetch('/api/dating/characters');
        if (!response.ok) throw new Error('캐릭터 목록 로드 실패');

        const characters = await response.json();
        const selectionEl = document.getElementById('characterSelection');

        if (characters.length === 0) {
            selectionEl.innerHTML = '<p class="text-muted text-center">모든 캐릭터와 대화를 시작했습니다.</p>';
            return;
        }

        selectionEl.innerHTML = characters.map(char => `
            <div class="modal-character-item" onclick="startConversation(${char.id})">
                <img src="${char.profile_image}" alt="${char.name}" class="character-avatar me-3" onerror="this.src='/images/characters/default.webp'">
                <div>
                    <strong>${escapeHtml(char.name)}</strong>
                    <p class="small text-muted mb-0">${escapeHtml(char.description)}</p>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error(error);
        document.getElementById('characterSelection').innerHTML = `<p class="text-danger">오류 발생: ${error.message}</p>`;
    }
}

async function startConversation(characterId) {
    try {
        const response = await fetch('/api/dating/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId })
        });
        if (!response.ok) throw new Error('대화 시작에 실패했습니다.');

        const data = await response.json();
        
        // --- [수정된 부분 시작] ---
        // 이동할 URL을 가상 경로가 아닌 실제 파일 경로로 변경합니다.
        // 이렇게 하면 Cloudflare의 내장 정적 에셋 핸들러가 요청을 바로 처리하여 오류가 발생하지 않습니다.
        window.location.href = `/dating_chat.html?id=${data.conversationId}`;
        // --- [수정된 부분 끝] ---

    } catch (error) {
        console.error(error);
        alert(error.message);
    }
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
