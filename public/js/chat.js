let currentConversationId = null;
let userInfo = null;
let lastUploadedImageData = null;
let currentCharacters = [];
let availableCharacters = [];
let awaitingResponse = false;
let autoCallInProgress = false;
let currentWorkMode = false;
let currentShowTime = true;
let currentSituationPrompt = '';
let showMarkdown = true;

let autoReplyModeEnabled = true;
let continuousResponseEnabled = false; // 기본값은 false (연속응답 비활성화)
let awaitingUserMessageResponse = false;
let thinkingLevel = 'MEDIUM';
let generationAbortController = null;

function showSnackbar(message, type = 'info') {
    const iconMap = {
        'info': 'info',
        'warning': 'warning',
        'success': 'success',
        'error': 'error'
    };

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer)
            toast.addEventListener('mouseleave', Swal.resumeTimer)
        }
    });

    Toast.fire({
        icon: iconMap[type] || 'info',
        title: message
    });
}


const GEMINI_ERROR_GUIDANCE = `<h4><i class=\"bi bi-question-circle-fill\"></i> 원인</h4>
<p>메시지 처리 중 오류가 발생하는 주요 원인은 다음과 같습니다.</p>

<strong class=\"d-block mt-3\"><i class=\"bi bi-geo-alt-fill\"></i> Gemini 지역 제한 (가장 흔함)</strong>
<p class=\"mt-2 mb-1 text-muted\" style=\"font-size: 0.9rem;\">이 사이트는 Cloudflare Workers를 기반으로 동작하며, 사용자의 위치에 따라 가장 가까운 서버에서 요청을 처리합니다. 간혹 홍콩 서버에서 요청이 처리될 수 있는데, Google Gemini는 홍콩 지역에서 이용할 수 없어 오류가 발생합니다.</p>
<div class=\"alert alert-light mt-3\">
    <h5 class=\"alert-heading fs-6\"><i class=\"bi bi-lightbulb-fill\"></i> 해결 방법</h5>
    <ul class=\"mb-0 ps-4\">
        <li>모바일 데이터 대신 Wi-Fi를 사용해보세요.</li>
        <li>일본 또는 미국 VPN을 사용하는 것을 권장합니다.</li>
    </ul>
</div>

<hr class=\"my-4\">

<strong class=\"d-block mt-3\"><i class=\"bi bi-cone-striped\"></i> Gemini API 사용량 제한</strong>
<p class=\"mt-2 mb-1 text-muted\" style=\"font-size: 0.9rem;\">이 사이트의 AI 기능은 Gemini API를 사용하며, 시간당 사용량 제한이 있습니다. 짧은 시간 동안 많은 요청이 발생하면 일시적으로 사용이 제한될 수 있습니다.</p>
<div class=\"alert alert-light mt-3\">
    <h5 class=\"alert-heading fs-6\"><i class=\"bi bi-lightbulb-fill\"></i> 해결 방법</h5>
    <p class=\"mb-2\">사용량 제한은 보통 1분 내외로 짧습니다. 잠시 후 다시 시도해주세요.</p>
    <ul class=\"mb-0 ps-4\">
        <li>다른 Gemini 모델로 변경해보세요 (모델별로 사용량이 다르게 적용됩니다).</li>
        <li>서버의 공용 API를 사용하는 경우, 여러 사용자가 동시에 사용하므로 제한에 더 자주 도달할 수 있습니다. 개인 API 키를 등록하면 더 쾌적하게 이용 가능합니다.</li>
    </ul>
</div>
`;

/* =========================
   ✅ 전체 로딩 오버레이 관리 로직
   ========================= */
const globalLoadingState = {
    user: false,
    conversations: false,
    notice: false,
    minVisibleUntil: Date.now() + 400,
    checkAndHide() {
        if (this.user && this.conversations && this.notice && Date.now() >= this.minVisibleUntil) {
            hideGlobalLoadingOverlay();
        }
    }
};

function hideGlobalLoadingOverlay() {
    const overlay = document.getElementById('globalLoadingOverlay');
    if (!overlay) return;
    overlay.classList.add('fade-out');
    setTimeout(() => {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }, 400);
}

function setupSidebarContentObservers() {
    const convListEl = document.getElementById('conversationList');
    const noticeEl = document.getElementById('noticeContent');

    if (convListEl) {
        const convObserver = new MutationObserver(() => {
            if (!globalLoadingState.conversations) {
                if (convListEl.childElementCount > 0 || convListEl.textContent.trim().length > 0) {
                    globalLoadingState.conversations = true;
                    globalLoadingState.checkAndHide();
                }
            }
        });
        convObserver.observe(convListEl, { childList: true, subtree: true, characterData: true });
    }

    if (noticeEl) {
        const noticeObserver = new MutationObserver(() => {
            if (!globalLoadingState.notice) {
                if (noticeEl.textContent.trim().length > 0) {
                    globalLoadingState.notice = true;
                    globalLoadingState.checkAndHide();
                }
            }
        });
        noticeObserver.observe(noticeEl, { childList: true, subtree: true, characterData: true });
    }

    // 6초 강제 1차 제거 시도 (에러/빈 데이터 대비)
    setTimeout(() => {
        if (document.getElementById('globalLoadingOverlay')) {
            if (!globalLoadingState.conversations) globalLoadingState.conversations = true;
            if (!globalLoadingState.notice) globalLoadingState.notice = true;
            globalLoadingState.checkAndHide();
        }
    }, 6000);

    // 8초 최종 강제 제거
    setTimeout(() => {
        hideGlobalLoadingOverlay();
    }, 8000);

    // 공지가 정말 비어 있는 사이트일 경우 2.5초에 한 번 더 처리
    setTimeout(() => {
        const el = document.getElementById('noticeContent');
        if (el && el.textContent.trim().length === 0 && !globalLoadingState.notice) {
            globalLoadingState.notice = true;
            globalLoadingState.checkAndHide();
        }
    }, 2500);
}

// 외부 스크립트에서 수동 호출 가능
window.markConversationsLoaded = function () {
    if (!globalLoadingState.conversations) {
        globalLoadingState.conversations = true;
        globalLoadingState.checkAndHide();
    }
};
window.markNoticeLoaded = function () {
    if (!globalLoadingState.notice) {
        globalLoadingState.notice = true;
        globalLoadingState.checkAndHide();
    }
};
/* =========================
   ✅ 전체 로딩 오버레이 관리 로직 끝
   ========================= */

// [추가] 대화 시작 안내/버튼 패널 관리 함수
function updateStartConversationPanel() {
    const panel = document.getElementById('startConversationPanel');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.querySelector('.chat-input');

    if (!currentConversationId) {
        if (panel) panel.style.display = 'flex';
        if (chatMessages) chatMessages.style.display = 'none';
        if (chatInput) chatInput.style.display = 'none';
    } else {
        if (panel) panel.style.display = 'none';
        if (chatMessages) chatMessages.style.display = '';
        if (chatInput) chatInput.style.display = '';
    }
}


// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
    try {
        setupSidebarContentObservers();

        const isAuthenticated = await checkAuthentication();
        if (!isAuthenticated) {
            window.location.href = '/login';
            return;
        }



        await loadUserInfo();
        await loadCharacters();

        if (window.initializeSidebar) {
            try { await window.initializeSidebar(); } catch (e) { console.error(e); }
        }
        if (window.initializeUserCharacters) {
            try { await window.initializeUserCharacters(); } catch (e) { console.error(e); }
        }

        // URL에서 대화 ID 확인 및 로드
        const urlParams = new URLSearchParams(window.location.search);
        const conversationIdFromUrl = urlParams.get('conv');
        if (conversationIdFromUrl) {
            await loadConversation(conversationIdFromUrl);
        }

        // 기존 loadConversations 래핑
        setTimeout(() => {
            if (window.loadConversations && !window._wrappedLoadConversations) {
                const original = window.loadConversations;
                window.loadConversations = async function (...args) {
                    const result = await original.apply(this, args);
                    if (!globalLoadingState.conversations) {
                        globalLoadingState.conversations = true;
                        globalLoadingState.checkAndHide();
                    }
                    updateStartConversationPanel(); // [추가]
                    return result;
                };
                window._wrappedLoadConversations = true;
            }
        }, 100);

        setupEventListeners();

        // 혹시 이미 DOM이 채워져 있는 경우 빠르게 체크
        setTimeout(() => {
            const convListEl = document.getElementById('conversationList');
            if (convListEl && (convListEl.childElementCount > 0 || convListEl.textContent.trim().length > 0)) {
                globalLoadingState.conversations = true;
            }
            const noticeEl = document.getElementById('noticeContent');
            if (noticeEl && noticeEl.textContent.trim().length > 0) {
                globalLoadingState.notice = true;
            }
            globalLoadingState.checkAndHide();
            updateStartConversationPanel(); // [추가]
        }, 300);

        updateStartConversationPanel(); // [추가]

        // [추가] 대화 시작하기 버튼 클릭 이벤트
        const startBtn = document.getElementById('startConversationBtn');
        if (startBtn) {
            startBtn.addEventListener('click', async function () {
                await startNewConversation();
            });
        }

    } catch (error) {
        console.error('초기화 중 오류:', error);
        hideGlobalLoadingOverlay();
        window.location.href = '/login';
    }
});

