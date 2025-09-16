// Guest mode JavaScript functionality
let selectedCharacters = [];
let availableCharacters = [];
let isCharacterSelectionOpen = false;
let autoReplyMode = false;
let isLoading = false;

// Initialize page
document.addEventListener('DOMContentLoaded', async function() {
    // Check if user has valid guest session
    if (!hasGuestSession()) {
        window.location.href = '/guest/verify';
        return;
    }
    
    // Initialize sidebar (collapsed on mobile)
    initializeSidebar();
    
    // Load available characters
    await loadCharacters();
    
    // Set up event handlers
    setupEventHandlers();
    
    // Welcome message
    addSystemMessage('게스트 모드에 오신 것을 환영합니다! 캐릭터를 선택하고 대화를 시작해보세요.');
});

// Initialize sidebar
function initializeSidebar() {
    const sidebar = document.getElementById('sidebar');
    
    // Show sidebar on desktop, keep collapsed on mobile
    if (window.innerWidth > 768) {
        sidebar.classList.remove('collapsed');
    }
    
    // Listen for window resize to handle responsive behavior
    window.addEventListener('resize', function() {
        if (window.innerWidth <= 768) {
            // On mobile, allow manual toggle but don't auto-show
        } else {
            // On desktop, always show sidebar
            sidebar.classList.remove('collapsed');
        }
    });
}

// Check if user has valid guest session
function hasGuestSession() {
    return document.cookie.includes('guest_session=');
}

// Setup event handlers
function setupEventHandlers() {
    const messageInput = document.getElementById('messageInput');
    const autoReplyCheckbox = document.getElementById('autoReplyMode');
    
    // Enter key to send message
    messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Auto-reply mode toggle
    autoReplyCheckbox.addEventListener('change', function() {
        autoReplyMode = this.checked;
        updateUIForAutoReply();
    });
    
    // Sidebar toggle functionality
    const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const sidebar = document.getElementById('sidebar');
    
    if (sidebarOpenBtn) {
        sidebarOpenBtn.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
        });
    }
    
    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
        });
    }
}

// Load available characters
async function loadCharacters() {
    try {
        const response = await fetch('/api/guest/characters');
        if (response.ok) {
            availableCharacters = await response.json();
            renderCharacterGrid();
        } else if (response.status === 404) {
            console.error('No Project Sekai characters found');
            addSystemMessage('프로젝트 세카이 캐릭터를 찾을 수 없습니다. 관리자에게 문의해주세요.');
        } else {
            console.error('Failed to load characters');
            addSystemMessage('캐릭터 목록을 불러오는데 실패했습니다.');
        }
    } catch (error) {
        console.error('Error loading characters:', error);
        addSystemMessage('캐릭터 목록을 불러오는 중 오류가 발생했습니다.');
    }
}

