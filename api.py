import uvicorn
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
import numpy as np
from io import BytesIO
import scipy.io.wavfile as wavfile
from tts import TTSWrapper
import ipaddress  # IP 주소 처리를 위한 내장 라이브러리 추가
from starlette.middleware.base import BaseHTTPMiddleware # 미들웨어 사용
import httpx
from typing import Any
import subprocess
import datetime # 시간 로깅용

# --- 여기에 미들웨어 클래스 추가 ---
class CloudflareOnlyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        # Cloudflare의 공식 IP 대역 리스트
        self.cf_ips_v4 = [ipaddress.ip_network(net) for net in [
            "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
            "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
            "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
            "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"
        ]]
        self.cf_ips_v6 = [ipaddress.ip_network(net) for net in [
            "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
            "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"
        ]]
        self.allowed_ips = self.cf_ips_v4 + self.cf_ips_v6 + [ipaddress.ip_network("127.0.0.1/32")]

    async def dispatch(self, request: Request, call_next):
        # robots.txt 경로에 대한 요청은 IP 검사를 건너뛰고 허용
        if request.url.path == "/robots.txt":
            return await call_next(request)

        # 요청한 클라이언트의 IP 주소 확인
        client_ip = request.client.host
        
        # IP 주소 객체로 변환
        try:
            ip = ipaddress.ip_address(client_ip)
        except ValueError:
            # 유효하지 않은 IP 형식일 경우 차단
            print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Forbidden: Invalid IP address: {client_ip}")
            return JSONResponse(status_code=403, content={"detail": "Invalid IP address"})

        # Cloudflare IP 대역에 속하는지 확인
        is_allowed = any(ip in net for net in self.allowed_ips)

        if not is_allowed:
            # 허용된 IP가 아니면 403 Forbidden 오류 발생
            print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Forbidden: Access from non-Cloudflare IP denied. IP: {client_ip} | message : Fuck You")
            return JSONResponse(
                status_code=403, 
                content={"detail": "Fuck You"}
            )
        
        # 허용된 IP이면 다음 요청으로 진행
        response = await call_next(request)
        return response
# --- 미들웨어 클래스 끝 ---


VALID_API_KEY = "s8undu8wb8uwh837hr87h7wq7dj72j7a7j7j" # API 키

app = FastAPI(title="ProsekaTTS")

# --- 여기에 미들웨어 등록 ---
app.add_middleware(CloudflareOnlyMiddleware)
# --- 미들웨어 등록 끝 ---


