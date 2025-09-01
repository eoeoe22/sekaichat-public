CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nickname TEXT,
    profile_image TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    sekai TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_favorite INTEGER DEFAULT 0, work_mode INTEGER DEFAULT 0, show_time_info INTEGER DEFAULT 1, situation_prompt TEXT DEFAULT '', knowledge_ids TEXT DEFAULT '[]', use_affection_sys INTEGER NOT NULL DEFAULT 0 CHECK (use_affection_sys IN (0, 1)), auto_reply_mode_enabled INTEGER DEFAULT 0,

CREATE TABLE conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    character_type TEXT NOT NULL DEFAULT 'official', -- 'official' 또는 'user'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    affection_level INTEGER DEFAULT 0 CHECK (affection_level >= -100 AND affection_level <= 100),
    affection_type TEXT DEFAULT 'friendship' NOT NULL CHECK (affection_type IN ('friendship', 'love')),
    message_count INTEGER DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    -- character_id에 대한 외래키 제약조건 제거
)

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    character_id INTEGER,
    message_type TEXT DEFAULT 'text',
    file_id INTEGER,
    auto_call_sequence INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, character_type TEXT DEFAULT 'official' NOT NULL, user_characters_id integer, user_character_id INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (character_id) REFERENCES characters(id),
    FOREIGN KEY (file_id) REFERENCES files(id)
)

CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE "user_characters" (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    profile_image_r2 TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    sekai TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
)

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    nickname TEXT NOT NULL,
    self_introduction TEXT,
    gemini_api_key TEXT,
    discord_id TEXT UNIQUE,
    discord_username TEXT,
    discord_avatar TEXT,
    profile_image TEXT,
    profile_image_visible INTEGER DEFAULT 1,
    max_auto_call_sequence INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE conversation_history_cache (
    conversation_id INTEGER PRIMARY KEY,
    history TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)

CREATE TABLE knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE user_sekai_preferences (
    user_id INTEGER NOT NULL,
    sekai TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, sekai),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);CREATE TABLE sekai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    image_path TEXT,
    description TEXT
);

INSERT INTO sekai (name, description) VALUES ('프로젝트 세카이', '프로젝트 세카이 컬러풀 스테이지! feat. 하츠네 미쿠의 등장인물입니다.');
INSERT INTO sekai (name, description) VALUES ('Google', 'Google의 AI 캐릭터입니다.');
