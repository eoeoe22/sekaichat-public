// 페이지 로드 시 로그인 상태 확인 및 자동 리디렉션
async function checkLoginStatusAndRedirect() {
    try {
        const response = await fetch('/api/auth/status', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-cache'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.authenticated) {
                // 이미 로그인된 상태라면 메인 페이지로 리디렉션
                window.location.href = '/main';
                return;
            }
        }
    } catch (error) {
        // 에러가 발생해도 로그인 페이지는 그대로 표시
        console.log('Auth status check failed:', error);
    }
}

// 페이지 로드 시 자동으로 로그인 상태 확인
document.addEventListener('DOMContentLoaded', checkLoginStatusAndRedirect);

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const errorDiv = document.getElementById('errorMessage');
    const submitButton = e.target.querySelector('button[type="submit"]');
    
    // 버튼 비활성화
    submitButton.disabled = true;
    submitButton.textContent = '로그인 중...';
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        });
        
        if (response.ok) {
            // 쿠키 설정을 위한 충분한 지연 후 메인 페이지로 이동
            setTimeout(() => {
                window.location.href = `/main?t=${Date.now()}`;
            }, 100);
        } else {
            errorDiv.textContent = '으....이....';
            errorDiv.style.display = 'block';
            submitButton.disabled = false;
            submitButton.textContent = '로그인';
        }
    } catch (error) {
        errorDiv.textContent = '으....이....';
        errorDiv.style.display = 'block';
        submitButton.disabled = false;
        submitButton.textContent = '로그인';
    }
});
