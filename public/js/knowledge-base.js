// 🔧 지식 베이스 관리 기능

let allKnowledge = [];
let appliedKnowledge = [];
let currentSuggestedKnowledge = [];

// 지식 베이스 초기화
async function initializeKnowledgeBase() {
    try {
        // 이벤트 리스너 설정
        setupKnowledgeEventListeners();

        // 지식 목록 로드
        await loadAllKnowledge();

        console.log('지식 베이스 초기화 완료');
    } catch (error) {
        console.error('지식 베이스 초기화 오류:', error);
    }
}

// 이벤트 리스너 설정
function setupKnowledgeEventListeners() {
    // 지식 버튼 클릭
    document.getElementById('knowledgeBtn')?.addEventListener('click', openKnowledgeModal);

    // 지식 토글 버튼 이벤트 위임
    document.addEventListener('click', function (e) {
        if (e.target.closest('.knowledge-toggle')) {
            const button = e.target.closest('.knowledge-toggle');
            const knowledgeId = button.dataset.knowledgeId;
            if (knowledgeId) {
                toggleKnowledgeContent(knowledgeId);
            }
        }
    });

    // 모달 이벤트
    const knowledgeModal = document.getElementById('knowledgeModal');
    if (knowledgeModal) {
        knowledgeModal.addEventListener('shown.bs.modal', async () => {
            await loadAppliedKnowledge();
        });
    }
}

// 모든 지식 베이스 로드
async function loadAllKnowledge() {
    try {
        const response = await fetch('/api/knowledge-base', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            allKnowledge = await response.json();
            renderKnowledgeList();
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            console.error('지식 베이스 로드 실패');
        }
    } catch (error) {
        console.error('지식 베이스 로드 오류:', error);
    }
}

// 적용된 지식 로드
async function loadAppliedKnowledge() {
    if (!currentConversationId) return;

    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/knowledge`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            appliedKnowledge = await response.json();
            renderAppliedKnowledgeList();
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('적용된 지식 로드 오류:', error);
    }
}

// 지식 목록 렌더링
function renderKnowledgeList() {
    const container = document.getElementById('knowledgeList');
    if (!container) return;

    if (allKnowledge.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">등록된 지식이 없습니다.</div>';
        return;
    }

    const appliedIds = appliedKnowledge.map(k => k.id);

    container.innerHTML = allKnowledge.map(knowledge => {
        const isApplied = appliedIds.includes(knowledge.id);
        const keywords = knowledge.keywords.split(',').map(k => k.trim());

        return `
            <div class="knowledge-item" data-id="${knowledge.id}">
                <div class="knowledge-item-header">
                    <h6 class="knowledge-title">${escapeHtml(knowledge.title)}</h6>
                    <div class="knowledge-actions">
                        <button class="knowledge-toggle" data-knowledge-id="${knowledge.id}">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                </div>
                <div class="knowledge-content" id="knowledge-content-${knowledge.id}">
                    ${escapeHtml(knowledge.content).replace(/\n/g, '<br>')}
                </div>
                <div class="knowledge-keywords">
                    ${keywords.map(keyword => `<span class="keyword">${escapeHtml(keyword)}</span>`).join('')}
                </div>
                <div class="mt-2">
                    ${isApplied ?
                `<button class="btn-remove-knowledge" onclick="removeKnowledgeFromConversation(${knowledge.id})">
                            <i class="bi bi-x"></i> 제거
                        </button>` :
                `<button class="btn-apply-knowledge" onclick="applyKnowledgeToConversation(${knowledge.id})">
                            <i class="bi bi-plus"></i> 적용
                        </button>`
            }
                </div>
            </div>
        `;
    }).join('');
}

// 적용된 지식 목록 렌더링
function renderAppliedKnowledgeList() {
    const container = document.getElementById('appliedKnowledgeList');
    if (!container) return;

    if (appliedKnowledge.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">적용된 지식이 없습니다.</div>';
        return;
    }

    container.innerHTML = appliedKnowledge.map(knowledge => `
        <div class="applied-knowledge-item" data-id="${knowledge.id}">
            <div class="knowledge-item-header">
                <h6 class="knowledge-title">${escapeHtml(knowledge.title)}</h6>
                <button class="knowledge-toggle" data-knowledge-id="applied-${knowledge.id}">
                    <i class="bi bi-chevron-down"></i>
                </button>
            </div>
            <div class="knowledge-content" id="knowledge-content-applied-${knowledge.id}">
                ${escapeHtml(knowledge.content).replace(/\n/g, '<br>')}
            </div>
            <div class="mt-2">
                <button class="btn-remove-knowledge" onclick="removeKnowledgeFromConversation(${knowledge.id})">
                    <i class="bi bi-x"></i> 제거
                </button>
            </div>
        </div>
    `).join('');
}

// 지식 내용 토글
function toggleKnowledgeContent(knowledgeId) {
    const content = document.getElementById(`knowledge-content-${knowledgeId}`);
    const toggle = document.querySelector(`[data-knowledge-id="${knowledgeId}"] i`);

    if (content && toggle) {
        content.classList.toggle('show');
        toggle.classList.toggle('bi-chevron-down');
        toggle.classList.toggle('bi-chevron-up');
    }
}

// 지식 모달 열기
async function openKnowledgeModal() {
    const modal = new bootstrap.Modal(document.getElementById('knowledgeModal'));
    await loadAllKnowledge();
    await loadAppliedKnowledge();
    modal.show();
}

// Knowledge management functions removed - read-only mode

// 대화에 지식 적용
async function applyKnowledgeToConversation(knowledgeId) {
    if (!currentConversationId) {
        Swal.fire({ icon: 'warning', text: '대화를 선택해주세요.' });
        return;
    }

    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledgeId })
        });

        if (response.ok) {
            await loadAppliedKnowledge();
            renderKnowledgeList();
            showSuccessMessage('지식이 적용되었습니다.');
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            const errorText = await response.text();
            Swal.fire({ icon: 'error', text: errorText || '적용 중 오류가 발생했습니다.' });
        }
    } catch (error) {
        Swal.fire({ icon: 'error', text: '적용 중 오류가 발생했습니다.' });
    }
}

// 대화에서 지식 제거
async function removeKnowledgeFromConversation(knowledgeId) {
    if (!currentConversationId) return;

    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/knowledge`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledgeId })
        });

        if (response.ok) {
            await loadAppliedKnowledge();
            renderKnowledgeList();
            showSuccessMessage('지식이 제거되었습니다.');
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            Swal.fire({ icon: 'error', text: '제거 중 오류가 발생했습니다.' });
        }
    } catch (error) {
        Swal.fire({ icon: 'error', text: '제거 중 오류가 발생했습니다.' });
    }
}

