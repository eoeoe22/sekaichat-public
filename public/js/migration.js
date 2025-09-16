document.addEventListener('DOMContentLoaded', () => {
    const kanadeLoginForm = document.getElementById('kanadeLoginForm');
    const conversationSelectSection = document.getElementById('conversationSelectSection');
    const kanadeConversationList = document.getElementById('kanadeConversationList');
    const conversationPreview = document.getElementById('conversationPreview');
    const migrateBtn = document.getElementById('migrateBtn');
    const migrationProgressSection = document.getElementById('migrationProgressSection');
    const migrationProgressBar = document.getElementById('migrationProgressBar');
    const migrationStatus = document.getElementById('migrationStatus');
    const migrationResultSection = document.getElementById('migrationResultSection');
    const migrationResultMessage = document.getElementById('migrationResultMessage');
    const errorMessage = document.getElementById('errorMessage');

    let kanadeAuthToken = null;

    // 카나데 계정 로그인
    kanadeLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('kanadeUsername').value;
        const password = document.getElementById('kanadePassword').value;

        try {
            const response = await fetch('/api/migration/kanade-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) {
                throw new Error('카나데 계정 로그인에 실패했습니다.');
            }

            const data = await response.json();
            kanadeAuthToken = data.token;

            document.getElementById('kanadeLoginSection').style.display = 'none';
            conversationSelectSection.style.display = 'block';
            
            await loadKanadeConversations();

        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.style.display = 'block';
        }
    });

    // 카나데 대화내역 불러오기
    async function loadKanadeConversations() {
        try {
            const response = await fetch('/api/migration/kanade-conversations', {
                headers: { 'Authorization': `Bearer ${kanadeAuthToken}` }
            });

            if (!response.ok) {
                throw new Error('대화내역을 불러오는 데 실패했습니다.');
            }

            const conversations = await response.json();
            kanadeConversationList.innerHTML = '';
            if (conversations.length === 0) {
                kanadeConversationList.innerHTML = '<p>이전할 대화내역이 없습니다.</p>';
                migrateBtn.disabled = true;
            } else {
                conversations.forEach(conv => {
                    const item = document.createElement('a');
                    item.href = '#';
                    item.className = 'list-group-item list-group-item-action';
                    item.dataset.conversationId = conv.id;
                    item.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="${conv.id}" id="conv-check-${conv.id}" onclick="event.stopPropagation()">
                                <label class="form-check-label" for="conv-check-${conv.id}">${escapeHtml(conv.title)}</label>
                            </div>
                        </div>
                    `;
                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        loadConversationPreview(conv.id);
                        // Highlight active item
                        document.querySelectorAll('#kanadeConversationList .list-group-item').forEach(el => el.classList.remove('active'));
                        item.classList.add('active');
                    });
                    kanadeConversationList.appendChild(item);
                });
            }
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.style.display = 'block';
        }
    }

    // 대화 미리보기 불러오기
    async function loadConversationPreview(conversationId) {
        conversationPreview.style.display = 'block';
        conversationPreview.innerHTML = '<p>미리보기를 불러오는 중...</p>';

        try {
            const response = await fetch(`/api/migration/kanade-conversation-preview/${conversationId}`, {
                headers: { 'Authorization': `Bearer ${kanadeAuthToken}` }
            });

            if (!response.ok) {
                throw new Error('미리보기를 불러오는 데 실패했습니다.');
            }

            const messages = await response.json();
            conversationPreview.innerHTML = '';

            if (messages.length === 0) {
                conversationPreview.innerHTML = '<p>대화 내용이 없습니다.</p>';
            } else {
                messages.forEach(msg => {
                    const messageElement = document.createElement('div');
                    messageElement.className = 'mb-2';
                    const speaker = msg.role === 'user' ? '나' : '카나데';
                    messageElement.innerHTML = `<strong>${speaker}:</strong><br>${escapeHtml(msg.content).replace(/\n/g, '<br>')}`;
                    conversationPreview.appendChild(messageElement);
                });
            }
        } catch (error) {
            conversationPreview.innerHTML = `<p class="text-danger">${error.message}</p>`;
        }
    }


    // 이전 시작 버튼 클릭
    migrateBtn.addEventListener('click', async () => {
        const selectedConversations = Array.from(kanadeConversationList.querySelectorAll('input[type="checkbox"]:checked'))
            .map(input => parseInt(input.value));

        if (selectedConversations.length === 0) {
            alert('이전할 대화내역을 하나 이상 선택해주세요.');
            return;
        }

        conversationSelectSection.style.display = 'none';
        migrationProgressSection.style.display = 'block';

        try {
            const response = await fetch('/api/migration/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${kanadeAuthToken}`
                },
                body: JSON.stringify({ conversationIds: selectedConversations })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '이전 작업 시작에 실패했습니다.');
            }

            const data = await response.json();
            updateProgress(data.total, data.migrated);
            
            migrationProgressSection.style.display = 'none';
            migrationResultSection.style.display = 'block';
            migrationResultMessage.textContent = `총 ${data.total}개의 대화 중 ${data.migrated}개를 성공적으로 이전했습니다.`;

        } catch (error) {
            migrationProgressSection.style.display = 'none';
            errorMessage.textContent = `이전 중 오류 발생: ${error.message}`;
            errorMessage.style.display = 'block';
        }
    });

    function updateProgress(total, migrated) {
        const percentage = total > 0 ? Math.round((migrated / total) * 100) : 0;
        migrationProgressBar.style.width = `${percentage}%`;
        migrationProgressBar.textContent = `${percentage}%`;
        migrationProgressBar.setAttribute('aria-valuenow', percentage);
        migrationStatus.textContent = `${migrated} / ${total} 개 이전 완료`;
    }
    
    function escapeHtml(text) {
        if (typeof text !== 'string') {
            return '';
        }
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }
});
