# Sekai Chat - AI 캐릭터 챗봇

https://sekaich.at

## 프로젝트 개요

Sekai Chat은 Cloudflare Workers, D1(SQLite), R2(오브젝트 스토리지)를 기반으로 구축된 AI 캐릭터 챗봇 애플리케이션입니다. 사용자들은 다양한 캐릭터와 대화하고, 자신만의 커스텀 캐릭터를 만들 수 있습니다.
## 주요 기능

- **캐릭터 채팅**: 다양한 AI 캐릭터와 자유롭게 대화할 수 있습니다.
- **캐릭터 생성**: 사용자가 직접 캐릭터를 만들어 다른 사용자와 공유할 수 있습니다.
- **Discord 연동**: Discord 계정으로 로그인하고 프로필 정보를 연동할 수 있습니다.
- **이미지 생성**: 특정 캐릭터와 대화 중 이미지를 생성할 수 있습니다.
- **다국어 TTS**: 합성 음성으로 캐릭터의 대사를 들을 수 있습니다.

## 기술 스택

- **프론트엔드**: HTML, CSS, JavaScript
- **백엔드**: Cloudflare Workers
- **데이터베이스**: Cloudflare D1
- **스토리지**: Cloudflare R2
- **AI**: Google Gemini
- **TTS**: VITS (Fine-Tuned for Project sekai characters)

 **의존성 설치**:
    이 프로젝트는 프론트엔드 의존성을 위해 `package.json`을 사용하지 않습니다.


## 프로젝트 구조

-   `src/`: 백엔드 Worker 스크립트
    -   `index.js`: 메인 엔트리포인트, 라우팅 처리
    -   `auth.js`: 인증 (로그인, 회원가입, Discord 연동)
    -   `gemini.js`: Google Gemini API 연동
    -   `characters.js`: 캐릭터 관련 로직
    -   `conversations.js`: 대화 참여자 관리
    -   `user-characters.js`: 유저 생성 캐릭터 관리
    -   `tts.js`: Text-to-Speech 기능
    -   `migration.js`: Kanade 마이그레이션 로직
    -   `utils.js`: 공통 유틸리티 함수
    -   `handlers/`: API 엔드포인트 핸들러
        -   `conversation-handlers.js`: 대화 CRUD 및 설정 관리
        -   `user.js`: 사용자 정보 및 설정 관리
        -   `sekai.js`: Sekai 환경 설정 관리
        -   `images.js`: 이미지 생성 및 업로드
        -   `autorag.js`: AutoRAG 검색 및 상태 확인
        -   `pages.js`: 페이지 렌더링
        -   `r2.js`: R2 스토리지 접근
        -   `notices.js`: 공지사항 관리
-   `public/`: 프론트엔드 애셋 (HTML, CSS, JS)
    -   `*.html`: 각 페이지의 HTML 파일
    -   `css/`: 스타일시트
    -   `js/`: 프론트엔드 JavaScript
-   `schema.sql`: D1 데이터베이스의 스키마 정의
-   `wrangler.toml`: Cloudflare Workers 설정 파일
-   `api.py`: Workers 외부 서버에서 실행중인 api 서버의 코드 일부(핵심 부분). (VITS 구동을 위한 GPU 관련 기능 및 프록시 기능)

## 배포

이 프로젝트는 GitHub 리포지토리의 `main` 브랜치에 푸시가 발생하면 Cloudflare Workers에 자동으로 배포됩니다. 별도의 배포 과정은 필요하지 않습니다.