// HTML 이스케이프 함수
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// 긴 텍스트 처리 (강제 개행 포인트 삽입)
function processLongText(text) {
    return text.replace(/(\S{25,})/g, match => match.replace(/(.{15})/g, '$1&#8203;'));
}

// ✅ 안전하게 단순 이모지 제거
function removeUnicodeEmojis(content) {
    if (!content) return '';
    return content.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|[\u2600-\u26FF]|[\uD83C-\uDBFF][\uDC00-\uDFFF])/g, '');
}

// ✅ 마크다운 제거 함수
function stripMarkdown(input) {
    if (!input) return '';
    let text = input;
    text = text.replace(/``````/g, m => m.replace(/``````$/, ''));
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    text = text.replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\+|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');
    text = text.replace(/^ {0,3}#{1,6}\s+/gm, '');
    text = text.replace(/^ {0,3}>\s?/gm, '');
    text = text.replace(/^ {0,3}([-*+])\s+/gm, '');
    text = text.replace(/^ {0,3}\d+\.\s+/gm, '');
    text = text.replace(/^ {0,3}(-{3,}|_{3,}|\*\*\*)\s*$/gm, '');
    text = text.replace(/^\|.*\|$/gm, line => line.replace(/\|/g, ' ').trim());
    text = text.replace(/^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+$/gm, '');
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1');
    text = text.replace(/<[^>]*>/g, ''); // Remove HTML tags
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

// ✅ 마크다운 → HTML
function markdownToHtml(src) {
    if (!src) return '';
    let text = escapeHtml(src);
    text = text.replace(/``````/g,
        (m, lang, code) => `<pre class=\"md-code-block\"><code${escapeHtml(code).replace(/</g, '&lt;')}</code></pre>`);
    text = text.replace(/`([^`]+)`/g, (m, code) => `<code.class=\"md-inline-code\">${code}</code>`);
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (m, alt) => alt);
    text = text.replace(/!\[([^\]]+)\]\(([^)]+)\)/g, (m, t) => `<span class=\"md-link-text\">${t}</span>`);
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
    text = text.replace(/(\+|_)(.*?)\1/g, '<em>$2</em>');
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');
    text = text.replace(/^ {0,3}###### (.*)$/gm, '<h6>$1</h6>');
    text = text.replace(/^ {0,3}##### (.*)$/gm, '<h5>$1</h5>');
    text = text.replace(/^ {0,3}#### (.*)$/gm, '<h4>$1</h4>');
    text = text.replace(/^ {0,3}### (.*)$/gm, '<h3>$1</h3>');
    text = text.replace(/^ {0,3}## (.*)$/gm, '<h2>$1</h2>');
    text = text.replace(/^ {0,3}# (.*)$/gm, '<h1>$1</h1>');
    text = text.replace(/^ {0,3}>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    text = text.replace(/^ {0,3}(-{3,}|_{3,}|\*\*\*)\s*$/gm, '<hr>');
    text = text.replace(/^\|.*\|$/gm, '');
    text = text.replace(/^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+$/gm, '');
    text = text.replace(/^(\d+)\.\s+(.*)$/gm, '<li data-ol="$1">$2</li>');
    text = text.replace(/^ {0,3}[-*+]\s+(.*)$/gm, '<li>$1</li>');
    text = text.replace(/(<li data-ol="\d+">.*?<\/li>)/gs, m => m);
    text = text.replace(/((?:<li data-ol="\d+">.*?<\/li>\n?)+)/g, block => {
        const replaced = block.replace(/data-ol="\d+"/g, '');
        return `<ol>${replaced}</ol>`;
    });
    text = text.replace(/((?:<li>(?:(?!<\/li>)[\s\S])*?<\/li>\n?)+)/g, block => {
        if (block.includes('<ol>') || block.includes('</ol>')) return block;
        return `<ul>${block}</ul>`;
    });
    text = text.replace(/ data-ol="\d+"/g, '');
    const paragraphs = text
        .split(/\n{2,}/)
        .map(p => (/^\s*(<h\d|<blockquote>|<ul>|<ol>|<pre|<hr>)/.test(p.trim())
            ? p
            : `<p>${p.trim().replace(/\n/g, '<br>')}</p>`))
        .join('\n');
    return paragraphs;
}

// ✅ 마크다운 모드 전체 적용
function applyMarkdownMode() {
    document.querySelectorAll('#chatMessages .message-bubble').forEach(bubble => {
        const parentMsg = bubble.closest('.message');
        if (!parentMsg) return;
        const role =
            parentMsg.classList.contains('assistant') ? 'assistant' :
                parentMsg.classList.contains('user') ? 'user' :
                    parentMsg.classList.contains('system') ? 'system' : '';
        const raw = bubble.getAttribute('data-raw');
        if (raw == null) return;
        if (!showMarkdown) {
            bubble.textContent = stripMarkdown(raw);
        } else {
            if (role === 'system') {
                bubble.textContent = stripMarkdown(raw);
            } else {
                bubble.innerHTML = markdownToHtml(raw);
            }
        }
    });
}

// 인증 상태 확인
async function checkAuthentication() {
    try {
        const response = await fetch('/api/user/info');
        return response.ok;
    } catch (error) {
        console.error('인증 확인 실패:', error);
        return false;
    }
}



// 이벤트 리스너 설정
function setupEventListeners() {
    const messageInput = document.getElementById('messageInput');

    document.getElementById('sendButton').addEventListener('click', () => sendMessage('user'));

    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // 모바일 환경 체크 (화면 너비 또는 User Agent)
                const isMobile = window.matchMedia("(max-width: 768px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                if (isMobile) {
                    // 모바일에서는 기본 동작(줄바꿈) 허용
                    return;
                }
                e.preventDefault();
                document.getElementById('sendButton').click();
            }
        });

        // 클립보드 이미지 붙여넣기 지원
        messageInput.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        showImagePreview(file);
                    }
                }
            }
        });

        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = (messageInput.scrollHeight) + 'px';
        });

        messageInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (document.activeElement !== messageInput) {
                    messageInput.style.height = 'auto';
                }
            }, 0);
        });
    }

    document.getElementById('imageUploadBtn').addEventListener('click', () => {
        if (!userInfo.has_api_key) {
            Swal.fire({
                icon: 'info',
                title: '안내',
                text: '이미지 업로드는 개인 Gemini API 키가 등록된 사용자만 이용할 수 있습니다.',
                confirmButtonColor: '#007bff'
            });
            return;
        }
        document.getElementById('imageInput').click();
    });
    document.getElementById('imageInput').addEventListener('change', handleImageUpload);
    document.getElementById('inviteCharacterBtn').addEventListener('click', showInviteModal);

    // Image preview event listeners
    document.getElementById('cancelImageBtn').addEventListener('click', hideImagePreview);
    document.getElementById('confirmImageBtn').addEventListener('click', confirmImageUpload);
    document.getElementById('editImageBtn').addEventListener('click', () => {
        if (selectedImageFile) {
            initializeImageEditor(selectedImageFile);
            const editorModal = new bootstrap.Modal(document.getElementById('imageEditorModal'));
            editorModal.show();
        }
    });

    const modalSettingsContent = document.getElementById('modalSettingsContent');
    const headerControlsContent = document.getElementById('headerControlsContent');
    if (modalSettingsContent && headerControlsContent) {
        modalSettingsContent.appendChild(headerControlsContent);
        headerControlsContent.style.display = 'block';
        headerControlsContent.classList.remove('collapsed');
    }

    document.getElementById('workModeToggle').addEventListener('change', handleWorkModeToggle);
    const thinkingLevelSelect = document.getElementById('thinkingLevelSelect');
    if (thinkingLevelSelect) {
        thinkingLevelSelect.addEventListener('change', (e) => {
            thinkingLevel = e.target.value;
        });
    }
    document.getElementById('showTimeToggle').addEventListener('change', handleShowTimeToggle);
    document.getElementById('emojiToggle').addEventListener('change', handleEmojiToggle);
    document.getElementById('imageToggle').addEventListener('change', handleImageToggle);

    document.getElementById('editTitleBtn').addEventListener('click', showEditTitleModal);
    document.getElementById('saveTitleBtn').addEventListener('click', saveConversationTitle);

    document.getElementById('situationPromptBtn').addEventListener('click', showSituationPromptModal);
    document.getElementById('saveSituationBtn').addEventListener('click', saveSituationPrompt);
    document.getElementById('clearSituationBtn').addEventListener('click', clearSituationPrompt);



    const mdToggle = document.getElementById('markdownToggle');
    if (mdToggle) mdToggle.addEventListener('change', e => { showMarkdown = e.target.checked; applyMarkdownMode(); });



    document.getElementById('autoReplyToggle').addEventListener('change', handleAutoReplyToggle);
    document.getElementById('continuousResponseToggle').addEventListener('change', handleContinuousResponseToggle);
}

// 이모지 토글
function handleEmojiToggle(e) {
    const chatContainer = document.querySelector('.chat-container');
    if (e.target.checked) chatContainer.classList.remove('hide-emojis');
    else chatContainer.classList.add('hide-emojis');
}

