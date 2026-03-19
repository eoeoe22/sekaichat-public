document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            Swal.fire({
                icon: 'success',
                title: '회원가입 완료',
                text: '회원가입이 완료되었습니다. 로그인 페이지로 이동합니다.',
                timer: 2000,
                showConfirmButton: false
            });

            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            const errorText = await response.text();
            Swal.fire({
                icon: 'error',
                title: '회원가입 실패',
                text: errorText || '회원가입 중 오류가 발생했습니다.',
                confirmButtonColor: '#007bff'
            });
            if (typeof turnstile !== 'undefined') turnstile.reset();
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: '오류 발생',
            text: '회원가입 중 서버 오류가 발생했습니다.',
            confirmButtonColor: '#007bff'
        });
        if (typeof turnstile !== 'undefined') turnstile.reset();
    }
});
