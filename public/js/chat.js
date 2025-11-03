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
let imageGenerationEnabled = false;
let affectionSystemEnabled = false;
let autoragMemoryEnabled = false;
let autoReplyModeEnabled = true;
let continuousResponseEnabled = false; // 기본값은 false (연속응답 비활성화)
let awaitingUserMessageResponse = false;
let proModeEnabled = false;
let generationAbortController = null;

let isGeneratingTTS = false;

function showSnackbar(message, type = 'info') { // type: 'info', 'warning', 'success'
    const snackbar = document.getElementById('snackbar');
    if (!snackbar) return;
    snackbar.textContent = message;

    snackbar.classList.remove('warning', 'success');
    if (type === 'warning') {
        snackbar.classList.add('warning');
    } else if (type === 'success') {
        snackbar.classList.add('success');
    }

    snackbar.classList.add('show');

    setTimeout(function() {
        snackbar.classList.remove('show');
    }, 3000);
}

// TTS handling function
async function handleTTS(characterNameCode, messageText, messageId) {
    if (isGeneratingTTS) {
        showSnackbar('TTS가 이미 생성 중입니다. 잠시 후 다시 시도해주세요.', 'warning');
        return;
    }

    isGeneratingTTS = true;
    showSnackbar('TTS 생성을 시작합니다...');

    try {
        const cleanText = stripMarkdown(messageText).replace(/\s+/g, ' ').trim();

        if (!cleanText) {
            throw new Error('음성으로 변환할 텍스트가 없습니다.');
        }

        const maxLength = 200;
        const baseText = cleanText.length > maxLength ?
            cleanText.substring(0, maxLength) + '...' : cleanText;

        let processedText = await processTextForTTS(baseText);

        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: processedText,
                character_name_code: characterNameCode,
                language: 'japanese'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'TTS 생성 실패');
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            showSnackbar('오디오 재생에 실패했습니다.', 'warning');
        };

        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
        };

        await audio.play();
        showSnackbar('TTS 생성 완료!', 'success');

    } catch (error) {
        console.error('TTS 오류:', error);
        showSnackbar(error.message, 'warning');
    } finally {
        isGeneratingTTS = false;
    }
}