// 이미지 토글
function handleImageToggle(e) {
    console.log('이미지 토글 상태:', e.target.checked);
}

async function handleWorkModeToggle(e) {
    const isWorkMode = e.target.checked;
    currentWorkMode = isWorkMode;


    if (!currentConversationId) return;
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/work-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workMode: isWorkMode })
        });
        if (response.ok) {
            updateWorkModeUI(isWorkMode);
        } else {
            e.target.checked = !isWorkMode;
            currentWorkMode = !isWorkMode;
        }
    } catch {
        e.target.checked = !isWorkMode;
        currentWorkMode = !isWorkMode;
    }
}

// 시간 정보 토글
async function handleShowTimeToggle(e) {
    const showTime = e.target.checked;
    currentShowTime = showTime;
    if (!currentConversationId) return;
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/show-time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showTime })
        });
        if (!response.ok) {
            e.target.checked = !showTime;
            currentShowTime = !showTime;
        }
    } catch {
        e.target.checked = !showTime;
        currentShowTime = !showTime;
    }
}

// 제목 수정 모달
function showEditTitleModal() {
    if (!currentConversationId) {
        Swal.fire({
            icon: 'warning',
            text: '먼저 대화를 시작해주세요.'
        });
        return;
    }
    const modal = new bootstrap.Modal(document.getElementById('editTitleModal'));
    const input = document.getElementById('newTitleInput');
    const currentTitle = document.getElementById('conversationTitle').textContent;
    input.value = currentTitle === '세카이 채팅' ? '' : currentTitle;
    modal.show();
    setTimeout(() => { input.focus(); input.select(); }, 300);
}

// 대화 제목 저장
async function saveConversationTitle() {
    const newTitle = document.getElementById('newTitleInput').value.trim();
    if (!newTitle) {
        Swal.fire({
            icon: 'warning',
            text: '제목을 입력해주세요.'
        });
        return;
    }
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/title`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle })
        });
        if (response.ok) {
            document.getElementById('conversationTitle').textContent = newTitle;
            bootstrap.Modal.getInstance(document.getElementById('editTitleModal')).hide();
            if (window.loadConversations) await window.loadConversations();
        } else {
            Swal.fire({
                icon: 'error',
                text: '제목 수정 실패'
            });
        }
    } catch {
        Swal.fire({
            icon: 'error',
            text: '제목 수정 실패'
        });
    }
}

// 상황 프롬프트 모달
function showSituationPromptModal() {
    if (!currentConversationId) {
        Swal.fire({
            icon: 'warning',
            text: '먼저 대화를 시작해주세요.'
        });
        return;
    }
    const modal = new bootstrap.Modal(document.getElementById('situationPromptModal'));
    const input = document.getElementById('situationPromptInput');
    input.value = currentSituationPrompt;



    modal.show();
    setTimeout(() => input.focus(), 300);
}

// 상황 프롬프트 저장
async function saveSituationPrompt() {
    const prompt = document.getElementById('situationPromptInput').value.trim();
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/situation-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ situationPrompt: prompt })
        });
        if (response.ok) {
            currentSituationPrompt = prompt;
            bootstrap.Modal.getInstance(document.getElementById('situationPromptModal')).hide();
            Swal.fire({
                icon: 'success',
                text: prompt ? '상황 설정이 저장되었습니다.' : '상황 설정이 삭제되었습니다.'
            });
        } else {
            Swal.fire({
                icon: 'error',
                text: '상황 설정 저장 실패'
            });
        }
    } catch {
        Swal.fire({
            icon: 'error',
            text: '상황 설정 저장 실패'
        });
    }
}

// 상황 프롬프트 삭제
async function clearSituationPrompt() {
    const result = await Swal.fire({
        title: '상황 설정 삭제',
        text: '상황 설정을 삭제하시겠습니까?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '삭제',
        cancelButtonText: '취소'
    });

    if (!result.isConfirmed) return;
    document.getElementById('situationPromptInput').value = '';
    await saveSituationPrompt();
}

async function handleAutoReplyToggle(e) {
    const isEnabled = e.target.checked;
    autoReplyModeEnabled = isEnabled;

    // 연속응답 체크박스 표시/숨김
    const continuousContainer = document.getElementById('continuousResponseContainer');
    if (isEnabled) {
        continuousContainer.style.display = 'block';
    } else {
        continuousContainer.style.display = 'none';
    }

    if (!currentConversationId) return;
    try {
        await fetch(`/api/conversations/${currentConversationId}/auto-reply-mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoReplyMode: isEnabled })
        });
    } catch {
        e.target.checked = !isEnabled;
        autoReplyModeEnabled = !isEnabled;
        // 실패 시 원래 상태로 되돌리기
        if (!isEnabled) {
            continuousContainer.style.display = 'block';
        } else {
            continuousContainer.style.display = 'none';
        }
    }
}

function handleContinuousResponseToggle(e) {
    continuousResponseEnabled = e.target.checked;
}




// 작업 모드 UI
function updateWorkModeUI(isWorkMode) {
    const chatContainer = document.querySelector('.chat-container');
    if (isWorkMode) chatContainer.classList.add('work-mode-active');
    else chatContainer.classList.remove('work-mode-active');
}

// 사용자 정보 로드
async function loadUserInfo() {
    try {
        const response = await fetch('/api/user/info');
        if (response.ok) {
            userInfo = await response.json();
            window.userInfo = userInfo;

            // API 키 형식 검증 결과 확인 및 경고 표시
            if (userInfo.has_api_key && !userInfo.api_key_valid) {
                showSnackbar(`API 키 형식 오류: ${userInfo.api_key_error}`, 'warning');
            }

            updateImageUploadButton();
            if (!globalLoadingState.user) {
                globalLoadingState.user = true;
                globalLoadingState.checkAndHide();
            }
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (e) {
        console.error('사용자 정보 로드 실패:', e);
        window.location.href = '/login';
    }
}

// 캐릭터 목록 로드
async function loadCharacters() {
    try {
        const response = await fetch('/api/characters/extended');
        if (response.ok) {
            availableCharacters = await response.json();
            window.availableCharacters = availableCharacters;
        } else {
            const fallbackResponse = await fetch('/api/characters');
            if (fallbackResponse.ok) {
                availableCharacters = await fallbackResponse.json();
                window.availableCharacters = availableCharacters;
            }
        }
    } catch {
        try {
            const fallbackResponse = await fetch('/api/characters');
            if (fallbackResponse.ok) {
                availableCharacters = await fallbackResponse.json();
                window.availableCharacters = availableCharacters;
            }
        } catch (e) {
            console.error('캐릭터 로드 실패(최종):', e);
        }
    }
}

// 대화 로드
async function loadConversation(id) {
    if (window.matchMedia("(max-width: 992px)").matches) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
    }
    currentConversationId = id;
    awaitingResponse = false;
    autoCallInProgress = false;
    window.currentConversationId = currentConversationId;

    // URL 업데이트
    const url = new URL(window.location);
    url.searchParams.set('conv', id);
    history.pushState({ conversationId: id }, '', url);

    try {
        const response = await fetch(`/api/conversations/${id}`);
        if (response.ok) {
            const conversationData = await response.json();
            let messages = [];
            let workModeValue = 0;
            let showTimeValue = 1;
            let situationPrompt = '';
            let autoReplyMode = 0;
            if (conversationData.messages) {
                messages = conversationData.messages;
                workModeValue = conversationData.work_mode || 0;
                showTimeValue = conversationData.show_time_info !== undefined ? conversationData.show_time_info : 1;
                situationPrompt = conversationData.situation_prompt || '';
                autoReplyMode = conversationData.auto_reply_mode_enabled || 0;
            } else if (Array.isArray(conversationData)) {
                messages = conversationData;
            }
            currentWorkMode = !!workModeValue;
            currentShowTime = !!showTimeValue;
            currentSituationPrompt = situationPrompt;
            autoReplyModeEnabled = !!autoReplyMode;
            document.getElementById('workModeToggle').checked = currentWorkMode;
            document.getElementById('showTimeToggle').checked = currentShowTime;
            document.getElementById('autoReplyToggle').checked = autoReplyModeEnabled;

            // 자동 답변 모드 상태에 따라 연속응답 체크박스 표시/숨김
            const continuousContainer = document.getElementById('continuousResponseContainer');
            if (autoReplyModeEnabled) {
                continuousContainer.style.display = 'block';
            } else {
                continuousContainer.style.display = 'none';
            }


            updateWorkModeUI(currentWorkMode);
            const messagesDiv = document.getElementById('chatMessages');
            messagesDiv.innerHTML = '';
            await loadConversationParticipants(id);
            messages.forEach(msg => {
                if (msg.message_type === 'image' && msg.filename) {
                    const cleanContent = removeUnicodeEmojis(msg.content);
                    addImageMessage(msg.role, cleanContent, `/api/images/${msg.filename}`, msg.id);
                } else {
                    const cleanContent = removeUnicodeEmojis(msg.content);
                    addMessage(msg.role, cleanContent, msg.character_name, msg.character_image, msg.auto_call_sequence, msg.id);
                }
            });
            let conversationTitle = '세카이 채팅';
            if (window.allConversations) {
                const currentConv = window.allConversations.find(conv => conv.id === id);
                if (currentConv && currentConv.title) {
                    conversationTitle = removeUnicodeEmojis(currentConv.title);
                }
            }
            document.getElementById('conversationTitle').textContent = conversationTitle;
            if (window.loadConversations) await window.loadConversations();
            applyMarkdownMode();

            updateStartConversationPanel(); // [추가]
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('대화 로드 오류:', error);
        Swal.fire({ icon: 'error', text: '대화 로드 중 오류가 발생했습니다.' });
    }
}

// 대화 참여자 로드
async function loadConversationParticipants(conversationId) {
    try {
        const response = await fetch(`/api/conversations/${conversationId}/participants`);
        if (response.ok) {
            currentCharacters = await response.json();
            window.currentCharacters = currentCharacters;
            updateInvitedCharactersUI();
        }
    } catch (error) {
        console.error('참여자 로드 실패:', error);
        currentCharacters = [];
        window.currentCharacters = [];
    }
}

// 메시지 전송
async function sendMessage(role = 'user') {
    if (awaitingUserMessageResponse) return;

    if (generationAbortController) {
        generationAbortController.abort();
        generationAbortController = null;
    }
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;

    if (!currentConversationId) {
        await startNewConversation();
        if (!currentConversationId) {
            Swal.fire({ icon: 'error', text: '대화 생성 실패' });
            return;
        }
    }

    const cleanMessage = removeUnicodeEmojis(message);
    const tempMessageBubble = addMessage(role, cleanMessage);
    input.value = '';
    input.style.height = 'auto';

    awaitingUserMessageResponse = true;
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, conversationId: currentConversationId, role })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.message) {
                if (tempMessageBubble) {
                    const temp = tempMessageBubble.closest('.message');
                    if (temp) temp.remove();
                }
                addMessage(role, data.message.content, null, null, 0, data.message.id);
                await triggerAutoReply();
            }
            awaitingResponse = true; // This seems to be for stream, keeping it.
            if (window.loadConversations) await window.loadConversations();
            if (currentCharacters.length === 0) {
                addMessage('system', '캐릭터를 초대한 후 캐릭터 프로필을 클릭하여 응답을 생성하세요.');
            }
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            alert('메시지 전송 실패');
        }
    } catch (error) {
        console.error('메시지 전송 오류:', error);
        alert('메시지 전송 중 오류가 발생했습니다.');
    } finally {
        awaitingUserMessageResponse = false;
    }
}