async def verify_api_key(request: Request):
    """
    API 키 유효성 검증
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid or missing Authorization header")
    
    token = auth_header.split(" ")[1]
    if token != VALID_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")

# ... (기존 tts_wrapper, TTSRequest, /tts 엔드포인트 코드는 그대로 유지) ...
tts_wrapper = TTSWrapper("saved_model/config.json", "saved_model/model.pth")

class TTSRequest(BaseModel):
    text: str
    speaker: str
    speed: float = 1.0
    is_phoneme: bool = False

class GeminiProxyRequest(BaseModel):
    gemini_api_key: str = Field(..., alias='gemini_api_key')
    model: str
    body: Any

@app.post("/tts", dependencies=[Depends(verify_api_key)])
def tts(request: TTSRequest):
    """
    TTS API
    - `Authorization: Bearer YOUR_API_KEY` 헤더 필요
    """
    try:
        sampling_rate, audio = tts_wrapper.infer(request.text, request.speaker, request.speed, request.is_phoneme)
        
        # WAV 데이터를 메모리 내 버퍼에 씁니다.
        wav_buffer = BytesIO()
        wavfile.write(wav_buffer, sampling_rate, (audio * 32767.0).astype(np.int16))
        wav_buffer.seek(0)
        
        # ffmpeg를 사용하여 WAV를 MP3로 변환합니다.
        ffmpeg_command = [
            "ffmpeg",
            "-i", "pipe:0",      # stdin에서 입력을 받음
            "-f", "mp3",         # 출력 포맷
            "-b:a", "320k",      # 오디오 비트레이트를 320k로 설정
            "pipe:1"             # stdout으로 출력을 보냄
        ]
        
        process = subprocess.Popen(ffmpeg_command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        mp3_output, stderr = process.communicate(input=wav_buffer.read())
        
        if process.returncode != 0:
            # ffmpeg에서 오류가 발생한 경우
            error_message = f"FFmpeg error: {stderr.decode()}"
            print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {error_message}")
            raise HTTPException(status_code=500, detail=error_message)

        # MP3 데이터를 메모리 내 버퍼에 담습니다.
        mp3_buffer = BytesIO(mp3_output)
        
        return StreamingResponse(mp3_buffer, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/gemini-proxy", dependencies=[Depends(verify_api_key)])
async def gemini_proxy(request: GeminiProxyRequest):
    """
    Gemini API 프록시
    - `Authorization: Bearer YOUR_API_KEY` 헤더 필요
    """
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{request.model}:generateContent"
    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': request.gemini_api_key
    }

    client = httpx.AsyncClient()

    try:
        gemini_request = client.build_request(
            "POST", gemini_url, json=request.body, headers=headers, timeout=120.0
        )
        response = await client.send(gemini_request, stream=True)

        excluded_headers = ["content-encoding", "transfer-encoding", "connection"]
        headers_for_client = {
            key: value for key, value in response.headers.items() if key.lower() not in excluded_headers
        }

        async def stream_and_close():
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_and_close(),
            status_code=response.status_code,
            headers=headers_for_client,
        )

    except httpx.RequestError as e:
        await client.aclose()
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error connecting to Gemini API: {e}")
        raise HTTPException(status_code=502, detail=f"Error connecting to Gemini API: {e}")
    except Exception as e:
        await client.aclose()
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] An unexpected error occurred in gemini_proxy: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")

from bs4 import BeautifulSoup
import asyncio

class ScrapeRequest(BaseModel):
    url: str

@app.post("/api/scrape", dependencies=[Depends(verify_api_key)])
async def scrape(request: ScrapeRequest):
    """
    0db.co.kr 게시글 스크래핑 API
    - `Authorization: Bearer YOUR_API_KEY` 헤더 필요
    """
    base_url = request.url
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
        "Connection": "keep-alive",
    }

    try:
        async with httpx.AsyncClient() as client:
            # 1. Get the initial page to find the author and pagination
            initial_response = await client.get(base_url, headers=headers)
            initial_response.raise_for_status()
            soup = BeautifulSoup(initial_response.text, 'lxml')

            # --- Author --- 
            author_nickname = "Not Found"
            author_element = soup.select_one('.atc_info .atc_nickname a')
            if author_element:
                author_nickname = author_element.text.strip()
            
            # --- Pagination --- 
            page_links = soup.select('.paging a.page_num')
            last_page = 1
            if page_links:
                page_numbers = [int(a.text) for a in page_links if a.text.isdigit()]
                if page_numbers:
                    last_page = max(page_numbers)

            # --- Comments --- 
            all_comments = []
            for page in range(1, last_page + 1):
                page_url = f"{base_url}?cpage={page}"
                response = await client.get(page_url, headers=headers)
                response.raise_for_status()
                page_soup = BeautifulSoup(response.text, 'lxml')

                comment_articles = page_soup.select('#comment .cmt_unit')

                for comment in comment_articles:
                    nickname_tag = comment.select_one('.nickname')
                    avatar_tag = comment.select_one('.inkpf_img')
                    content_tag = comment.select_one('.xe_content')

                    if not (nickname_tag and content_tag):
                        continue

                    user_nickname = nickname_tag.text.strip()
                    content = content_tag.text.strip()
                    
                    avatar_url = "Not Found"
                    if avatar_tag and 'src' in avatar_tag.attrs:
                        avatar_url = avatar_tag['src']
                        if not avatar_url.startswith('http'):
                            avatar_url = f"https://www.0db.co.kr{avatar_url}"

                    all_comments.append({
                        'user_nickname': user_nickname,
                        'avatar_url': avatar_url,
                        'content': content
                    })
                
                await asyncio.sleep(0.2)

            return JSONResponse(content={
                "author_nickname": author_nickname,
                "comments": all_comments
            })

    except httpx.HTTPStatusError as e:
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] HTTP error occurred: {e}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Error fetching URL: {e}")
    except Exception as e:
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] An unexpected error occurred in scrape: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")


@app.get("/robots.txt", response_class=PlainTextResponse)
async def robots_txt():
    return "User-agent: *\nDisallow: /"


if __name__ == "__main__":
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=443, 
        ssl_keyfile="key.pem", 
        ssl_certfile="cert.pem"
    )