// 🔧 이미지 생성 쿨다운 관리
let lastImageGeneration = null;
const IMAGE_COOLDOWN_SECONDS = 20;

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
window.markConversationsLoaded = function() {
    if (!globalLoadingState.conversations) {
        globalLoadingState.conversations = true;
        globalLoadingState.checkAndHide();
    }
};
window.markNoticeLoaded = function() {
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

// 이미지 생성 쿨다운 확인 함수
function isImageGenerationOnCooldown() {
    if (!lastImageGeneration) return false;
    const now = Date.now();
    const elapsed = now - lastImageGeneration;
    return elapsed < (IMAGE_COOLDOWN_SECONDS * 1000);
}

// 남은 쿨다운 시간 계산 (초 단위)
function getRemainingImageCooldown() {
    if (!lastImageGeneration) return 0;
    const now = Date.now();
    const elapsed = now - lastImageGeneration;
    const remaining = Math.max(0, (IMAGE_COOLDOWN_SECONDS * 1000) - elapsed);
    return Math.ceil(remaining / 1000);
}

// 이미지 생성 쿨다운 설정
function setImageGenerationCooldown() {
    lastImageGeneration = Date.now();
}



// 이미지 생성 지원 캐릭터 확인
function supportsImageGeneration(characterId, characterType) {
    const character = availableCharacters.find(c => c.id === characterId && (c.category === characterType || (c.is_user_character && characterType === 'user') || (!c.is_user_character && characterType === 'official')));
    if (character) {
        return character.supports_image_generation;
    }
    // If not in availableCharacters, check currentCharacters
    const currentCharacter = currentCharacters.find(c => c.id === characterId && c.character_type === characterType);
    if (currentCharacter) {
        return currentCharacter.supports_image_generation;
    }
    return false;
}

// 현재 대화에 이미지 생성 지원 캐릭터 있는지
function hasImageGenerationSupport() {
    return currentCharacters.some(char => char.supports_image_generation);
}

// 이미지 생성 UI 업데이트
function updateImageGenerationUI() {
    const imgGenToggle = document.getElementById('imageGenerationToggle');
    const imgGenSection = document.querySelector('.image-toggle-section');
    if (!imgGenToggle || !imgGenSection) return;

    const hasSupport = hasImageGenerationSupport();
    if (!hasSupport) {
        imgGenToggle.disabled = true;
        imgGenToggle.checked = false;
        imageGenerationEnabled = false;
        imgGenSection.style.opacity = '0.5';
        imgGenSection.title = '현재 대화에 이미지 생성을 지원하는 캐릭터가 없습니다. (에나, 호나미, 또는 커스텀 캐릭터 필요)';
    } else {
        imgGenToggle.disabled = false;
        imgGenSection.style.opacity = '1';
        imgGenSection.title = '이미지 생성을 지원하는 캐릭터가 있습니다!';
        if (!imageGenerationEnabled) {
            imgGenToggle.checked = true;
            imageGenerationEnabled = true;
        }
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
            try { await window.initializeSidebar(); } catch(e){ console.error(e); }
        }
        if (window.initializeUserCharacters) {
            try { await window.initializeUserCharacters(); } catch(e){ console.error(e); }
        }


        // 기존 loadConversations 래핑
        setTimeout(() => {
            if (window.loadConversations && !window._wrappedLoadConversations) {
                const original = window.loadConversations;
                window.loadConversations = async function(...args) {
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
        updateImageGenerationUI();

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
            startBtn.addEventListener('click', async function() {
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
        (m, lang, code) => `<pre class=\"md-code-block\"><code${escapeHtml(code).replace(/</g,'&lt;')}</code></pre>`);
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

function handleImageGenerationToggle(e) {
    imageGenerationEnabled = e.target.checked;
    updateImageGenerationUI();
}

// 이벤트 리스너 설정
function setupEventListeners() {
    document.getElementById('sendButton').addEventListener('click', () => sendMessage('user'));
    document.getElementById('messageInput').addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('imageUploadBtn').addEventListener('click', () => {
        if (!userInfo.has_api_key) {
            alert('이미지 업로드는 개인 Gemini API 키가 등록된 사용자만 이용할 수 있습니다.');
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
    document.getElementById('proModeToggle').addEventListener('change', (e) => {
        proModeEnabled = e.target.checked;
    });
    document.getElementById('showTimeToggle').addEventListener('change', handleShowTimeToggle);
    document.getElementById('emojiToggle').addEventListener('change', handleEmojiToggle);
    document.getElementById('imageToggle').addEventListener('change', handleImageToggle);
    document.getElementById('imageGenerationToggle').addEventListener('change', handleImageGenerationToggle);

    document.getElementById('editTitleBtn').addEventListener('click', showEditTitleModal);
    document.getElementById('saveTitleBtn').addEventListener('click', saveConversationTitle);

    document.getElementById('situationPromptBtn').addEventListener('click', showSituationPromptModal);
    document.getElementById('saveSituationBtn').addEventListener('click', saveSituationPrompt);
    document.getElementById('clearSituationBtn').addEventListener('click', clearSituationPrompt);



    const mdToggle = document.getElementById('markdownToggle');
    if (mdToggle) mdToggle.addEventListener('change', e => { showMarkdown = e.target.checked; applyMarkdownMode(); });

    const affectionToggle = document.getElementById('affectionToggle');
    if (affectionToggle) affectionToggle.addEventListener('change', handleAffectionToggle);

    const affectionBtn = document.getElementById('affectionBtn');
    if (affectionBtn) affectionBtn.addEventListener('click', showAffectionModal);

    const autoragToggle = document.getElementById('autoragMemoryToggle');
    if (autoragToggle) autoragToggle.addEventListener('change', handleAutoragMemoryToggle);

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
    const proModeSection = document.getElementById('proModeToggleSection');
    if (proModeSection) {
        if (isWorkMode) {
            proModeSection.style.display = 'block';
        } else {
            proModeSection.style.display = 'none';
            const proModeToggle = document.getElementById('proModeToggle');
            if (proModeToggle) {
                proModeToggle.checked = false;
            }
            proModeEnabled = false;
        }
    }

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
            if (proModeSection) {
                proModeSection.style.display = currentWorkMode ? 'block' : 'none';
            }
        }
    } catch {
        e.target.checked = !isWorkMode;
        currentWorkMode = !isWorkMode;
        if (proModeSection) {
            proModeSection.style.display = currentWorkMode ? 'block' : 'none';
        }
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
    if (!currentConversationId) { alert('먼저 대화를 시작해주세요.'); return; }
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
    if (!newTitle) { alert('제목을 입력해주세요.'); return; }
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
        } else alert('제목 수정 실패');
    } catch {
        alert('제목 수정 실패');
    }
}

// 상황 프롬프트 모달
function showSituationPromptModal() {
    if (!currentConversationId) { alert('먼저 대화를 시작해주세요.'); return; }
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
            alert(prompt ? '상황 설정이 저장되었습니다.' : '상황 설정이 삭제되었습니다.');
        } else alert('상황 설정 저장 실패');
    } catch {
        alert('상황 설정 저장 실패');
    }
}

// 상황 프롬프트 삭제
async function clearSituationPrompt() {
    if (!confirm('상황 설정을 삭제하시겠습니까?')) return;
    document.getElementById('situationPromptInput').value = '';
    await saveSituationPrompt();
}

// 호감도 시스템 토글
async function handleAffectionToggle(e) {
    const useAffectionSys = e.target.checked;
    if (!currentConversationId) {
        e.target.checked = false;
        alert('먼저 대화를 시작해주세요.');
        return;
    }

    try {
        const response = await fetch('/api/affection/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: currentConversationId,
                useAffectionSys
            })
        });

        if (response.ok) {
            affectionSystemEnabled = useAffectionSys;
            updateAffectionUI();
            if (useAffectionSys) {
                addMessage('system', '호감도 시스템이 활성화되었습니다. 대화 내용에 따라 캐릭터의 호감도가 변화합니다.');
            } else {
                addMessage('system', '호감도 시스템이 비활성화되었습니다.');
            }
        } else {
            e.target.checked = !useAffectionSys;
            alert('호감도 시스템 설정 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('호감도 시스템 토글 실패:', error);
        e.target.checked = !useAffectionSys;
        alert('호감도 시스템 설정 변경에 실패했습니다.');
    }
}

async function handleAutoragMemoryToggle(e) {
    const useAutoragMemory = e.target.checked;
    if (!currentConversationId) {
        e.target.checked = false;
        alert('먼저 대화를 시작해주세요.');
        return;
    }

    try {
        const response = await fetch('/api/conversations/autorag-memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: currentConversationId,
                useAutoragMemory
            })
        });

        if (response.ok) {
            autoragMemoryEnabled = useAutoragMemory;
            if (useAutoragMemory) {
                addMessage('system', '스토리 기억 기능이 활성화되었습니다.');
            } else {
                addMessage('system', '스토리 기억 기능이 비활성화되었습니다.');
            }
        } else {
            e.target.checked = !useAutoragMemory;
            alert('스토리 기억 설정 변경에 실패했습니다.');
        }
    } catch (error) {
        console.error('스토리 기억 토글 실패:', error);
        e.target.checked = !useAutoragMemory;
        alert('스토리 기억 설정 변경에 실패했습니다.');
    }
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

// 호감도 관리 모달 표시
async function showAffectionModal() {
    if (!currentConversationId) {
        alert('먼저 대화를 시작해주세요.');
        return;
    }

    const modal = new bootstrap.Modal(document.getElementById('affectionModal'));
    modal.show();

    // 호감도 상태 로드
    await loadAffectionStatus();
}

// 호감도 상태 로드
async function loadAffectionStatus() {
    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/affection`);
        if (response.ok) {
            const data = await response.json();
            updateAffectionModal(data);
        } else {
            console.error('호감도 상태 로드 실패');
        }
    } catch (error) {
        console.error('호감도 상태 로드 중 오류:', error);
    }
}

// 호감도 모달 업데이트 (수정됨)
function updateAffectionModal(data) {
    const statusDiv = document.getElementById('affectionSystemStatus');
    const characterList = document.getElementById('affectionCharacterList');

    if (!data.use_affection_sys) {
        statusDiv.innerHTML = `<div class=\"alert alert-info\"><i class=\"bi bi-info-circle\"></i> 호감도 시스템이 비활성화되어 있습니다.</div>`;
        characterList.innerHTML = '';
        return;
    }

    statusDiv.innerHTML = `<div class=\"alert alert-success\"><i class=\"bi bi-check-circle\"></i> 호감도 시스템이 활성화되어 있습니다.</div>`;

    if (data.participants.length === 0) {
        characterList.innerHTML = `<div class=\"text-center py-4 text-muted\"><i class=\"bi bi-person-plus fs-2\"></i><p class=\"mt-2\">대화에 참여한 캐릭터가 없습니다.</p></div>`;
        return;
    }

    characterList.innerHTML = '';
    data.participants.forEach(p => {
        const level = p.affection_level ?? 0;
        const type = p.affection_type || 'friendship';
        const isTypeSelectionDisabled = level < -10;

        const characterDiv = document.createElement('div');
        characterDiv.className = 'character-affection-item';
        characterDiv.innerHTML = `
            <img src="${p.profile_image}" alt="${escapeHtml(p.name)}" class="character-affection-avatar" onerror="this.src='/images/characters/default.webp'">
            <div class="character-affection-info">
                <div class="character-affection-name">${escapeHtml(p.name)}</div>
                <div class="character-affection-level">${getAffectionLevelText(level, type)}</div>
                <div class="affection-type-group mt-2">
                    <button class="btn btn-sm ${type === 'friendship' ? 'btn-primary' : 'btn-outline-primary'} ${isTypeSelectionDisabled ? 'disabled' : ''}"
                            onclick="updateAffectionType(this, 'friendship', ${p.character_id}, '${p.character_type}')">우정</button>
                    <button class="btn btn-sm ${type === 'love' ? 'btn-danger' : 'btn-outline-danger'} ${isTypeSelectionDisabled ? 'disabled' : ''}"
                            onclick="updateAffectionType(this, 'love', ${p.character_id}, '${p.character_type}')">애정</button>
                </div>
            </div>
            <div class="affection-controls">
                <div class="affection-adjust-buttons">
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', -5)">-5</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', -3)">-3</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', -1)">-1</button>
                </div>
                <div class="affection-value-container">
                    <span class="affection-value ${getAffectionClass(level)}" onclick="enableAffectionInput(this, ${p.character_id}, '${p.character_type}')">${level}</span>
                </div>
                <div class="affection-adjust-buttons">
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', 1)">+1</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', 3)">+3</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="adjustAffection(${p.character_id}, '${p.character_type}', 5)">+5</button>
                </div>
            </div>
        `;
        characterList.appendChild(characterDiv);
    });
}

// 호감도 수준 텍스트 반환 (수정됨)
function getAffectionLevelText(level, type) {
    // 음수 범위 - 3단계
    if (level < -50) return '최악';
    if (level < -20) return '부정적';
    if (level < -10) return '약간 부정적';

    // 중립 범위 (-10 ~ +10)
    if (level >= -10 && level <= 10) return '중립';

    // 양수 범위 - 3단계 (우정/애정 분리 유지)
    if (level < 30) return type === 'love' ? '약간 호감 (애정)' : '약간 긍정 (우정)';
    if (level < 70) return type === 'love' ? '긍정적 (애정)' : '긍정적 (우정)';
    return type === 'love' ? '매우 긍정 (애정)' : '매우 긍정 (우정)';
}

// 호감도 수준 CSS 클래스 반환 (수정됨)
function getAffectionClass(level) {
    if (level < -10) return 'affection-hostile';
    if (level >= -10 && level <= 10) return 'affection-neutral';
    if (level < 70) return 'affection-positive';
    return 'affection-loving';
}

// 호감도 버튼으로 조절
async function adjustAffection(characterId, characterType, amount) {
    const characterItem = document.querySelector(`[onclick*=\"adjustAffection(${characterId}, '${characterType}'\"]`).closest('.character-affection-item');
    const valueSpan = characterItem.querySelector('.affection-value');
    let currentValue = parseInt(valueSpan.textContent);
    let newValue = currentValue + amount;

    // 값 범위 제한
    newValue = Math.max(-100, Math.min(100, newValue));

    await updateAffectionLevel(characterId, characterType, newValue);
}

function enableAffectionInput(span, characterId, characterType) {
    const currentValue = span.textContent;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'affection-input form-control';
    input.value = currentValue;
    input.min = -100;
    input.max = 100;

    span.style.display = 'none';
    span.parentNode.insertBefore(input, span.nextSibling);
    input.focus();

    const save = async () => {
        let newValue = parseInt(input.value);
        if (isNaN(newValue)) {
            newValue = currentValue;
        }
        newValue = Math.max(-100, Math.min(100, newValue));

        input.remove();
        span.style.display = '';

        await updateAffectionLevel(characterId, characterType, newValue);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            save();
        }
    });
}

