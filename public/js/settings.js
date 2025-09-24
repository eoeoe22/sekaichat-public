document.addEventListener('DOMContentLoaded', () => {
    // 전역 사용자 정보 변수
    let userInfo = null;

    // --- DOM 요소 ---
    const changeNicknameForm = document.getElementById('changeNicknameForm');
    const selfIntroForm = document.getElementById('selfIntroForm');
    const changePasswordForm = document.getElementById('changePasswordForm');
    const saveAutoCallBtn = document.getElementById('saveAutoCallBtn');
    const apiKeyForm = document.getElementById('apiKeyForm');
    const deleteApiKeyBtn = document.getElementById('deleteApiKeyBtn');
    const migrationContainer = document.getElementById('migrationContainer');
    const unlinkDiscordBtn = document.getElementById('unlinkDiscordBtn');
    const sekaiFilterContainer = document.getElementById('sekaiFilterContainer');
    const saveSekaiSettingsBtn = document.getElementById('saveSekaiSettingsBtn');
    const saveTtsLanguageBtn = document.getElementById('saveTtsLanguageBtn');

    // --- 초기화 ---
    async function initializeSettings() {
        try {
            await loadUserInfo();

            // ✅ (추가) 설정 페이지에서도 사용자 캐릭터 모듈 초기화
            // chat 페이지에서는 chat.js에서 호출하지만 settings 페이지에는 호출이 없어서
            // 캐릭터 목록/생성/수정/삭제가 작동하지 않았음
            if (typeof initializeUserCharacters === 'function') {
                try {
                    await initializeUserCharacters();
                } catch (ucErr) {
                    console.error('사용자 캐릭터 모듈 초기화 실패:', ucErr);
                }
            } else {
                console.warn('initializeUserCharacters 함수가 로드되지 않았습니다. user-characters.js가 포함되었는지 확인하세요.');
            }

            setupEventListeners();
            updateUI();
            loadSekaiPreferences();
        } catch (error) {
            console.error('설정 페이지 초기화 오류:', error);
            if (error.message === 'Unauthorized') {
                window.location.href = '/login';
            }
        }
    }

    // --- 이벤트 리스너 설정 ---
    function setupEventListeners() {
        changeNicknameForm.addEventListener('submit', changeNickname);
        selfIntroForm.addEventListener('submit', updateSelfIntroduction);
        changePasswordForm.addEventListener('submit', changePassword);
        saveAutoCallBtn.addEventListener('click', updateAutoCallSetting);
        apiKeyForm.addEventListener('submit', manageApiKey);
        deleteApiKeyBtn.addEventListener('click', deleteApiKey);
        unlinkDiscordBtn.addEventListener('click', unlinkDiscord);
        saveSekaiSettingsBtn.addEventListener('click', saveSekaiPreferences);
        saveTtsLanguageBtn.addEventListener('click', updateTtsLanguageSetting);
        
        // 내 캐릭터 관련 이벤트는 user-characters.js에서 처리
        // 데이터 이전 관련 이벤트
        if (migrationContainer) {
            setupMigrationEventListeners();
        }
    }

    // --- UI 업데이트 ---
    function updateUI() {
        if (!userInfo) return;

        // 프로필
        document.getElementById('new_nickname').placeholder = `현재 닉네임: ${userInfo.nickname}`;
        document.getElementById('selfIntroInput').value = userInfo.self_introduction || '';

        // 채팅 설정
        document.getElementById('maxAutoCall').value = userInfo.max_auto_call_sequence || 3;

        // TTS 언어 설정
        const ttsLanguage = userInfo.tts_language_preference || 'jp';
        document.getElementById('ttsLanguageKr').checked = (ttsLanguage === 'kr');
        document.getElementById('ttsLanguageJp').checked = (ttsLanguage === 'jp');

        // API 설정
        updateApiKeyUI();

        // Discord 연동 정보
        updateDiscordUI();
    }

    function updateDiscordUI() {
        const discordLinkSection = document.getElementById('discordLinkSection');
        const discordInfoSection = document.getElementById('discordInfoSection');

        if (userInfo.discord_id) {
            discordLinkSection.style.display = 'none';
            discordInfoSection.style.display = 'block';

            const discordAvatar = document.getElementById('discordAvatar');
            const discordUsername = document.getElementById('discordUsername');
            
            if (userInfo.discord_avatar) {
                discordAvatar.src = `https://cdn.discordapp.com/avatars/${userInfo.discord_id}/${userInfo.discord_avatar}.png`;
            } else {
                discordAvatar.src = '/images/characters/default.webp'; // 기본 이미지
            }
            discordUsername.textContent = userInfo.discord_username || '알 수 없음';
        } else {
            discordLinkSection.style.display = 'block';
            discordInfoSection.style.display = 'none';
        }
    }

    function updateApiKeyUI() {
        const input = document.getElementById('apiKeyInput');
        const submitBtn = document.getElementById('apiKeySubmitBtn');
        const deleteBtn = document.getElementById('deleteApiKeyBtn');

        if (userInfo.has_api_key) {
            input.value = '●●●●●●●●●●●●●●●●';
            submitBtn.textContent = '변경하기';
            deleteBtn.style.display = 'inline-block';
        } else {
            input.value = '';
            input.placeholder = '개인 Gemini API 키';
            submitBtn.textContent = '등록하기';
            deleteBtn.style.display = 'none';
        }
    }

    // --- 데이터 로드 ---
    async function loadUserInfo() {
        try {
            const response = await fetch('/api/user/info');
            if (response.status === 401) {
                throw new Error('Unauthorized');
            }
            if (!response.ok) {
                throw new Error('사용자 정보 로드 실패');
            }
            userInfo = await response.json();
            window.userInfo = userInfo; // 전역으로도 설정하여 user-characters.js에서 사용
        } catch (error) {
            console.error('사용자 정보 로드 실패:', error);
            throw error;
        }
    }

    // --- API 호출 함수들 ---
    async function changeNickname(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newNickname = formData.get('new_nickname');
        
        if (!newNickname || newNickname.trim() === '') {
            alert('새 닉네임을 입력해주세요.');
            return;
        }

        try {
            await postUserUpdate({ type: 'nickname', new_nickname: newNickname });
            alert('닉네임이 변경되었습니다.');
            await loadUserInfo();
            updateUI();
            e.target.reset();
        } catch (error) {
            alert(`닉네임 변경 실패: ${error.message}`);
        }
    }

    async function updateSelfIntroduction(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const selfIntroduction = formData.get('self_introduction');

        try {
            await postUserUpdate({ type: 'self_introduction', self_introduction: selfIntroduction });
            alert('자기소개가 저장되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`자기소개 저장 실패: ${error.message}`);
        }
    }

    async function changePassword(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newPassword = formData.get('new_password');
        const confirmPassword = formData.get('confirm_password');

        if (newPassword !== confirmPassword) {
            alert('새 비밀번호가 일치하지 않습니다.');
            return;
        }

        try {
            await postUserUpdate({
                type: 'password',
                current_password: formData.get('current_password'),
                new_password: newPassword
            });
            alert('비밀번호가 변경되었습니다.');
            e.target.reset();
        } catch (error) {
            alert(`비밀번호 변경 실패: ${error.message}`);
        }
    }

    async function updateAutoCallSetting() {
        const maxSequence = document.getElementById('maxAutoCall').value;
        try {
            await postUserUpdate({ type: 'max_auto_call_sequence', max_auto_call_sequence: maxSequence });
            alert('설정이 저장되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`설정 저장 실패: ${error.message}`);
        }
    }

    async function updateTtsLanguageSetting() {
        const ttsLanguage = document.querySelector('input[name="ttsLanguage"]:checked').value;
        try {
            await postUserUpdate({ type: 'tts_language_preference', tts_language_preference: ttsLanguage });
            alert('TTS 언어 설정이 저장되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`TTS 언어 설정 저장 실패: ${error.message}`);
        }
    }


    async function manageApiKey(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const apiKey = formData.get('api_key');

        if (apiKey === '●●●●●●●●●●●●●●●●') {
            alert('새로운 API 키를 입력해주세요.');
            return;
        }

        try {
            await postUserUpdate({ type: 'api_key', api_key: apiKey });
            alert('API 키가 등록/변경되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`API 키 관리 실패: ${error.message}`);
        }
    }

    async function deleteApiKey() {
        if (!confirm('API 키를 삭제하시겠습니까?')) return;
        try {
            await postUserUpdate({ type: 'delete_api_key' });
            alert('API 키가 삭제되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`API 키 삭제 실패: ${error.message}`);
        }
    }

    async function unlinkDiscord() {
        if (!confirm('Discord 연동을 해제하시겠습니까?')) return;
        try {
            await postUserUpdate({ type: 'unlink_discord' });
            alert('Discord 연동이 해제되었습니다.');
            await loadUserInfo();
            updateUI();
        } catch (error) {
            alert(`Discord 연동 해제 실패: ${error.message}`);
        }
    }

    async function loadSekaiPreferences() {
        try {
            const response = await fetch('/api/user/sekai-preferences');
            if (!response.ok) {
                throw new Error('세계관 설정 로드 실패');
            }
            const preferences = await response.json();
            sekaiFilterContainer.innerHTML = '';
            preferences.forEach(pref => {
                const div = document.createElement('div');
                div.className = 'form-check mb-2';
                div.innerHTML = `
                    <div class="d-flex align-items-center">
                        <img src="${pref.image_path}" alt="${pref.sekai}" class="me-2" style="width: 24px; height: 24px; border-radius: 50%;">
                        <div class="form-check flex-grow-1">
                            <input class="form-check-input" type="checkbox" value="${pref.sekai}" id="sekai-${pref.sekai}" ${pref.visible ? 'checked' : ''}>
                            <label class="form-check-label" for="sekai-${pref.sekai}">
                                <strong>${pref.sekai}</strong>
                            </label>
                            <div class="form-text text-muted ms-4">${pref.description || ''}</div>
                        </div>
                    </div>
                `;
                sekaiFilterContainer.appendChild(div);
            });
        } catch (error) {
            console.error('세계관 설정 로드 실패:', error);
        }
    }

    async function saveSekaiPreferences() {
        const preferences = [];
        sekaiFilterContainer.querySelectorAll('.form-check-input').forEach(input => {
            preferences.push({ sekai: input.value, visible: input.checked });
        });

        try {
            const response = await fetch('/api/user/sekai-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preferences)
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            alert('세계관 설정이 저장되었습니다.');
        } catch (error) {
            alert(`저장 실패: ${error.message}`);
        }
    }

    async function postUserUpdate(body) {
        const response = await fetch('/api/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (response.status === 401) {
            window.location.href = '/login';
            throw new Error('인증이 필요합니다.');
        }

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(errorData || '요청 처리 중 오류가 발생했습니다.');
        }
        return response.json();
    }
    
    // --- 데이터 이전 (Migration) 로직 ---
    function setupMigrationEventListeners() {
        const kanadeLoginForm = document.getElementById('kanadeLoginForm');
        const migrateBtn = document.getElementById('migrateBtn');

        kanadeLoginForm.addEventListener('submit', handleKanadeLogin);
        migrateBtn.addEventListener('click', startMigration);
    }

    let kanadeAuthToken = null;

    async function handleKanadeLogin(e) {
        e.preventDefault();
        const username = document.getElementById('kanadeUsername').value;
        const password = document.getElementById('kanadePassword').value;
        const errorMessage = document.getElementById('errorMessage');

        try {
            const response = await fetch('/api/migration/kanade-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!response.ok) throw new Error('카나데 계정 로그인에 실패했습니다.');

            const data = await response.json();
            kanadeAuthToken = data.token;

            document.getElementById('kanadeLoginSection').style.display = 'none';
            document.getElementById('conversationSelectSection').style.display = 'block';
            errorMessage.style.display = 'none';
            
            await loadKanadeConversations();
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.style.display = 'block';
        }
    }

    async function loadKanadeConversations() {
        const kanadeConversationList = document.getElementById('kanadeConversationList');
        const migrateBtn = document.getElementById('migrateBtn');
        const errorMessage = document.getElementById('errorMessage');

        try {
            const response = await fetch('/api/migration/kanade-conversations', {
                headers: { 'Authorization': `Bearer ${kanadeAuthToken}` }
            });

            if (!response.ok) throw new Error('대화내역을 불러오는 데 실패했습니다.');

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

    async function loadConversationPreview(conversationId) {
        const conversationPreview = document.getElementById('conversationPreview');
        conversationPreview.style.display = 'block';
        conversationPreview.innerHTML = '<p>미리보기를 불러오는 중...</p>';

        try {
            const response = await fetch(`/api/migration/kanade-conversation-preview/${conversationId}`, {
                headers: { 'Authorization': `Bearer ${kanadeAuthToken}` }
            });

            if (!response.ok) throw new Error('미리보기를 불러오는 데 실패했습니다.');

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

    async function startMigration() {
        const selectedConversations = Array.from(document.querySelectorAll('#kanadeConversationList input[type="checkbox"]:checked')).map(input => parseInt(input.value));
        if (selectedConversations.length === 0) {
            alert('이전할 대화내역을 하나 이상 선택해주세요.');
            return;
        }

        document.getElementById('conversationSelectSection').style.display = 'none';
        document.getElementById('migrationProgressSection').style.display = 'block';

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
            
            document.getElementById('migrationProgressSection').style.display = 'none';
            document.getElementById('migrationResultSection').style.display = 'block';
            document.getElementById('migrationResultMessage').textContent = `총 ${data.total}개의 대화 중 ${data.migrated}개를 성공적으로 이전했습니다.`;
        } catch (error) {
            document.getElementById('migrationProgressSection').style.display = 'none';
            const errorMessage = document.getElementById('errorMessage');
            errorMessage.textContent = `이전 중 오류 발생: ${error.message}`;
            errorMessage.style.display = 'block';
        }
    }

    function updateProgress(total, migrated) {
        const migrationProgressBar = document.getElementById('migrationProgressBar');
        const migrationStatus = document.getElementById('migrationStatus');
        const percentage = total > 0 ? Math.round((migrated / total) * 100) : 0;
        migrationProgressBar.style.width = `${percentage}%`;
        migrationProgressBar.textContent = `${percentage}%`;
        migrationProgressBar.setAttribute('aria-valuenow', percentage);
        migrationStatus.textContent = `${migrated} / ${total} 개 이전 완료`;
    }
    
    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // --- 페이지 초기화 실행 ---
    initializeSettings();
});