// 지식 제안 UI 표시
function showKnowledgeSuggestion(suggestedKnowledge) {
    if (!suggestedKnowledge || suggestedKnowledge.length === 0) return;

    currentSuggestedKnowledge = suggestedKnowledge;

    suggestedKnowledge.forEach(knowledge => {
        const suggestionHtml = `
            <div class="knowledge-suggestion" data-suggestion-id="${knowledge.id}">
                <div class="knowledge-suggestion-header">
                    <i class="bi bi-lightbulb"></i> 관련 지식을 발견했습니다
                </div>
                <div class="knowledge-suggestion-content">
                    <strong>${escapeHtml(knowledge.title)}</strong><br>
                    ${escapeHtml(knowledge.content.substring(0, 100))}${knowledge.content.length > 100 ? '...' : ''}
                </div>
                <div class="knowledge-suggestion-actions">
                    <button class="btn-suggestion-yes" onclick="acceptKnowledgeSuggestion(${knowledge.id})">
                        예, 적용하겠습니다
                    </button>
                    <button class="btn-suggestion-no" onclick="rejectKnowledgeSuggestion(${knowledge.id})">
                        아니요
                    </button>
                </div>
            </div>
        `;

        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.insertAdjacentHTML('beforeend', suggestionHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });
}

// 지식 제안 수락
async function acceptKnowledgeSuggestion(knowledgeId) {
    await applyKnowledgeToConversation(knowledgeId);
    removeSuggestion(knowledgeId);
}

// 지식 제안 거절
function rejectKnowledgeSuggestion(knowledgeId) {
    removeSuggestion(knowledgeId);
}

// 제안 UI 제거
function removeSuggestion(knowledgeId) {
    const suggestion = document.querySelector(`[data-suggestion-id="${knowledgeId}"]`);
    if (suggestion) {
        suggestion.remove();
    }
}

// 성공 메시지 표시
function showSuccessMessage(message) {
    // 간단한 토스트 메시지 표시 (기존 알림 시스템 활용)
    console.log(`✅ ${message}`);
    // 실제로는 토스트 UI 구현 필요
}

// 전역에서 접근 가능하도록 함수들을 window 객체에 할당
window.initializeKnowledgeBase = initializeKnowledgeBase;
window.openKnowledgeModal = openKnowledgeModal;
window.toggleKnowledgeContent = toggleKnowledgeContent;
window.applyKnowledgeToConversation = applyKnowledgeToConversation;
window.removeKnowledgeFromConversation = removeKnowledgeFromConversation;
window.acceptKnowledgeSuggestion = acceptKnowledgeSuggestion;
window.rejectKnowledgeSuggestion = rejectKnowledgeSuggestion;
window.showKnowledgeSuggestion = showKnowledgeSuggestion;