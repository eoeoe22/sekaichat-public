// 검색 관련 변수
let allConversations = [];
let searchQuery = '';

// 사이드바 초기화 함수
async function initializeSidebar() {
    try {
        await loadNotice();
        await loadConversations();
        setupSidebarEventListeners();

        // 사용자 정보 UI 업데이트
        if (window.userInfo) {
            updateUserInfoUI();
            updateSidebarSettings();
        }
    } catch (error) {
        console.error('사이드바 초기화 오류:', error);
    }
}

// 🔧 수정된 사이드바 이벤트 리스너 설정 (존재 여부 검사 추가)
function setupSidebarEventListeners() {
    const openBtn = document.getElementById('sidebarOpenBtn');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('collapsed');
        });
    }

    const closeBtn = document.getElementById('sidebarCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('collapsed');
        });
    }

    const searchInput = document.getElementById('conversationSearch');
    if (searchInput) searchInput.addEventListener('input', handleSearchInput);

    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearSearch);

    const newConvBtn = document.getElementById('newConversationBtn');
    if (newConvBtn) {
        newConvBtn.addEventListener('click', () => {
            if (window.startNewConversation) {
                window.startNewConversation();
                closeSidebarOnMobile();
            }
        });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // ✅ 중복 기능 제거: 아래 폼들은 chat.html에서 삭제되었으므로 이벤트 바인딩 생략
    // changePasswordForm, changeNicknameForm, apiKeyForm, deleteApiKeyBtn, selfIntroForm 관련 제거
}

// 검색 입력 처리
function handleSearchInput(e) {
    searchQuery = e.target.value.toLowerCase().trim();
    displayConversations();
}

// 검색 초기화
function clearSearch() {
    const input = document.getElementById('conversationSearch');
    if (input) input.value = '';
    searchQuery = '';
    displayConversations();
}

// 공지사항 로드
async function loadNotice() {
    try {
        const response = await fetch('/api/notice?type=main');
        if (response.ok) {
            const data = await response.json();
            const noticeEl = document.getElementById('noticeContent');
            if (noticeEl) {
                if (Array.isArray(data) && data.length > 0) {
                    const noticeHtml = data.map(notice => notice.content).join('<br><br>');
                    noticeEl.innerHTML = noticeHtml;
                } else if (data.content) {
                    noticeEl.innerHTML = data.content;
                } else {
                    noticeEl.textContent = '공지사항이 없습니다.';
                }
            }
        } else {
            const noticeEl = document.getElementById('noticeContent');
            if (noticeEl) noticeEl.textContent = '공지사항을 불러오는데 실패했습니다.';
        }
    } catch (error) {
        console.error('공지사항 로드 실패:', error);
        const noticeEl = document.getElementById('noticeContent');
        if (noticeEl) noticeEl.textContent = '공지사항을 불러오는데 실패했습니다.';
    }

    if (window.markNoticeLoaded) {
        window.markNoticeLoaded();
    }
}