// 캐릭터 응답 생성 (스트리밍 + 일반 응답 양쪽 지원)
async function generateCharacterResponse(characterId) {
    if (autoCallInProgress) return;

    if (generationAbortController) {
        generationAbortController.abort();
    }
    generationAbortController = new AbortController();
    const signal = generationAbortController.signal;

    const character = currentCharacters.find(c => c.id === characterId) ||
        availableCharacters.find(c => c.id === characterId);

    // 메시지 버블 생성 (생성 중임을 알리는 '...'를 전달하여 플레이스홀더 표시)
    const contentElement = addMessage('assistant', '...', character?.name, character?.profile_image);

    try {
        const requestBody = {
            characterId,
            conversationId: currentConversationId,
            workMode: currentWorkMode,
            showTime: currentShowTime,
            situationPrompt: currentSituationPrompt,
            isContinuous: continuousResponseEnabled,
            thinkingLevel
        };

        const imageToggle = document.getElementById('imageToggle');
        if (imageToggle.checked && lastUploadedImageData) {
            requestBody.imageData = lastUploadedImageData;
        }

        const response = await fetch('/api/chat/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        // Content-Type 확인하여 스트리밍/일반 응답 분기
        const contentType = response.headers.get('Content-Type') || '';
        const isStreaming = contentType.includes('text/event-stream');

        if (isStreaming) {
            // SSE 스트리밍 처리
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';
            let messageId = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'chunk') {
                                fullText += data.text;
                                if (contentElement) {
                                    // 첫 번째 청크가 도착하면 플레이스홀더 제거
                                    if (contentElement.classList.contains('has-placeholder')) {
                                        contentElement.classList.remove('has-placeholder');
                                        contentElement.innerHTML = '';
                                    }

                                    if (showMarkdown) {
                                        contentElement.innerHTML = markdownToHtml(fullText);
                                    } else {
                                        contentElement.textContent = stripMarkdown(fullText);
                                    }
                                    contentElement.dataset.raw = fullText;
                                }
                                const messagesDiv = document.getElementById('chatMessages');
                                const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 100;
                                if (isNearBottom) {
                                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                                }

                            } else if (data.type === 'fallback') {
                                fullText = data.text;
                                if (contentElement) {
                                    if (contentElement.classList.contains('has-placeholder')) {
                                        contentElement.classList.remove('has-placeholder');
                                        contentElement.innerHTML = '';
                                    }
                                    if (showMarkdown) {
                                        contentElement.innerHTML = markdownToHtml(fullText);
                                    } else {
                                        contentElement.textContent = stripMarkdown(fullText);
                                    }
                                    contentElement.dataset.raw = fullText;
                                }

                            } else if (data.type === 'done') {
                                messageId = data.messageId;

                                if (contentElement) {
                                    const messageEl = contentElement.closest('.message');
                                    if (messageEl) {
                                        messageEl.dataset.messageId = messageId;
                                        // ✅ Inject delete and TTS buttons
                                        const actionsDiv = messageEl.querySelector('.message-actions');
                                        if (actionsDiv) {
                                            const characterName = messageEl.querySelector('.message-avatar')?.alt || character?.name;
                                            const delBtn = `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
                                                <i class="bi bi-trash-fill"></i>
                                            </button>`;
                                            actionsDiv.innerHTML = delBtn;
                                        }
                                    }
                                }



                            } else if (data.type === 'error') {
                                console.error('서버 에러:', data.error);
                                // fullText가 있으면 이미 내용을 받은 것이므로 메시지를 유지
                                if (fullText && fullText.trim().length > 0) {
                                    showSnackbar('응답 생성 중 일부 오류가 발생했습니다.', 'warning');
                                    // 메시지는 유지하고 경고만 표시
                                } else {
                                    // 아무 내용도 받지 못했을 때만 에러 모달 표시
                                    if (contentElement) {
                                        const el = contentElement.closest('.message');
                                        if (el) el.remove();
                                    }
                                    showErrorModal(GEMINI_ERROR_GUIDANCE);
                                    return;
                                }
                            }
                        } catch (parseError) {
                            console.warn('SSE 파싱 에러:', parseError, line);
                        }
                    }
                }
            }
        } else {
            // 일반 JSON 응답 처리
            const data = await response.json();

            if (data.newMessage) {
                if (contentElement) {
                    if (contentElement.classList.contains('has-placeholder')) {
                        contentElement.classList.remove('has-placeholder');
                    }
                    contentElement.innerHTML = markdownToHtml(data.newMessage.content);
                    contentElement.dataset.raw = data.newMessage.content;
                }
                if (contentElement) {
                    const messageEl = contentElement.closest('.message');
                    if (messageEl) {
                        const messageId = data.newMessage?.id || data.id;
                        messageEl.dataset.messageId = messageId;
                        // ✅ Inject delete and TTS buttons
                        const actionsDiv = messageEl.querySelector('.message-actions');
                        if (actionsDiv) {
                            const characterName = messageEl.querySelector('.message-avatar')?.alt || character?.name;
                            const delBtn = `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
                                <i class="bi bi-trash-fill"></i>
                            </button>`;
                            actionsDiv.innerHTML = delBtn;
                        }
                    }
                }
            } else if (data.response) {
                // 기존 응답 형식 호환
                if (contentElement) {
                    contentElement.innerHTML = markdownToHtml(data.response);
                    contentElement.dataset.raw = data.response;
                }
            }


        }

        awaitingResponse = false;
        if (window.loadConversations) await window.loadConversations();

    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Character response generation aborted.');
            if (contentElement) {
                const el = contentElement.closest('.message');
                if (el) el.remove();
            }
            return;
        }
        console.error('캐릭터 응답 생성 오류:', err);
        if (contentElement) {
            const el = contentElement.closest('.message');
            if (el) el.remove();
        }
        showErrorModal(GEMINI_ERROR_GUIDANCE);
    } finally {
        generationAbortController = null;
    }
}

