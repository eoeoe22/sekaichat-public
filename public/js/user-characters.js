// 사용자 정의 캐릭터 관리 모듈
let userCharacters = [];
let currentEditingCharacter = null;

// 사용자 캐릭터 모듈 초기화
async function initializeUserCharacters() {
    try {
        await loadUserCharacters();
        setupUserCharacterEventListeners();
    } catch (error) {
        console.error('사용자 캐릭터 초기화 실패:', error);
    }
}

// 이벤트 리스너 설정
function setupUserCharacterEventListeners() {
    // 새 캐릭터 만들기 버튼
    document.getElementById('createCharacterBtn').addEventListener('click', showCreateCharacterModal);
    
    // 캐릭터 저장 버튼
    document.getElementById('saveCharacterBtn').addEventListener('click', saveCharacter);
    
    // 이미지 파일 선택
    document.getElementById('characterImage').addEventListener('change', handleImageSelect);
    
    // 캐릭터 관리 모달 버튼들
    document.getElementById('editCharacterBtn').addEventListener('click', editCurrentCharacter);
    document.getElementById('deleteCharacterBtn').addEventListener('click', deleteCurrentCharacter);
}

// 사용자 캐릭터 목록 로드
async function loadUserCharacters() {
    try {
        const response = await fetch('/api/user/characters');
        if (response.ok) {
            userCharacters = await response.json();
            displayUserCharacters();
        } else if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('사용자 캐릭터 로드 실패:', error);
    }
}