// 호감도 수준 변경 (수정됨)
async function updateAffectionLevel(characterId, characterType, affectionLevel) {
    try {
        const response = await fetch('/api/affection/adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentConversationId, characterId, characterType, affectionLevel })
        });
        if (!response.ok) {
            const errorData = await response.json();
            alert(`호감도 조절 실패: ${errorData.error}`);
            await loadAffectionStatus();
            return;
        }

        // 성공 후 상태 다시 로드 (서버 값으로 최종 동기화)
        await loadAffectionStatus();
    } catch (error) {
        console.error('호감도 업데이트 실패:', error);
        alert('호감도 업데이트 중 오류가 발생했습니다.');
        await loadAffectionStatus(); // 실패 시 원래 값으로 복원
    }
}

// 호감도 타입 변경 (신규)
async function updateAffectionType(button, type, characterId, characterType) {
    if (button.classList.contains('disabled')) return;

    try {
        const response = await fetch('/api/affection/type', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentConversationId, characterId, characterType, affectionType: type })
        });
        if (!response.ok) throw new Error('타입 변경 실패');

        // 성공 후 상태 다시 로드
        await loadAffectionStatus();
    } catch (error) {
        console.error('호감도 타입 변경 실패:', error);
        await loadAffectionStatus();
    }
}


