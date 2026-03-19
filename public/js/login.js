// 로그인 폼 제출 처리
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
            Swal.fire({
                icon: 'error',
                title: '로그인 실패',
                text: '아이디 또는 비밀번호를 확인해주세요.',
                confirmButtonColor: '#007bff'
            });
            submitButton.disabled = false;
            submitButton.textContent = '로그인';
            if (typeof turnstile !== 'undefined') turnstile.reset();
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: '오류 발생',
            text: '로그인 중 문제가 발생했습니다.',
            confirmButtonColor: '#007bff'
        });
        submitButton.disabled = false;
        submitButton.textContent = '로그인';
        if (typeof turnstile !== 'undefined') turnstile.reset();
    }
});