async function triggerAutoReply() {
    if (!autoReplyModeEnabled || autoCallInProgress) return;

    console.log('[Auto-Reply] Starting...');
    if (generationAbortController) {
        generationAbortController.abort();
    }
    generationAbortController = new AbortController();
    const signal = generationAbortController.signal;

    autoCallInProgress = true;

    try {
        const maxSequence = continuousResponseEnabled ? (userInfo?.max_auto_call_sequence || 1) : 1;
        let autoCallCount = 0;

        while (autoCallCount < maxSequence) {
            if (signal.aborted) {
                console.log('[Auto-Reply] Aborted.');
                break;
            }
            console.log(`[Auto-Reply] Loop ${autoCallCount + 1}/${maxSequence}`);

            // 1. Select next speaker
            console.log('[Auto-Reply] Selecting speaker...');
            const selectResponse = await fetch('/api/chat/auto-reply/select-speaker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversationId: currentConversationId,
                    autoCallCount: autoCallCount,
                    maxSequence: maxSequence,
                    isContinuous: continuousResponseEnabled
                }),
                signal
            });

            if (!selectResponse.ok) {
                console.error('[Auto-Reply] Speaker selection failed.', selectResponse.status);
                break;
            }

            const selectData = await selectResponse.json();
            console.log('[Auto-Reply] Speaker selection data:', selectData);
            const speaker = selectData.speaker;

            if (!speaker) {
                console.log(`[Auto-Reply] No speaker selected. Reason: ${selectData.reason || 'unknown'}. Ending sequence.`);
                break;
            }
            console.log(`[Auto-Reply] Speaker selected: ${speaker.name}`);

            // 2. 메시지 버블 생성 (플레이스홀더 표시를 위해 '...' 전달)
            const contentElement = addMessage('assistant', '...', speaker.name, speaker.profile_image);

            // 3. Generate the actual message
            console.log(`[Auto-Reply] Generating message for ${speaker.name}...`);

            const generationPayload = {
                characterId: speaker.id,
                conversationId: currentConversationId,
                workMode: currentWorkMode,
                showTime: currentShowTime,
                situationPrompt: currentSituationPrompt,
                autoCallCount: autoCallCount + 1,
                isContinuous: continuousResponseEnabled,
                thinkingLevel: thinkingLevel
            };
            console.log('[Auto-Reply] Generation payload:', generationPayload);

            const generationResponse = await fetch('/api/chat/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(generationPayload),
                signal
            });

            if (!generationResponse.ok) {
                console.error('[Auto-Reply] Message generation failed.', generationResponse.status);
                if (contentElement) {
                    const el = contentElement.closest('.message');
                    if (el) el.remove();
                }
                addMessage('system', GEMINI_ERROR_GUIDANCE);
                break;
            }

            // Content-Type 확인하여 스트리밍/일반 응답 분기
            const contentType = generationResponse.headers.get('Content-Type') || '';
            const isStreaming = contentType.includes('text/event-stream');
            let generatedImages = [];

            if (isStreaming) {
                // SSE 스트리밍 처리
                const reader = generationResponse.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';
                let buffer = '';
                let messageId = null;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                if (data.type === 'chunk') {
                                    fullText += data.text;
                                    if (contentElement) {
                                        // 첫 번째 청크 도착 시 플레이스홀더 제거
                                        if (contentElement.classList.contains('has-placeholder')) {
                                            contentElement.classList.remove('has-placeholder');
                                            contentElement.innerHTML = '';
                                        }

                                        if (showMarkdown) {
                                            contentElement.innerHTML = markdownToHtml(fullText);
                                        } else {
                                            contentElement.textContent = stripMarkdown(fullText);
                                        }
                                        contentElement.dataset.raw = fullText;
                                    }
                                    const messagesDiv = document.getElementById('chatMessages');
                                    const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 100;
                                    if (isNearBottom) {
                                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                                    }

                                } else if (data.type === 'fallback') {
                                    fullText = data.text;
                                    if (contentElement) {
                                        if (contentElement.classList.contains('has-placeholder')) {
                                            contentElement.classList.remove('has-placeholder');
                                            contentElement.innerHTML = '';
                                        }
                                        if (showMarkdown) {
                                            contentElement.innerHTML = markdownToHtml(fullText);
                                        } else {
                                            contentElement.textContent = stripMarkdown(fullText);
                                        }
                                        contentElement.dataset.raw = fullText;
                                    }

                                } else if (data.type === 'done') {
                                    messageId = data.messageId;
                                    generatedImages = data.generatedImages || [];

                                    if (contentElement) {
                                        const messageEl = contentElement.closest('.message');
                                        if (messageEl) {
                                            messageEl.dataset.messageId = messageId;
                                            // ✅ [ADD] Inject delete and TTS buttons
                                            const actionsDiv = messageEl.querySelector('.message-actions');
                                            if (actionsDiv) {
                                                const characterName = messageEl.querySelector('.message-avatar')?.alt || speaker.name;
                                                const ttsBtn = createTTSButton(characterName, fullText, messageId);
                                                const delBtn = `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
                                                    <i class="bi bi-trash-fill"></i>
                                                </button>`;
                                                actionsDiv.innerHTML = ttsBtn + delBtn;
                                            }
                                        }
                                    }

                                } else if (data.type === 'error') {
                                    console.error('[Auto-Reply] 서버 에러:', data.error);
                                    if (contentElement) {
                                        const el = contentElement.closest('.message');
                                        if (el) el.remove();
                                    }
                                    break;
                                }
                            } catch (parseError) {
                                console.warn('[Auto-Reply] SSE 파싱 에러:', parseError, line);
                            }
                        }
                    }
                }
            } else {
                // 일반 JSON 응답 처리
                const data = await generationResponse.json();
                console.log('[Auto-Reply] Generation response data:', data);

                if (data.newMessage) {
                    if (contentElement) {
                        if (contentElement.classList.contains('has-placeholder')) {
                            contentElement.classList.remove('has-placeholder');
                        }
                        contentElement.innerHTML = markdownToHtml(data.newMessage.content);
                        contentElement.dataset.raw = data.newMessage.content;
                    }
                    if (contentElement) {
                        const messageEl = contentElement.closest('.message');
                        if (messageEl) {
                            const messageId = data.newMessage?.id || data.id;
                            messageEl.dataset.messageId = messageId;
                            // ✅ Inject delete and TTS buttons
                            const actionsDiv = messageEl.querySelector('.message-actions');
                            if (actionsDiv) {
                                const characterName = messageEl.querySelector('.message-avatar')?.alt || speaker.name;
                                const ttsBtn = createTTSButton(characterName, data.newMessage?.content || data.response, messageId);
                                const delBtn = `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
                                    <i class="bi bi-trash-fill"></i>
                                </button>`;
                                actionsDiv.innerHTML = ttsBtn + delBtn;
                            }
                        }
                    }
                } else if (data.response) {
                    if (contentElement) {
                        contentElement.innerHTML = markdownToHtml(data.response);
                        contentElement.dataset.raw = data.response;
                    }
                }

                generatedImages = data.generatedImages || [];
            }

            // 이미지 처리
            if (generatedImages.length > 0) {
                setImageGenerationCooldown();
                for (const image of generatedImages) {
                    await updateCharacterProfileImage(speaker.id, image.url);
                }
            }

            autoCallCount++;

            // Small delay between auto-replies
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Auto-reply failed catastrophically:', error);
            addMessage('system', '자동 답변 중 오류가 발생했습니다.');
        }
    } finally {
        console.log('[Auto-Reply] Ending.');
        autoCallInProgress = false;
        generationAbortController = null;
    }
}

// 자동 호출 처리


// 캐릭터 초대 모달
function showInviteModal() {
    if (!currentConversationId) { Swal.fire({ icon: 'warning', text: '먼저 대화를 시작해주세요.' }); return; }
    const modal = new bootstrap.Modal(document.getElementById('inviteModal'));
    const container = document.getElementById('availableCharacters');
    container.innerHTML = '';
    const invitedKeys = new Set(currentCharacters.map(c => {
        const type = (c.character_type === 'official') ? 'official' : 'user';
        return `${type}-${c.id}`;
    }));
    const available = availableCharacters.filter(character => {
        const type = (character.category === 'official') ? 'official' : 'user';
        const key = `${type}-${character.id}`;
        return !invitedKeys.has(key);
    });
    if (available.length === 0) {
        container.innerHTML = '<p class="text-center">초대할 수 있는 캐릭터가 없습니다.</p>';
    } else {
        available.forEach(character => {
            const card = document.createElement('div');
            card.className = 'character-card';
            let categoryBadge = '';
            if (character.category === 'my_character') {
                categoryBadge = '<span class="badge bg-success">내 캐릭터</span>';
            }
            const characterTypeForAPI = (character.category === 'official') ? 'official' : 'user';
            card.innerHTML = `
                <img src="${character.profile_image}" alt="${escapeHtml(character.name)}" class="character-card-avatar" onerror="this.src='/images/characters/kanade.webp'">
                <div class="character-card-info">
                    <h6>${escapeHtml(character.name)} ${categoryBadge}</h6>
                    ${character.nickname ? `<p>${escapeHtml(character.nickname)}</p>` : ''}
                </div>
                <button class="btn btn-primary btn-sm" onclick="inviteCharacter(${character.id}, '${characterTypeForAPI}')">초대</button>
            `;
            container.appendChild(card);
        });
    }
    modal.show();
}

// 캐릭터 초대
async function inviteCharacter(characterId, characterType) {
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId, characterType })
        });
        if (response.ok) {
            await loadConversationParticipants(currentConversationId);
            bootstrap.Modal.getInstance(document.getElementById('inviteModal')).hide();
        } else {
            alert('캐릭터 초대 실패');
        }
    } catch {
        alert('캐릭터 초대 실패');
    }
}