// Render character selection grid
function renderCharacterGrid() {
    const grid = document.getElementById('characterGrid');
    grid.innerHTML = '';
    
    if (availableCharacters.length === 0) {
        grid.innerHTML = `
            <div class="text-center text-muted" style="grid-column: 1 / -1; padding: 2rem;">
                <i class="bi bi-exclamation-triangle" style="font-size: 2rem; opacity: 0.5;"></i>
                <p class="mt-2">사용 가능한 프로젝트 세카이 캐릭터가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    availableCharacters.forEach(character => {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.onclick = () => selectCharacter(character.id);
        
        card.innerHTML = `
            <img src="${character.profile_image}" alt="${character.name}" class="character-avatar">
            <p class="character-name">${character.name}</p>
        `;
        
        grid.appendChild(card);
    });
}

// Toggle individual character selection
function selectCharacter(characterId) {
    const index = selectedCharacters.indexOf(characterId);
    if (index > -1) {
        selectedCharacters.splice(index, 1);
    } else {
        selectedCharacters.push(characterId);
    }
    updateCharacterSelectionUI();
}

// Update character selection UI
function updateCharacterSelectionUI() {
    const cards = document.querySelectorAll('.character-card');
    cards.forEach((card, index) => {
        const characterId = availableCharacters[index].id;
        if (selectedCharacters.includes(characterId)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
}

// Apply character selection
function applyCharacterSelection() {
    if (selectedCharacters.length === 0) {
        alert('최소 1명의 캐릭터를 선택해주세요.');
        return;
    }
    
    updateMessageInput();
    
    const characterNames = selectedCharacters.map(id => {
        const char = availableCharacters.find(c => c.id === id);
        return char ? char.name : '알 수 없음';
    }).join(', ');
    
    addSystemMessage(`선택된 캐릭터: ${characterNames}`);
}

// Update message input state
function updateMessageInput() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    const hasCharacters = selectedCharacters.length > 0;
    messageInput.disabled = !hasCharacters || isLoading;
    sendBtn.disabled = !hasCharacters || isLoading;
    
    if (hasCharacters) {
        messageInput.placeholder = '메시지를 입력하세요...';
    } else {
        messageInput.placeholder = '먼저 캐릭터를 선택해주세요...';
    }
}

// Update UI for auto-reply mode
function updateUIForAutoReply() {
    // Show different placeholder or hints for auto-reply mode
    const messageInput = document.getElementById('messageInput');
    if (autoReplyMode && selectedCharacters.length > 1) {
        messageInput.placeholder = '메시지를 입력하세요 (자동으로 적절한 캐릭터가 응답합니다)...';
    } else {
        messageInput.placeholder = '메시지를 입력하세요...';
    }
}

// Send message
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (!message || selectedCharacters.length === 0 || isLoading) {
        return;
    }
    
    // Add user message to chat
    addUserMessage(message);
    messageInput.value = '';
    
    // Set loading state
    setLoading(true);
    
    try {
        const response = await fetch('/api/guest/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                characters: selectedCharacters,
                autoReplyMode: autoReplyMode
            })
        });
        
        if (response.status === 429) {
            addSystemMessage('메시지 전송 한도에 도달했습니다. 잠시 후 다시 시도해주세요.');
        } else if (response.ok) {
            const data = await response.json();
            
            if (data.responses && data.responses.length > 0) {
                data.responses.forEach(resp => {
                    addCharacterMessage(resp.character, resp.message);
                });
            } else {
                addSystemMessage('응답을 받지 못했습니다.');
            }
        } else if (response.status === 401) {
            addSystemMessage('세션이 만료되었습니다. 페이지를 새로고침해주세요.');
            setTimeout(() => {
                window.location.href = '/guest/verify';
            }, 2000);
        } else {
            addSystemMessage('메시지 전송에 실패했습니다.');
        }
    } catch (error) {
        console.error('Send message error:', error);
        addSystemMessage('메시지 전송 중 오류가 발생했습니다.');
    } finally {
        setLoading(false);
    }
}

// Set loading state
function setLoading(loading) {
    isLoading = loading;
    updateMessageInput();
    
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loading) {
        loadingOverlay.classList.remove('d-none');
    } else {
        loadingOverlay.classList.add('d-none');
    }
}

// Add user message to chat
function addUserMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble user-message mb-3';
    
    messageDiv.innerHTML = `
        <div class="message-content" style="background: #007bff; color: white; padding: 0.75rem 1rem; border-radius: 18px; margin-left: auto; margin-right: 0; max-width: 80%; word-wrap: break-word;">
            <div class="message-text">${escapeHtml(message)}</div>
            <div class="message-time" style="font-size: 0.75rem; opacity: 0.8; margin-top: 0.25rem;">
                ${getCurrentTime()}
            </div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// Add character message to chat
function addCharacterMessage(character, message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble character-message mb-3';
    
    messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
            <img src="${character.profile_image}" alt="${character.name}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">
            <div style="flex: 1; max-width: 80%;">
                <div style="font-weight: 600; font-size: 0.9rem; color: var(--text-color); margin-bottom: 0.25rem;">
                    ${escapeHtml(character.name)}
                </div>
                <div class="message-content" style="background: var(--bg-secondary, #f8f9fa); padding: 0.75rem 1rem; border-radius: 18px; word-wrap: break-word;">
                    <div class="message-text">${escapeHtml(message)}</div>
                    <div class="message-time" style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.25rem; color: var(--text-muted, #6c757d);">
                        ${getCurrentTime()}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// Add system message to chat
function addSystemMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message mb-3';
    
    messageDiv.innerHTML = `
        <div class="text-center">
            <div style="display: inline-block; background: rgba(108, 117, 125, 0.1); color: #6c757d; padding: 0.5rem 1rem; border-radius: 15px; font-size: 0.9rem;">
                <i class="bi bi-info-circle"></i> ${escapeHtml(message)}
            </div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// Scroll to bottom of chat
function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Get current time
function getCurrentTime() {
    return new Date().toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Escape HTML
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close banner
function closeBanner() {
    const banner = document.getElementById('guestBanner');
    banner.style.animation = 'slideOutToTop 0.3s ease-in forwards';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 300);
}

// Add slideOutToTop animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOutToTop {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-100%); opacity: 0; }
    }
`;
document.head.appendChild(style);