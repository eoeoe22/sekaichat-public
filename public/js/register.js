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
            successDiv.textContent = '회원가입이 완료되었습니다. 로그인 페이지로 이동합니다.';
            successDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else {
            errorDiv.textContent = '으....이....';
            errorDiv.style.display = 'block';
            successDiv.style.display = 'none';
        }
    } catch (error) {
        errorDiv.textContent = '으....이....';
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
    }
});