// 대화 목록 로드
async function loadConversations() {
    try {
        const response = await fetch('/api/conversations');
        if (response.ok) {
            allConversations = await response.json();
            window.allConversations = allConversations; // 전역 변수로 설정
            displayConversations();
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('대화내역 로드 실패:', error);
    }

    // 성공/실패 관계없이 로딩 완료 신호 (전역 로딩 상태 업데이트)
    if (window.markConversationsLoaded) {
        window.markConversationsLoaded();
    }
}

// HTML 이스케이프 함수
function escapeHTML(str) {
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

// 대화 목록 표시 함수
function displayConversations() {
    const listElement = document.getElementById('conversationList');
    if (!listElement) return;
    listElement.innerHTML = '';

    // 검색 필터링
    let filteredConversations = allConversations;
    if (searchQuery) {
        filteredConversations = allConversations.filter(conv =>
            conv.title && conv.title.toLowerCase().includes(searchQuery)
        );
    }

    // 즐겨찾기 우선 정렬
    filteredConversations.sort((a, b) => {
        if (a.is_favorite && !b.is_favorite) return -1;
        if (!a.is_favorite && b.is_favorite) return 1;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    // 검색 결과가 없는 경우
    if (filteredConversations.length === 0) {
        if (searchQuery) {
            listElement.innerHTML = '<div class="no-search-results">검색 결과가 없습니다</div>';
        }
        return;
    }

    filteredConversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        if (conv.id === window.currentConversationId) {
            item.classList.add('active');
        }
        if (conv.is_favorite) {
            item.classList.add('favorite');
        }

        // 참여 캐릭터 이미지 표시
        let participantImagesHtml = '';
        if (conv.participant_images) {
            const images = conv.participant_images;
            const maxAvatars = 10;
            const displayedAvatars = images.slice(0, maxAvatars);

            participantImagesHtml = displayedAvatars.map(img =>
                `<img src="${img}" class="participant-avatar" style="transform: rotate(${Math.random() * 20 - 10}deg);">`
            ).join('');

            if (images.length > maxAvatars) {
                participantImagesHtml += `<span class="participant-avatar-more">...</span>`;
            }
        }

        // 대화 제목에서 유니코드 이모지 제거 및 HTML 이스케이프
        const cleanTitle = removeUnicodeEmojis(conv.title || '');
        const escapedTitle = escapeHTML(cleanTitle);

        item.innerHTML = `
            <div class="conversation-info" onclick="loadConversationAndCloseSidebar(${conv.id})" style="cursor: pointer; flex: 1;">
                <div class="conversation-title" data-conversation-id="${conv.id}" ondblclick="startEditTitle(${conv.id}, event)">${escapedTitle}</div>
                <input type="text" class="title-edit-input" data-conversation-id="${conv.id}" onblur="saveTitle(${conv.id})" onkeypress="handleTitleKeypress(event, ${conv.id})">
                <div class="participant-images">${participantImagesHtml}</div>
            </div>
            <div class="conversation-actions">
                <i class="bi ${conv.is_favorite ? 'bi-star-fill' : 'bi-star'} favorite-btn ${conv.is_favorite ? 'active' : ''}" 
                   onclick="toggleFavorite(${conv.id}, event)"></i>
                ${!conv.is_favorite ? `<i class="bi bi-trash delete-conversation" onclick="deleteConversation(${conv.id})"></i>` : ''}
            </div>
        `;
        listElement.appendChild(item);
    });
}

// 즐겨찾기 토글
async function toggleFavorite(conversationId, event) {
    event.stopPropagation();

    try {
        const response = await fetch(`/api/conversations/${conversationId}/favorite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            await loadConversations();
        } else {
            Swal.fire({ icon: 'error', text: '즐겨찾기 설정에 실패했습니다.' });
        }
    } catch (error) {
        Swal.fire({ icon: 'error', text: '즐겨찾기 설정에 실패했습니다.' });
    }
}

// 제목 수정 시작
function startEditTitle(conversationId, event) {
    event.stopPropagation();

    const titleElement = document.querySelector(`.conversation-title[data-conversation-id="${conversationId}"]`);
    const inputElement = document.querySelector(`.title-edit-input[data-conversation-id="${conversationId}"]`);

    if (titleElement && inputElement) {
        const currentTitle = titleElement.textContent;
        inputElement.value = currentTitle;

        titleElement.classList.add('editing');
        inputElement.classList.add('active');
        inputElement.focus();
        inputElement.select();
    }
}

// 제목 저장
async function saveTitle(conversationId) {
    const titleElement = document.querySelector(`.conversation-title[data-conversation-id="${conversationId}"]`);
    const inputElement = document.querySelector(`.title-edit-input[data-conversation-id="${conversationId}"]`);

    if (titleElement && inputElement) {
        const newTitle = inputElement.value.trim();

        if (newTitle && newTitle !== titleElement.textContent) {
            try {
                const response = await fetch(`/api/conversations/${conversationId}/title`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle })
                });

                if (response.ok) {
                    titleElement.textContent = newTitle;
                    if (conversationId === window.currentConversationId) {
                        const convTitleEl = document.getElementById('conversationTitle');
                        if (convTitleEl) convTitleEl.textContent = newTitle;
                    }
                    await loadConversations();
                } else {
                    Swal.fire({ icon: 'error', text: '제목 변경에 실패했습니다.' });
                }
            } catch (error) {
                Swal.fire({ icon: 'error', text: '제목 변경에 실패했습니다.' });
            }
        }

        titleElement.classList.remove('editing');
        inputElement.classList.remove('active');
    }
}

// 제목 수정 키보드 이벤트
function handleTitleKeypress(event, conversationId) {
    if (event.key === 'Enter') {
        event.target.blur();
    } else if (event.key === 'Escape') {
        const titleElement = document.querySelector(`.conversation-title[data-conversation-id="${conversationId}"]`);
        const inputElement = document.querySelector(`.title-edit-input[data-conversation-id="${conversationId}"]`);

        if (titleElement && inputElement) {
            titleElement.classList.remove('editing');
            inputElement.classList.remove('active');
        }
    }
}

// 사용자 정보 UI 업데이트 (중복 기능 제거 반영)
function updateUserInfoUI() {
    if (window.userInfo) {
        const userInfoEl = document.getElementById('userInfo');
        if (userInfoEl) {
            userInfoEl.innerHTML = `
                아이디: ${window.userInfo.username}<br>
                닉네임: ${window.userInfo.nickname}
            `;
        }
    }
}

// 사이드바 설정 업데이트 (이제 최소 동작, 요소 없으면 무시)
function updateSidebarSettings() {
    if (window.userInfo) {
        updateApiKeyUI();
    }
}

// API 키 UI 업데이트 (존재하지 않을 수 있음)
function updateApiKeyUI() {
    const input = document.getElementById('apiKeyInput');
    if (!input) return; // chat.html에서 제거됨
    const submitBtn = document.getElementById('apiKeySubmitBtn');
    const deleteBtn = document.getElementById('deleteApiKeyBtn');

    if (window.userInfo.has_api_key) {
        input.value = '●●●●●●●●●●●●●●●●';
        if (submitBtn) submitBtn.textContent = '변경하기';
        if (deleteBtn) deleteBtn.style.display = 'inline-block';
    } else {
        input.value = '';
        if (submitBtn) submitBtn.textContent = '등록하기';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
}

// (잔존) 연속 호출 설정 업데이트 함수 (sidebar UI에서 제거되었지만 참조 안전)
async function updateAutoCallSetting() {
    const maxAutoCallInput = document.getElementById('maxAutoCall');
    if (!maxAutoCallInput) return;
    const maxSequence = maxAutoCallInput.value;

    try {
        const response = await fetch('/api/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'max_auto_call_sequence',
                max_auto_call_sequence: maxSequence
            })
        });

        if (response.ok) {
            Swal.fire({ icon: 'success', text: '설정이 저장되었습니다.' });
            if (window.loadUserInfo) {
                await window.loadUserInfo();
            }
        } else if (response.status === 401) {
            window.location.href = '/login';
        } else {
            Swal.fire({ icon: 'error', text: '으....이....' });
        }
    } catch (error) {
        Swal.fire({ icon: 'error', text: '으....이....' });
    }
}

// 대화 삭제
async function deleteConversation(id) {
    const result = await Swal.fire({
        title: '대화 삭제',
        text: '대화내역을 삭제하시겠습니까?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '삭제',
        cancelButtonText: '취소'
    });

    if (!result.isConfirmed) return;

    try {
        const response = await fetch(`/api/conversations/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadConversations();
            if (window.currentConversationId === id) {
                window.currentConversationId = null;
                window.currentCharacters = [];

                const chatMessagesEl = document.getElementById('chatMessages');
                if (chatMessagesEl) chatMessagesEl.innerHTML = '';
                const convTitleEl = document.getElementById('conversationTitle');
                if (convTitleEl) convTitleEl.textContent = '세카이 채팅';

                if (window.updateInvitedCharactersUI) {
                    window.updateInvitedCharactersUI();
                }
                if (window.updateHeaderCharacterAvatars) {
                    window.updateHeaderCharacterAvatars();
                }
            }
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        Swal.fire({ icon: 'error', text: '으....이....' });
    }
}

// 로그아웃
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (error) {
        Swal.fire({ icon: 'error', text: '으....이....' });
    }
}

// 유니코드 이모지 제거 함수 (chat.js와 동일)
function removeUnicodeEmojis(content) {
    const emojiRegex = /[ὠ0}-ὤF]|[ἰ0}-Ὗf]|[Ὠ0}-Ὧf]|[἞0}-἟f]|[☀}-⛷]|[✀}-➿]|[ᾐ0}-ᾟf]|[ἁ8}-ἧ0]|[ὥ0}-ὧF]|[Ὠ0}-Ὧf]|[἟2}-἟4]|[἞6}-἟f]|[Ἑ1}-ἙA]|[ἠ1}-ἥ1]|[ἀ4}]|[Ἄff}]|[἗0}-἗1}]|[἗E}-἗F}]|[ἘE}]|[〰}]|[⭐}]|[⭕}]|[⤴}-⤵}]|[⬅}-⬇}]|[⬛}-⬜}]|[㊗}]|[㊙}]|[〽}]|[©}]|[®}]|[™}]|[⏰}]|[⏳}]|[Ⓜ}]|[⚠}]|[♠}]|[♣}]|[♥}]|[♦}]|[♨}]|[♻}]|[♿}]|[⚓}]|[⚡}]|[⚪}-⚫}]|[⚽}-⚾}]|[⛄}-⛅}]|[⛎}]|[⛔}]|[⛪}]|[⛲}-⛳}]|[⛵}]|[⛺}]|[⛽}]|[✂}]|[✅}]|[✈}-✉}]|[✊}-✋}]|[✌}-✍}]|[✏}]|[✒}]|[✔}]|[✖}]|[✨}]|[✳}-✴}]|[❄}]|[❇}]|[❌}]|[❎}]|[❓}-❕}]|[❗}]|[❤}]|[➕}-➗}]|[➡}]|[➰}]|[➿}]|[️]/gu;
    return content.replace(emojiRegex, '');
}

// --- 추가된 함수 ---
// 모바일 화면에서 사이드바를 닫는 함수
function closeSidebarOnMobile() {
    // Bootstrap 'lg' breakpoint
    if (window.innerWidth < 992) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.add('collapsed');
        }
    }
}

// 대화 로드와 사이드바 닫기를 함께 처리하는 함수
function loadConversationAndCloseSidebar(conversationId) {
    if (window.loadConversation) {
        window.loadConversation(conversationId);
    }
    closeSidebarOnMobile();
}

// 전역 함수로 내보내기
window.initializeSidebar = initializeSidebar;
window.loadConversations = loadConversations;
window.updateAutoCallSetting = updateAutoCallSetting;
window.toggleFavorite = toggleFavorite;
window.startEditTitle = startEditTitle;
window.saveTitle = saveTitle;
window.handleTitleKeypress = handleTitleKeypress;
window.deleteConversation = deleteConversation;
window.closeSidebarOnMobile = closeSidebarOnMobile;
window.loadConversationAndCloseSidebar = loadConversationAndCloseSidebar;