// 초대된 캐릭터 UI
function updateInvitedCharactersUI() {
    const container = document.getElementById('invitedCharacters');
    container.innerHTML = '';
    if (currentCharacters.length === 0) {
        container.innerHTML = '<p class="no-characters-text">초대된 캐릭터가 없습니다. 캐릭터를 초대해보세요!</p>';
        return;
    }
    currentCharacters.forEach(character => {
        const avatarContainer = document.createElement('div');
        avatarContainer.className = 'character-avatar-container';
        avatarContainer.title = `${character.name} - 클릭하여 응답 생성`;
        avatarContainer.onclick = () => generateCharacterResponse(character.id);
        const avatar = document.createElement('img');
        avatar.src = character.profile_image;
        avatar.alt = character.name;
        avatar.className = 'invited-character-avatar clickable';
        avatar.onerror = function () { this.src = '/images/characters/kanade.webp'; };
        avatarContainer.appendChild(avatar);
        container.appendChild(avatarContainer);
    });
    updateImageGenerationUI();
}

// 새 대화 시작
async function startNewConversation() {
    if (window.matchMedia("(max-width: 992px)").matches) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
    }
    try {
        const response = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (response.ok) {
            const data = await response.json();
            currentConversationId = data.id;
            window.currentConversationId = currentConversationId;
            currentCharacters = [];
            window.currentCharacters = [];
            lastUploadedImageData = null;
            awaitingResponse = false;
            autoCallInProgress = false;
            currentWorkMode = false;
            currentShowTime = true;
            currentSituationPrompt = '';
            document.getElementById('workModeToggle').checked = false;
            document.getElementById('showTimeToggle').checked = true;
            updateWorkModeUI(false);
            document.getElementById('chatMessages').innerHTML = '';
            document.getElementById('conversationTitle').textContent = '세카이 채팅';
            updateInvitedCharactersUI();
            if (window.loadConversations) await window.loadConversations();
            applyMarkdownMode();
            updateStartConversationPanel(); // [추가]

            // URL에서 conv 파라미터 제거
            const url = new URL(window.location);
            url.searchParams.delete('conv');
            history.pushState({}, '', url);

        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            alert('대화 생성 실패');
        }
    } catch {
        alert('대화 생성 실패');
    }
}

// 이미지 업로드 처리
// Image preview variables
let selectedImageFile = null;
let editedImageData = null;
let imageEditorCanvas = null;
let imageEditorCtx = null;
let originalImageData = null;
let currentRotation = 0;
let cropMode = false;
let cropStartX = 0;
let cropStartY = 0;
let cropEndX = 0;
let cropEndY = 0;
let cropSelection = null;

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!userInfo.has_api_key) {
        Swal.fire({ icon: 'info', text: '이미지 업로드는 개인 Gemini API 키가 등록된 사용자만 이용할 수 있습니다.' });
        return;
    }

    if (!validateImageFile(file)) {
        Swal.fire({ icon: 'warning', text: '지원하지 않는 형식이거나 5MB 초과입니다.' });
        return;
    }

    // Show image preview instead of immediate upload
    showImagePreview(file);

    // Clear the input
    event.target.value = '';
}

// Show image preview
function showImagePreview(file) {
    selectedImageFile = file;
    editedImageData = null;

    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('imagePreview');
    const previewName = document.getElementById('imagePreviewName');
    const previewSize = document.getElementById('imagePreviewSize');

    // Create object URL for preview
    const objectUrl = URL.createObjectURL(file);
    previewImg.src = objectUrl;
    previewName.textContent = file.name;
    previewSize.textContent = formatFileSize(file.size);

    previewContainer.style.display = 'block';

    // Scroll to preview
    previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Hide image preview
function hideImagePreview() {
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('imagePreview');

    previewContainer.style.display = 'none';

    // Clean up object URL
    if (previewImg.src.startsWith('blob:')) {
        URL.revokeObjectURL(previewImg.src);
    }

    selectedImageFile = null;
    editedImageData = null;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize image editor
function initializeImageEditor(file) {
    imageEditorCanvas = document.getElementById('imageEditorCanvas');
    imageEditorCtx = imageEditorCanvas.getContext('2d');

    const img = new Image();
    img.onload = function () {
        // Set canvas size maintaining aspect ratio
        const maxWidth = 600;
        const maxHeight = 400;
        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width *= ratio;
            height *= ratio;
        }

        imageEditorCanvas.width = width;
        imageEditorCanvas.height = height;

        // Store original image data
        originalImageData = {
            img: img,
            width: width,
            height: height
        };

        // Reset editor state
        resetEditor();
        drawImage();

        // Setup event listeners for editor controls
        setupImageEditorControls();
    };

    img.src = URL.createObjectURL(file);
}

// Setup image editor controls
function setupImageEditorControls() {
    const rotateLeftBtn = document.getElementById('rotateLeftBtn');
    const rotateRightBtn = document.getElementById('rotateRightBtn');
    const cropModeBtn = document.getElementById('cropModeBtn');
    const applyCropBtn = document.getElementById('applyCropBtn');
    const resetEditorBtn = document.getElementById('resetEditorBtn');
    const applyEditorBtn = document.getElementById('applyEditorBtn');

    // Remove existing event listeners to prevent duplicates
    rotateLeftBtn.replaceWith(rotateLeftBtn.cloneNode(true));
    rotateRightBtn.replaceWith(rotateRightBtn.cloneNode(true));
    cropModeBtn.replaceWith(cropModeBtn.cloneNode(true));
    applyCropBtn.replaceWith(applyCropBtn.cloneNode(true));
    resetEditorBtn.replaceWith(resetEditorBtn.cloneNode(true));
    applyEditorBtn.replaceWith(applyEditorBtn.cloneNode(true));

    // Re-get elements after replacement
    const newRotateLeftBtn = document.getElementById('rotateLeftBtn');
    const newRotateRightBtn = document.getElementById('rotateRightBtn');
    const newCropModeBtn = document.getElementById('cropModeBtn');
    const newApplyCropBtn = document.getElementById('applyCropBtn');
    const newResetEditorBtn = document.getElementById('resetEditorBtn');
    const newApplyEditorBtn = document.getElementById('applyEditorBtn');

    newRotateLeftBtn.addEventListener('click', () => {
        currentRotation -= 90;
        drawImage();
    });

    newRotateRightBtn.addEventListener('click', () => {
        currentRotation += 90;
        drawImage();
    });

    newCropModeBtn.addEventListener('click', () => {
        toggleCropMode();
    });

    newApplyCropBtn.addEventListener('click', () => {
        applyCrop();
    });

    newResetEditorBtn.addEventListener('click', () => {
        resetEditor();
        drawImage();
    });

    newApplyEditorBtn.addEventListener('click', () => {
        applyEditorChanges();
    });

    // Add canvas event listeners for cropping
    setupCanvasEventListeners();
}

// Reset editor state
function resetEditor() {
    currentRotation = 0;
    cropMode = false;
    clearCropSelection();
    const cropModeBtn = document.getElementById('cropModeBtn');
    const applyCropBtn = document.getElementById('applyCropBtn');
    if (cropModeBtn) {
        cropModeBtn.innerHTML = '<i class="bi bi-crop"></i> 크롭 영역 선택';
        cropModeBtn.classList.remove('btn-warning');
        cropModeBtn.classList.add('btn-outline-primary');
    }
    if (applyCropBtn) {
        applyCropBtn.style.display = 'none';
    }
    if (imageEditorCanvas) {
        imageEditorCanvas.classList.remove('crop-mode');
    }
}

// Draw image with current transformations
function drawImage() {
    if (!originalImageData || !imageEditorCtx) return;

    const { img, width, height } = originalImageData;

    // Clear canvas
    imageEditorCtx.clearRect(0, 0, imageEditorCanvas.width, imageEditorCanvas.height);

    // Save context
    imageEditorCtx.save();

    // Apply transformations
    imageEditorCtx.translate(imageEditorCanvas.width / 2, imageEditorCanvas.height / 2);
    imageEditorCtx.rotate((currentRotation * Math.PI) / 180);

    // Draw image
    imageEditorCtx.drawImage(img, -width / 2, -height / 2, width, height);

    // Restore context
    imageEditorCtx.restore();
}

// Toggle crop mode
function toggleCropMode() {
    cropMode = !cropMode;
    const cropModeBtn = document.getElementById('cropModeBtn');
    const applyCropBtn = document.getElementById('applyCropBtn');

    if (cropMode) {
        cropModeBtn.innerHTML = '<i class="bi bi-x-circle"></i> 크롭 취소';
        cropModeBtn.classList.remove('btn-outline-primary');
        cropModeBtn.classList.add('btn-warning');
        imageEditorCanvas.classList.add('crop-mode');
        clearCropSelection();
    } else {
        cropModeBtn.innerHTML = '<i class="bi bi-crop"></i> 크롭 영역 선택';
        cropModeBtn.classList.remove('btn-warning');
        cropModeBtn.classList.add('btn-outline-primary');
        imageEditorCanvas.classList.remove('crop-mode');
        clearCropSelection();
        applyCropBtn.style.display = 'none';
    }
}

// Setup canvas event listeners for cropping
function setupCanvasEventListeners() {
    if (!imageEditorCanvas) return;

    let isDrawing = false;

    const getMousePos = (canvas, evt) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    };

    const getTouchPos = (canvas, touch) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    };

    const startDrawing = (pos) => {
        if (!cropMode) return;
        cropStartX = pos.x;
        cropStartY = pos.y;
        isDrawing = true;
        clearCropSelection();
    };

    const draw = (pos) => {
        if (!cropMode || !isDrawing) return;
        cropEndX = pos.x;
        cropEndY = pos.y;
        updateCropSelection();
    };

    const stopDrawing = (pos) => {
        if (!cropMode || !isDrawing) return;
        isDrawing = false;
        cropEndX = pos.x;
        cropEndY = pos.y;
        updateCropSelection();

        const applyCropBtn = document.getElementById('applyCropBtn');
        if (applyCropBtn && Math.abs(cropEndX - cropStartX) > 10 && Math.abs(cropEndY - cropStartY) > 10) {
            applyCropBtn.style.display = 'inline-block';
        }
    };

    // Mouse events
    imageEditorCanvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(imageEditorCanvas, e);
        startDrawing(pos);
        e.preventDefault();
    });

    imageEditorCanvas.addEventListener('mousemove', (e) => {
        const pos = getMousePos(imageEditorCanvas, e);
        draw(pos);
        e.preventDefault();
    });

    imageEditorCanvas.addEventListener('mouseup', (e) => {
        const pos = getMousePos(imageEditorCanvas, e);
        stopDrawing(pos);
        e.preventDefault();
    });

    // Touch events
    imageEditorCanvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const pos = getTouchPos(imageEditorCanvas, e.touches[0]);
            startDrawing(pos);
            e.preventDefault();
        }
    });

    imageEditorCanvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            const pos = getTouchPos(imageEditorCanvas, e.touches[0]);
            draw(pos);
            e.preventDefault();
        }
    });

    imageEditorCanvas.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 1) {
            const pos = getTouchPos(imageEditorCanvas, e.changedTouches[0]);
            stopDrawing(pos);
            e.preventDefault();
        }
    });
}