// 호감도 UI 업데이트
function updateAffectionUI() {
    const affectionBtn = document.getElementById('affectionBtn');
    if (affectionBtn) {
        if (affectionSystemEnabled) {
            affectionBtn.style.opacity = '1';
            affectionBtn.disabled = false;
        } else {
            affectionBtn.style.opacity = '0.5';
            affectionBtn.disabled = true;
        }
    }
}

// 호감도 시스템 상태 로드 (대화 로드 시 호출)
async function loadAffectionSystemState() {
    if (!currentConversationId) return;

    try {
        const response = await fetch(`/api/conversations/${currentConversationId}/affection`);
        if (response.ok) {
            const data = await response.json();
            affectionSystemEnabled = !!data.use_affection_sys;
            document.getElementById('affectionToggle').checked = affectionSystemEnabled;
            updateAffectionUI();
        }
    } catch (error) {
        console.error('호감도 시스템 상태 로드 실패:', error);
        affectionSystemEnabled = false;
        document.getElementById('affectionToggle').checked = false;
        updateAffectionUI();
    }
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
        } catch(e) {
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
    try {
        const response = await fetch(`/api/conversations/${id}`);
        if (response.ok) {
            const conversationData = await response.json();
            let messages = [];
            let workModeValue = 0;
            let showTimeValue = 1;
            let situationPrompt = '';
            let autoReplyMode = 0;
            let autoragMemory = 0;
            if (conversationData.messages) {
                messages = conversationData.messages;
                workModeValue = conversationData.work_mode || 0;
                showTimeValue = conversationData.show_time_info !== undefined ? conversationData.show_time_info : 1;
                situationPrompt = conversationData.situation_prompt || '';
                autoReplyMode = conversationData.auto_reply_mode_enabled || 0;
                autoragMemory = conversationData.use_autorag_memory || 0;
            } else if (Array.isArray(conversationData)) {
                messages = conversationData;
            }
            currentWorkMode = !!workModeValue;
            currentShowTime = !!showTimeValue;
            currentSituationPrompt = situationPrompt;
            autoReplyModeEnabled = !!autoReplyMode;
            autoragMemoryEnabled = !!autoragMemory;
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

            const autoragToggle = document.getElementById('autoragMemoryToggle');
            if (autoragToggle) autoragToggle.checked = autoragMemoryEnabled;
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
            // 호감도 시스템 상태 로드
            await loadAffectionSystemState();
            updateStartConversationPanel(); // [추가]
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('대화 로드 오류:', error);
        alert('대화 로드 중 오류가 발생했습니다.');
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
            alert('대화 생성 실패');
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

// 캐릭터 응답 생성
async function generateCharacterResponse(characterId) {
    if (autoCallInProgress) return;

    if (generationAbortController) {
        generationAbortController.abort();
    }
    generationAbortController = new AbortController();
    const signal = generationAbortController.signal;

    const character = currentCharacters.find(c => c.id === characterId) ||
        availableCharacters.find(c => c.id === characterId);

    // 항상 텍스트 로딩 버블로 시작
    const loadingBubble = addMessage('assistant', '...', character?.name, character?.profile_image);

    try {
        let selectedModel = 'gemini-2.5-flash';
        if (currentWorkMode && proModeEnabled) {
            selectedModel = 'gemini-2.5-pro';
        }

        const requestBody = {
            characterId,
            conversationId: currentConversationId,
            workMode: currentWorkMode,
            showTime: currentShowTime,
            situationPrompt: currentSituationPrompt,
            imageGenerationEnabled,
            selectedModel
        };
        if (imageGenerationEnabled) {
            requestBody.imageCooldownSeconds = getRemainingImageCooldown();
        }
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

        // 텍스트 로딩 버블은 항상 제거
        if (loadingBubble) {
            const el = loadingBubble.closest('.message');
            if (el) el.remove();
        }

        if (response.ok) {
            const data = await response.json();

            // 1. 텍스트 메시지가 있으면 먼저 표시
            if (data.newMessage) {
                addMessage('assistant', data.newMessage.content, character?.name, character?.profile_image, data.newMessage.auto_call_sequence, data.newMessage.id);
            }

            // 2. 생성할 이미지가 있으면, 이미지 로딩 버블을 표시
            if (data.generatedImages && data.generatedImages.length > 0) {
                setImageGenerationCooldown();
                const imageLoadingBubble = addImageLoadingPlaceholder(character?.name, character?.profile_image);

                // 3. 잠시 후 이미지 로딩 버블을 실제 이미지로 교체
                setTimeout(() => {
                    if (imageLoadingBubble) {
                        const el = imageLoadingBubble.closest('.message');
                        if (el) el.remove();
                    }
                    data.generatedImages.forEach(image => {
                        addImageMessage('assistant', image.filename, image.url, image.id, character?.name, character?.profile_image);
                    });
                }, 1200); // 1.2초 지연으로 시뮬레이션

            } else if (data.imageGenerationAttempted && !data.newMessage) {
                // 텍스트 메시지 없이 이미지 생성만 시도했다가 실패한 경우
                addMessage('system', '이미지 생성에 실패했습니다.');
            }

            awaitingResponse = false;
            if (window.loadConversations) await window.loadConversations();

        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            showErrorModal(GEMINI_ERROR_GUIDANCE);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Character response generation aborted.');
            if (loadingBubble) { // Abort 시에도 로딩 버블 제거
                const el = loadingBubble.closest('.message');
                if (el) el.remove();
            }
            return;
        }
        console.error('캐릭터 응답 생성 오류:', err);
        if (loadingBubble) {
            const el = loadingBubble.closest('.message');
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
        // 연속 응답이 비활성화된 경우 한 번만 응답
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
                body: JSON.stringify({ conversationId: currentConversationId }),
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
                console.log('[Auto-Reply] No speaker selected. Ending sequence.');
                break;
            }
            console.log(`[Auto-Reply] Speaker selected: ${speaker.name}`);

            // 2. Show loading bubble
            const loadingBubble = addMessage('assistant', '...', speaker.name, speaker.profile_image);

            // 3. Generate the actual message
            console.log(`[Auto-Reply] Generating message for ${speaker.name}...`);
            let selectedModel = 'gemini-2.5-flash';
            if (currentWorkMode && proModeEnabled) {
                selectedModel = 'gemini-2.5-pro';
            }

            const generationPayload = {
                characterId: speaker.id,
                conversationId: currentConversationId,
                workMode: currentWorkMode,
                showTime: currentShowTime,
                situationPrompt: currentSituationPrompt,
                imageGenerationEnabled: imageGenerationEnabled,
                autoCallCount: autoCallCount + 1,
                selectedModel
            };
            console.log('[Auto-Reply] Generation payload:', generationPayload);

            const generationResponse = await fetch('/api/chat/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(generationPayload),
                signal
            });

            // 4. Remove loading bubble
            if (loadingBubble) {
                const el = loadingBubble.closest('.message');
                if (el) el.remove();
            }

            if (!generationResponse.ok) {
                console.error('[Auto-Reply] Message generation failed.', generationResponse.status);
                addMessage('system', GEMINI_ERROR_GUIDANCE);
                break;
            }

            const generationData = await generationResponse.json();
            console.log('[Auto-Reply] Generation response data:', generationData);

            // 5. Add the new message
            if (generationData.newMessage) {
                console.log('[Auto-Reply] Adding new message to chat.');
                addMessage('assistant', generationData.newMessage.content, speaker.name, speaker.profile_image, generationData.newMessage.auto_call_sequence, generationData.newMessage.id);
            } else {
                console.warn('[Auto-Reply] No newMessage found in generation response.');
            }

            if (generationData.generatedImages && generationData.generatedImages.length > 0) {
                setImageGenerationCooldown();
                // Only update character profiles, don't display images (they're now persisted in DB)
                for (const image of generationData.generatedImages) {
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
    if (!currentConversationId) { alert('먼저 대화를 시작해주세요.'); return; }
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
        avatar.onerror = function() { this.src = '/images/characters/kanade.webp'; };
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
            affectionSystemEnabled = false;
            document.getElementById('workModeToggle').checked = false;
            document.getElementById('showTimeToggle').checked = true;
            const affectionToggle = document.getElementById('affectionToggle');
            if (affectionToggle) affectionToggle.checked = false;
            updateWorkModeUI(false);
            updateAffectionUI();
            document.getElementById('chatMessages').innerHTML = '';
            document.getElementById('conversationTitle').textContent = '세카이 채팅';
            updateInvitedCharactersUI();
            if (window.loadConversations) await window.loadConversations();
            applyMarkdownMode();
            updateStartConversationPanel(); // [추가]
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
        alert('이미지 업로드는 개인 Gemini API 키가 등록된 사용자만 이용할 수 있습니다.');
        return;
    }

    if (!validateImageFile(file)) {
        alert('지원하지 않는 형식이거나 5MB 초과입니다.');
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
    img.onload = function() {
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
        alert('크롭 영역이 너무 작습니다.');
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
    croppedImage.onload = function() {
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
            alert('대화방 생성 실패');
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
        alert('업로드 실패');
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
    if (!confirm('이 메시지를 삭제하시겠습니까?')) return;
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

// TTS support helper function
function getCharacterTTSInfo(characterName) {
    if (!characterName) return null;

    // Find character in available characters list
    const character = availableCharacters.find(char =>
        char.name === characterName &&
        char.sekai === '프로젝트 세카이' &&
        char.name_code
    );

    return character ? { name_code: character.name_code } : null;
}

// TTS button generation helper
function createTTSButton(characterName, messageText, messageId) {
    const ttsInfo = getCharacterTTSInfo(characterName);
    if (!ttsInfo) return '';

    // Safely escape text for onclick handler - properly escape for JavaScript strings in HTML attributes
    function escapeForJSString(text) {
        return text
            .replace(/\\/g, '\\\\')  // Escape backslashes first
            .replace(/'/g, "\\'")    // Escape single quotes
            .replace(/"/g, '\\"')    // Escape double quotes
            .replace(/\n/g, '\\n')   // Escape newlines
            .replace(/\r/g, '\\r')   // Escape carriage returns
            .replace(/\t/g, '\\t');  // Escape tabs
    }

    const escapedNameCode = escapeForJSString(ttsInfo.name_code);
    const escapedText = escapeForJSString(messageText);

    return `<button class="tts-button btn btn-sm btn-outline-primary" onclick="handleTTS('${escapedNameCode}', '${escapedText}', ${messageId || 'null'})" title="음성으로 듣기">
        <i class="bi bi-soundwave"></i>
    </button>`;
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
            // 로딩 UI: Bootstrap의 spinner-grow 애니메이션 사용
            messageDiv.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHtml(altText)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
                <div class="message-content">
                    <div class="message-bubble has-placeholder" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g,'&quot;')}" aria-live="polite" aria-label="답변 생성 중">
                        <div class="d-flex justify-content-center align-items-center" style="height: 40px;">
                            <div class="spinner-grow spinner-grow-sm" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        } else {
            const ttsButtonHtml = createTTSButton(characterName, rawForMarkdown, messageId);
            messageDiv.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHtml(altText)}" class="message-avatar" onerror="this.src='/images/characters/kanade.webp'">
                <div class="message-content">
                    <div class="message-bubble" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g,'&quot;')}">
                        ${showMarkdown ? markdownToHtml(rawForMarkdown) : processedText}
                    </div>
                    ${emoji ? createCustomEmojiHTML(emoji) : ''}
                    <div class="message-actions">
                        ${ttsButtonHtml}
                        ${deleteButtonHtml}
                    </div>
                </div>`;
        }
    } else if (role === 'system') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble system-message" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g,'&quot;')}">${processedText}</div>
            </div>`;
    } else if (role === 'situation') {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble situation-message" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g,'&quot;')}"><i class="bi bi-card-text"></i> ${processedText}</div>
            </div>`;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble" data-raw="${escapeHtml(rawForMarkdown).replace(/"/g,'&quot;')}">
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
            try { updateHeaderCharacterAvatars(); } catch(e){}
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

// TTS 텍스트 처리 함수 (사용자 언어 설정에 따라 번역 또는 원본 사용)
async function processTextForTTS(text) {
    try {
        const response = await fetch('/api/tts/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                target: 'japanese'  // 이 파라미터는 이제 백엔드에서 무시되고 사용자 설정을 따름
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            // 새로운 로직: 번역 실패시 원본 텍스트로 폴백하지 않고 오류 발생
            throw new Error(`텍스트 처리 실패: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        if (!result.translatedText) {
            throw new Error('처리된 텍스트를 받을 수 없습니다.');
        }

        return result.translatedText;
    } catch (error) {
        console.error('TTS 텍스트 처리 중 오류 발생:', error);
        throw error; // 오류를 다시 던져서 TTS 실패 처리
    }
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
window.updateAffectionLevel = updateAffectionLevel;
window.adjustAffection = adjustAffection;
window.updateAffectionType = updateAffectionType;
window.expandImage = expandImage;
window.downloadImage = downloadImage;

window.handleTTS = handleTTS;