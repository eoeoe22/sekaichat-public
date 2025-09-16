document.addEventListener('DOMContentLoaded', async () => {
    const searchButton = document.getElementById('searchButton');
    const queryInput = document.getElementById('queryInput');
    const aiSearchMode = document.getElementById('aiSearchMode');
    const resultsContainer = document.getElementById('resultsContainer');
    const logContainer = document.getElementById('logContainer');

    let characterData = [];

    // --- Fetch Character Data ---
    async function loadCharacterData() {
        try {
            const response = await fetch('/api/characters/info');
            if (!response.ok) {
                throw new Error('캐릭터 정보를 불러오는데 실패했습니다.');
            }
            characterData = await response.json();
            addLog('캐릭터 정보 로드 완료.', 'success');
        } catch (error) {
            console.error(error);
            addLog(error.message, 'error');
        }
    }

    // --- New Log Function ---
    function addLog(message, type = 'info') {
        const now = new Date();
        const timestamp = now.toLocaleTimeString('ko-KR', { hour12: false });
        
        let icon = 'bi-info-circle';
        let color = 'text-dark';

        switch (type) {
            case 'success':
                icon = 'bi-check-circle-fill';
                color = 'text-success';
                break;
            case 'error':
                icon = 'bi-exclamation-triangle-fill';
                color = 'text-danger';
                break;
            case 'ai':
                icon = 'bi-robot';
                color = 'text-primary';
                break;
        }

        const logEntry = document.createElement('p');
        logEntry.className = `mb-1 ${color}`;
        logEntry.innerHTML = `<small><i class="bi ${icon}"></i> [${timestamp}] ${escapeHtml(message)}</small>`;
        
        const initialMessage = logContainer.querySelector('.text-muted');
        if (initialMessage) {
            logContainer.innerHTML = '';
        }

        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    searchButton.addEventListener('click', async () => {
        const query = queryInput.value.trim();
        if (!query) {
            alert('검색할 내용을 입력해주세요.');
            return;
        }

        const mode = aiSearchMode.checked ? 'ai' : 'normal';
        
        toggleLoading(true);
        resultsContainer.innerHTML = '';
        logContainer.innerHTML = '<p class="text-muted mb-0">작업을 시작하려면 검색 버튼을 누르세요.</p>';
        addLog('검색을 시작합니다...');

        try {
            if (mode === 'ai') {
                addLog('AI 모드가 활성화되었습니다. Gemini API로 키워드를 추출합니다.', 'ai');
            }

            const response = await fetch('/api/autorag/preview', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query, mode })
            });

            if (!response.ok) {
                addLog(`서버 오류: ${response.statusText}`, 'error');
                throw new Error(`서버 오류: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.error) {
                addLog(`서버에서 오류 응답: ${data.error}`, 'error');
                console.error('서버에서 반환된 오류:', data.error);
            }

            displayResults(data);

        } catch (error) {
            console.error('검색 중 오류 발생:', error);
            resultsContainer.innerHTML = `<div class="alert alert-danger">오류가 발생했습니다: ${escapeHtml(error.message)}</div>`;
            addLog(`클라이언트 오류: ${error.message}`, 'error');
        } finally {
            toggleLoading(false);
            addLog('검색 프로세스가 완료되었습니다.', 'success');
        }
    });

    function toggleLoading(isLoading) {
        const spinner = searchButton.querySelector('.spinner-border');
        if (isLoading) {
            searchButton.disabled = true;
            spinner.classList.remove('d-none');
        } else {
            searchButton.disabled = false;
            spinner.classList.add('d-none');
        }
    }

    function formatLine(line) {
        const trimmedLine = line.trim();
        if (!trimmedLine) return '';

        if (trimmedLine.startsWith('Background Music:')) {
            const content = escapeHtml(trimmedLine.substring(17).trim());
            return `<div class="result-line music-line"><i class="bi bi-music-note-beamed"></i><span>${content}</span></div>`;
        }

        if (trimmedLine.startsWith('Caption:')) {
            const content = escapeHtml(trimmedLine.substring(8).trim());
            return `<div class="result-line caption-line"><i class="bi bi-file-text"></i><span>${content}</span></div>`;
        }

        const parts = trimmedLine.split(/:(.+)/);
        if (parts.length > 1) {
            const charName = parts[0].trim();
            const dialogue = escapeHtml(parts[1].trim());
            
            const character = characterData.find(c => {
                if (c.nickname === charName) return true;
                const nameParts = c.name.split(' ');
                if (nameParts.length > 1) {
                    const firstName = nameParts[1];
                    return firstName === charName;
                }
                return c.name === charName; // Fallback for single-word names
            });

            if (character) {
                return `
                    <div class="result-line dialogue-line">
                        <img src="${character.profile_image}" class="char-profile-img" alt="${escapeHtml(charName)}">
                        <span><strong>${escapeHtml(charName)}:</strong> ${dialogue}</span>
                    </div>`;
            } else {
                return `
                    <div class="result-line dialogue-line">
                        <i class="bi bi-person-circle char-profile-icon"></i>
                        <span><strong>${escapeHtml(charName)}:</strong> ${dialogue}</span>
                    </div>`;
            }
        }
        
        return `<div class="result-line other-line">${escapeHtml(trimmedLine)}</div>`;
    }

    function displayResults(data) {
        resultsContainer.innerHTML = '';

        if (data.mode === 'ai' && data.keywords) {
            addLog(`AI가 추출한 키워드: "${data.keywords}"`, 'ai');
            const keywordsHtml = `
                <div class="alert alert-info">
                    <h6 class="alert-heading"><i class="bi bi-robot"></i> AI 추출 키워드</h6>
                    <p class="mb-0">
                        <span class="badge bg-primary keyword-badge">${escapeHtml(data.keywords)}</span>
                    </p>
                </div>`;
            resultsContainer.innerHTML += keywordsHtml;
        }

        if (data.results && data.results.length > 0) {
            addLog(`${data.results.length}개의 검색 결과를 찾았습니다.`, 'success');
            
            data.results.forEach((result, index) => {
                let textToFormat = '';

                if (typeof result.text === 'string') {
                    try {
                        const parsed = JSON.parse(result.text);
                        if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].text === 'string') {
                            textToFormat = parsed[0].text;
                        } else {
                            textToFormat = result.text;
                        }
                    } catch (e) {
                        textToFormat = result.text;
                    }
                } else if (result.text && typeof result.text === 'object') {
                    if (Array.isArray(result.text) && result.text[0] && typeof result.text[0].text === 'string') {
                        textToFormat = result.text[0].text;
                    } else {
                        textToFormat = JSON.stringify(result.text, null, 2);
                    }
                }

                const lines = textToFormat.split(/\r\n|\n/);
                const formattedContent = lines.map(formatLine).join('');

                let filenameDisplay = '';
                if (result.filename) {
                    filenameDisplay = `<small class="text-muted d-block mt-1"><i class="bi bi-file-earmark"></i> 파일: ${escapeHtml(result.filename)}</small>`;
                }
                
                const resultCard = `
                    <div class="card mb-3">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="mb-0"><i class="bi bi-file-text"></i> ${escapeHtml(result.source || `검색 결과 ${index + 1}`)}</h6>
                                ${filenameDisplay}
                            </div>
                            <span class="badge bg-secondary">결과 ${index + 1}</span>
                        </div>
                        <div class="card-body">
                            ${formattedContent}
                        </div>
                    </div>
                `;
                resultsContainer.innerHTML += resultCard;
            });
        } else {
            addLog('검색 결과가 없습니다.');
            resultsContainer.innerHTML += '<div class="alert alert-secondary">검색 결과가 없습니다.</div>';
        }
    }

    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"]|[']/g, m => map[m]);
    }

    // Initial Load
    loadCharacterData();
});