// 사용자 캐릭터 목록 표시
function displayUserCharacters() {
    const container = document.getElementById('userCharactersList');
    
    if (userCharacters.length === 0) {
        container.innerHTML = '<div class="no-characters-message">생성된 캐릭터가 없습니다.<br>새 캐릭터를 만들어보세요!</div>';
        return;
    }
    
    container.innerHTML = '';
    
    userCharacters.forEach(character => {
        const item = document.createElement('div');
        item.className = 'user-character-item';
        item.onclick = () => showManageCharacterModal(character);
        
        item.innerHTML = `
            <img src="/api/user-characters/image/${character.profile_image_r2}" 
                 alt="${character.name}" 
                 class="user-character-avatar"
                 onerror="this.src='/images/characters/default.webp'">
            <div class="user-character-info">
                <div class="user-character-name">${escapeHtml(character.name)}</div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

// 새 캐릭터 생성 모달 표시
function showCreateCharacterModal() {
    currentEditingCharacter = null;
    
    document.getElementById('userCharacterModalTitle').innerHTML = 
        '<i class="bi bi-person-plus"></i> 새 캐릭터 만들기';
    
    document.getElementById('userCharacterForm').reset();
    document.getElementById('editingCharacterId').value = '';
    document.getElementById('characterImage').required = true;
    document.getElementById('imagePreview').style.display = 'none';
    
    document.getElementById('saveCharacterBtn').innerHTML = 
        '<i class="bi bi-check-lg"></i> 생성';
    
    const modal = new bootstrap.Modal(document.getElementById('userCharacterModal'));
    modal.show();
}

// 캐릭터 관리 모달 표시
function showManageCharacterModal(character) {
    currentEditingCharacter = character;
    
    document.getElementById('manageCharacterImage').src = 
        `/api/user-characters/image/${character.profile_image_r2}`;
    document.getElementById('manageCharacterName').textContent = character.name;
    
    const modal = new bootstrap.Modal(document.getElementById('manageCharacterModal'));
    modal.show();
}

// 이미지 파일 선택 처리
function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) {
        document.getElementById('imagePreview').style.display = 'none';
        return;
    }
    
    if (!validateCharacterImage(file)) {
        event.target.value = '';
        document.getElementById('imagePreview').style.display = 'none';
        return;
    }
    
    const img = new Image();
    img.onload = function() {
        if (img.width !== 200 || img.height !== 200) {
            alert('이미지 크기는 정확히 200×200 픽셀이어야 합니다.\n현재 크기: ' + img.width + '×' + img.height);
            event.target.value = '';
            document.getElementById('imagePreview').style.display = 'none';
            return;
        }
        
        document.getElementById('previewImg').src = URL.createObjectURL(file);
        document.getElementById('imageInfo').innerHTML = `
            <div class="info-value">크기: ${img.width}×${img.height}px</div>
            <div class="info-value">용량: ${(file.size / 1024).toFixed(1)}KB</div>
        `;
        document.getElementById('imagePreview').style.display = 'flex';
    };
    img.src = URL.createObjectURL(file);
}

// 캐릭터 이미지 검증
function validateCharacterImage(file) {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        alert('PNG, JPG, WEBP 파일만 업로드 가능합니다.');
        return false;
    }
    
    if (file.size > 2 * 1024 * 1024) {
        alert('파일 크기는 2MB를 초과할 수 없습니다.');
        return false;
    }
    
    return true;
}

// 캐릭터 저장
async function saveCharacter() {
    const saveBtn = document.getElementById('saveCharacterBtn');
    
    const name = document.getElementById('characterName').value.trim();
    const description = document.getElementById('characterDescription').value.trim();
    const prompt = document.getElementById('characterPrompt').value.trim();
    const imageFile = document.getElementById('characterImage').files[0];
    const isEditing = currentEditingCharacter !== null;
    
    if (!name || !description || !prompt) {
        alert('이름, 소개, 프롬프트를 모두 입력해주세요.');
        return;
    }
    
    if (!isEditing && !imageFile) {
        alert('프로필 이미지를 선택해주세요.');
        return;
    }
    
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> 저장 중...';
    
    try {
        let profileImageR2 = isEditing ? currentEditingCharacter.profile_image_r2 : null;
        
        if (imageFile) {
            const imageFormData = new FormData();
            imageFormData.append('file', imageFile);
            
            const imageResponse = await fetch('/api/upload/character-image', {
                method: 'POST',
                body: imageFormData
            });
            
            if (!imageResponse.ok) throw new Error(await imageResponse.text());
            
            const imageData = await imageResponse.json();
            profileImageR2 = imageData.key;
        }
        
        const characterData = { name, description, systemPrompt: prompt, profileImageR2 };
        
        const url = isEditing ? `/api/user/characters/${currentEditingCharacter.id}` : '/api/user/characters';
        const method = isEditing ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(characterData)
        });
        
        if (response.ok) {
            alert(isEditing ? '캐릭터가 수정되었습니다.' : '캐릭터가 생성되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('userCharacterModal')).hide();
            if (isEditing) {
                 bootstrap.Modal.getInstance(document.getElementById('manageCharacterModal'))?.hide();
            }
            await loadUserCharacters();
        } else {
            alert('저장 실패: ' + await response.text());
        }
        
    } catch (error) {
        console.error('캐릭터 저장 오류:', error);
        alert('저장 중 오류가 발생했습니다: ' + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="bi bi-check-lg"></i> ${isEditing ? '수정' : '생성'}`;
    }
}

// 현재 캐릭터 편집
function editCurrentCharacter() {
    if (!currentEditingCharacter) return;
    
    bootstrap.Modal.getInstance(document.getElementById('manageCharacterModal')).hide();
    
    document.getElementById('userCharacterModalTitle').innerHTML = '<i class="bi bi-pencil"></i> 캐릭터 수정';
    
    document.getElementById('editingCharacterId').value = currentEditingCharacter.id;
    document.getElementById('characterName').value = currentEditingCharacter.name;
    document.getElementById('characterDescription').value = currentEditingCharacter.description;
    document.getElementById('characterPrompt').value = currentEditingCharacter.system_prompt;
    
    document.getElementById('previewImg').src = `/api/user-characters/image/${currentEditingCharacter.profile_image_r2}`;
    document.getElementById('imageInfo').innerHTML = `<div class="info-value">변경하려면 새 이미지를 선택하세요</div>`;
    document.getElementById('imagePreview').style.display = 'flex';
    
    document.getElementById('characterImage').required = false;
    
    document.getElementById('saveCharacterBtn').innerHTML = '<i class="bi bi-check-lg"></i> 수정';
    
    const modal = new bootstrap.Modal(document.getElementById('userCharacterModal'));
    modal.show();
}

// 현재 캐릭터 삭제
async function deleteCurrentCharacter() {
    if (!currentEditingCharacter) return;
    
    if (!confirm(`'${currentEditingCharacter.name}' 캐릭터를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/user/characters/${currentEditingCharacter.id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert('캐릭터가 삭제되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('manageCharacterModal')).hide();
            await loadUserCharacters();
        } else {
            alert('삭제 실패: ' + await response.text());
        }
    }
    catch (error) {
        console.error('캐릭터 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// HTML 이스케이프 함수
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

// 전역 초기화
window.initializeUserCharacters = initializeUserCharacters;