// Update crop selection overlay
function updateCropSelection() {
    clearCropSelection();

    if (!cropMode) return;

    const container = imageEditorCanvas.parentElement;
    const rect = imageEditorCanvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const x = Math.min(cropStartX, cropEndX);
    const y = Math.min(cropStartY, cropEndY);
    const width = Math.abs(cropEndX - cropStartX);
    const height = Math.abs(cropEndY - cropStartY);

    if (width < 5 || height < 5) return;

    cropSelection = document.createElement('div');
    cropSelection.className = 'crop-selection';
    cropSelection.style.left = (rect.left - containerRect.left + x) + 'px';
    cropSelection.style.top = (rect.top - containerRect.top + y) + 'px';
    cropSelection.style.width = width + 'px';
    cropSelection.style.height = height + 'px';

    container.appendChild(cropSelection);
}

// Clear crop selection
function clearCropSelection() {
    if (cropSelection) {
        cropSelection.remove();
        cropSelection = null;
    }
}

// Apply crop to image
function applyCrop() {
    if (!cropMode || !originalImageData) return;

    const x = Math.min(cropStartX, cropEndX);
    const y = Math.min(cropStartY, cropEndY);
    const width = Math.abs(cropEndX - cropStartX);
    const height = Math.abs(cropEndY - cropStartY);

    if (width < 10 || height < 10) {
        Swal.fire({ icon: 'warning', text: '크롭 영역이 너무 작습니다.' });
        return;
    }

    // Create temporary canvas for cropping
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    // Set temp canvas size to crop dimensions
    tempCanvas.width = width;
    tempCanvas.height = height;

    // Draw the cropped area from the current canvas state
    tempCtx.drawImage(imageEditorCanvas, x, y, width, height, 0, 0, width, height);

    // Update main canvas with cropped image
    imageEditorCanvas.width = width;
    imageEditorCanvas.height = height;
    imageEditorCtx.drawImage(tempCanvas, 0, 0);

    // Update original image data
    const croppedImage = new Image();
    croppedImage.onload = function () {
        originalImageData = {
            img: croppedImage,
            width: width,
            height: height
        };
        currentRotation = 0; // Reset rotation after crop
        toggleCropMode(); // Exit crop mode
        drawImage(); // Redraw the image
    };
    croppedImage.src = tempCanvas.toDataURL();
}

// Apply editor changes
function applyEditorChanges() {
    // Convert canvas to blob
    imageEditorCanvas.toBlob((blob) => {
        // Create new file from edited image
        const editedFile = new File([blob], selectedImageFile.name, {
            type: selectedImageFile.type,
            lastModified: Date.now()
        });

        editedImageData = editedFile;

        // Update preview with edited image
        const previewImg = document.getElementById('imagePreview');
        previewImg.src = URL.createObjectURL(editedFile);

        // Close editor modal
        bootstrap.Modal.getInstance(document.getElementById('imageEditorModal')).hide();
    }, selectedImageFile.type, 0.9);
}

// Confirm image upload
async function confirmImageUpload() {
    const fileToUpload = editedImageData || selectedImageFile;

    if (!currentConversationId) {
        await startNewConversation();
        if (!currentConversationId) {
            Swal.fire({ icon: 'error', text: '대화방 생성 실패' });
            return;
        }
    }

    const uploadModal = new bootstrap.Modal(document.getElementById('uploadModal'));

    try {
        uploadModal.show();

        const formData = new FormData();
        formData.append('file', fileToUpload);
        formData.append('conversationId', currentConversationId);

        const uploadResponse = await fetch('/api/upload/direct', {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) throw new Error('업로드 실패');

        const { imageUrl, fileName } = await uploadResponse.json();
        const base64Data = await fileToBase64(fileToUpload);

        lastUploadedImageData = {
            base64Data,
            mimeType: fileToUpload.type,
            fileName: fileToUpload.name
        };

        const cleanFileName = removeUnicodeEmojis(fileToUpload.name);
        addImageMessage('user', cleanFileName, imageUrl);

        if (window.loadConversations) await window.loadConversations();
        addMessage('system', '이미지가 업로드되었습니다. 메시지를 입력하면 캐릭터가 이미지를 참고합니다.');

        // Hide preview
        hideImagePreview();

    } catch (e) {
        console.error(e);
        Swal.fire({ icon: 'error', text: '업로드 실패' });
    } finally {
        uploadModal.hide();
    }
}
function addImageMessage(role, fileName, imageUrl, messageId = null, characterName = null, characterImage = null) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    const cleanFileName = removeUnicodeEmojis(fileName);
    const escapedFileName = escapeHtml(cleanFileName);

    // Create image control buttons (expand, download, delete)
    const expandButtonHtml = `<button class="image-expand-btn" onclick="expandImage('${imageUrl}', '${escapedFileName}')" title="이미지 확대">
        <i class="bi bi-arrows-fullscreen"></i>
    </button>`;

    const downloadButtonHtml = `<button class="image-download-btn" onclick="downloadImage('${imageUrl}', '${escapedFileName}')" title="이미지 다운로드">
        <i class="bi bi-download"></i>
    </button>`;

    const deleteButtonHtml = messageId ?
        `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
            <i class="bi bi-trash-fill"></i>
        </button>` : '';

    // Create consistent message-actions structure for both user and assistant
    const imageActionsHtml = `<div class="message-actions">
        ${expandButtonHtml}
        ${downloadButtonHtml}
        ${deleteButtonHtml}
    </div>`;

    if (role === 'user') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="image-message">
                    <img src="${imageUrl}" alt="${escapedFileName}" class="uploaded-image" onclick="expandImage('${imageUrl}', '${escapedFileName}')" style="cursor: pointer;">
                    <div class="image-info">${escapedFileName}</div>
                </div>
                ${imageActionsHtml}
            </div>`;
    } else {
        const avatarSrc = characterImage || '/images/characters/ena.webp';
        const avatarAlt = characterName || '에나';

        messageDiv.innerHTML = `
            <img src="${avatarSrc}" alt="${escapeHtml(avatarAlt)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
            <div class="message-content">
                <div class="image-message">
                    <img src="${imageUrl}" alt="${escapedFileName}" class="uploaded-image" onclick="expandImage('${imageUrl}', '${escapedFileName}')" style="cursor: pointer;">
                    <div class="image-info">${escapedFileName}</div>
                </div>
                ${imageActionsHtml}
            </div>`;
    }
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 메시지 삭제
async function deleteMessage(messageId, messageElement) {
    const result = await Swal.fire({
        title: '메시지 삭제',
        text: '이 메시지를 삭제하시겠습니까?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '삭제',
        cancelButtonText: '취소'
    });

    if (!result.isConfirmed) return;
    try {
        const response = await fetch(`/api/messages/${messageId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
        if (response.ok) {
            messageElement.remove();
            if (window.loadConversations) await window.loadConversations();
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else alert('메시지 삭제 실패');
    } catch {
        alert('메시지 삭제 실패');
    }
}

// 커스텀 이모지 HTML
function createCustomEmojiHTML(emojiFileName) {
    const emojiId = `emoji_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return `<div class="custom-emoji" id="container_${emojiId}">
        <img src="/images/emojis/${emojiFileName}"
             alt="emoji"
             class="emoji-image"
             id="${emojiId}"
             onerror="handleEmojiLoadError('${emojiId}')">
    </div>`;
}

function handleEmojiLoadError(emojiId) {
    const emojiImg = document.getElementById(emojiId);
    const emojiContainer = document.getElementById(`container_${emojiId}`);
    if (emojiImg) emojiImg.classList.add('failed-to-load');
    if (emojiContainer) emojiContainer.classList.add('hidden');
}

// 커스텀 이모지 파싱
function parseCustomEmoji(content) {
    const emojiRegex = /::([\uAC00-\uD7A3\w\s\-_\(\)!]+\.(jpg|jpeg|png|gif|webp))::/i;
    const match = content.match(emojiRegex);
    if (match) {
        const emojiFileName = match[1];
        const text = content.replace(emojiRegex, '').trim();
        return { text, emoji: emojiFileName };
    }
    return { text: content, emoji: null };
}

// 이미지 로딩 플레이스홀더 추가
function addImageLoadingPlaceholder(characterName, characterImage) {
    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant image-loading-message'; // Special class to find it later

    let avatarSrc = characterImage || '/images/characters/kanade.webp';
    let altText = characterName || '캐릭터';

    messageDiv.innerHTML = `
        <img src="${avatarSrc}" alt="${escapeHtml(altText)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
        <div class="message-content">
            <div class="message-bubble image-loading-placeholder">
                <div class="image-loading-spinner-container">
                    <div class="spinner-border" role="status"></div>
                    <i class="bi bi-image"></i>
                </div>
            </div>
        </div>`;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv; // Return the element so it can be removed
}

// 메시지 추가
function addMessage(role, content, characterName = null, characterImage = null, autoCallSequence = 0, messageId = null) {
    // 대체 동작: 서버/서드파티에서 보내는 "더미" 보조 메시지 (예: "으....이...." 같은) 가
    // 저장되지 않은 보조 응답으로 화면에 남는 것을 방지하기 위해 해당 경우 시스템 안내 메시지로 대체합니다.
    if (role === 'assistant' && (!messageId) && typeof content === 'string') {
        const rawTrim = content.trim();
        // 정확히 "으....이...." 문자열을 대체 (필요 시 패턴을 확장 가능)
        if (rawTrim === '으....이....') {
            role = 'system';
            content = GEMINI_ERROR_GUIDANCE;
        }
    }

    const messagesDiv = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    if (autoCallSequence > 0) {
        messageDiv.classList.add('auto-called-message');
        messageDiv.setAttribute('data-auto-sequence', autoCallSequence);
    }
    const cleanedContent = removeUnicodeEmojis(content);
    const { text, emoji } = parseCustomEmoji(cleanedContent);
    const rawForMarkdown = text;
    const plainProcessed = stripMarkdown(rawForMarkdown);
    const escapedPlain = escapeHtml(plainProcessed);
    const processedText = processLongText(escapedPlain);
    const deleteButtonHtml = role !== 'system' && messageId ?
        `<button class="message-delete-btn" onclick="deleteMessage(${messageId}, this.closest('.message'))" title="메시지 삭제">
            <i class="bi bi-trash-fill"></i>
        </button>` : '';

    if (role === 'assistant') {
        let avatarSrc = '/images/characters/kanade.webp';
        let altText = '카나데';
        if (characterImage) avatarSrc = characterImage;
        if (characterName) altText = characterName;

        const isLoadingPlaceholder = typeof rawForMarkdown === 'string' && rawForMarkdown.trim().startsWith('...');

        if (isLoadingPlaceholder) {
            // 로딩 UI: Bootstrap의 placeholder-glow 애니메이션 사용
            messageDiv.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHtml(altText)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
                <div class="message-content">
                    <div class="message-bubble has-placeholder" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g, '&quot;')}" aria-live="polite" aria-label="답변 생성 중">
                        <p class="card-text placeholder-glow mb-0">
                            <span class="placeholder col-7"></span>
                            <span class="placeholder col-4"></span>
                            <span class="placeholder col-4"></span>
                            <span class="placeholder col-6"></span>
                        </p>
                    </div>
                    <div class="message-actions"></div>
                </div>`;
        } else {
            messageDiv.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHtml(altText)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
                <div class="message-content">
                    <div class="message-bubble" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g, '&quot;')}">
                        ${showMarkdown ? markdownToHtml(rawForMarkdown) : processedText}
                    </div>
                    ${emoji ? createCustomEmojiHTML(emoji) : ''}
                    <div class="message-actions">
                        ${deleteButtonHtml}
                    </div>
                </div>`;
        }
    } else if (role === 'system') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble system-message" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g, '&quot;')}">${processedText}</div>
            </div>`;
    } else if (role === 'situation') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble situation-message" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g, '&quot;')}"><i class="bi bi-card-text"></i> ${processedText}</div>
            </div>`;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g, '&quot;')}">
                    ${showMarkdown ? markdownToHtml(rawForMarkdown) : processedText}
                </div>
                ${emoji ? createCustomEmojiHTML(emoji) : ''}
                <div class="message-actions">
                    ${deleteButtonHtml}
                </div>
            </div>`;
    }
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return messageDiv.querySelector('.message-bubble');
}

// 생성된 이미지를 캐릭터 프로필 이미지로 자동 적용
async function updateCharacterProfileImage(characterId, imageUrl) {
    try {
        const urlMatch = imageUrl.match(/.\/api\/images\/generated\/(.+)$/);
        if (!urlMatch) return false;
        const imageKey = `generated_images/${urlMatch[1]}`;
        const character = currentCharacters.find(c => c.id === characterId) ||
            availableCharacters.find(c => c.id === characterId);
        if (!character) return false;
        if (character.character_type !== 'user') return false;
        const updateResponse = await fetch(`/api/user/characters/${characterId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: character.name,
                description: character.description,
                systemPrompt: character.system_prompt,
                profileImageR2: imageKey
            })
        });
        if (!updateResponse.ok) return false;
        character.profile_image_r2 = imageKey;
        character.profile_image = `/api/user-characters/image/${imageKey}`;
        updateInvitedCharactersUI();
        if (typeof updateHeaderCharacterAvatars === 'function') {
            try { updateHeaderCharacterAvatars(); } catch (e) { }
        }
        addMessage('system', `✨ ${character.name}의 프로필 이미지가 업데이트되었습니다!`);
        return true;
    } catch (error) {
        console.error('프로필 이미지 업데이트 오류:', error);
        return false;
    }
}

// 유틸
function validateImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024;
    if (!allowedTypes.includes(file.type)) return false;
    if (file.size > maxSize || file.size <= 0) return false;
    return true;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}



function updateImageUploadButton() {
    const uploadBtn = document.getElementById('imageUploadBtn');
    if (!uploadBtn) return;
    if (userInfo.has_api_key) {
        uploadBtn.style.opacity = '1';
        uploadBtn.style.cursor = 'pointer';
        uploadBtn.title = '이미지 업로드';
    } else {
        uploadBtn.style.opacity = '0.5';
        uploadBtn.style.cursor = 'not-allowed';
        uploadBtn.title = '개인 API 키가 필요합니다';
    }
}

// 에러 모달 표시 함수
function showErrorModal(message) {
    const errorModalEl = document.getElementById('errorModal');
    if (!errorModalEl) return;
    const errorModal = new bootstrap.Modal(errorModalEl);
    const errorModalBody = document.getElementById('errorModalBody');
    if (errorModalBody) {
        errorModalBody.innerHTML = message;
    }
    errorModal.show();
}

// Image expand and download functions
function expandImage(imageUrl, fileName) {
    // Create modal for expanded image view
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="bi bi-image"></i> ${escapeHtml(fileName)}
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="닫기"></button>
                </div>
                <div class="modal-body text-center p-0">
                    <img src="${imageUrl}" alt="${escapeHtml(fileName)}" class="img-fluid" style="max-height: 70vh; width: auto;">
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="downloadImage('${imageUrl}', '${fileName}')">
                        <i class="bi bi-download"></i> 다운로드
                    </button>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">닫기</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();

    // Remove modal from DOM when hidden
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

function downloadImage(imageUrl, fileName) {
    try {
        // Create a temporary link element for download
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = fileName || 'image.png';
        link.target = '_blank';

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSnackbar('이미지 다운로드를 시작합니다.', 'success');
    } catch (error) {
        console.error('이미지 다운로드 실패:', error);
        showSnackbar('이미지 다운로드에 실패했습니다.', 'warning');
    }
}



// 전역 노출
window.loadConversation = loadConversation;
window.startNewConversation = startNewConversation;
window.handleEmojiLoadError = handleEmojiLoadError;
window.deleteMessage = deleteMessage;
window.updateInvitedCharactersUI = updateInvitedCharactersUI;
window.inviteCharacter = inviteCharacter;

window.expandImage = expandImage;
window.downloadImage = downloadImage;