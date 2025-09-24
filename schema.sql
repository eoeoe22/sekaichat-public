CREATE TABLE characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nickname TEXT,
    profile_image TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, sekai TEXT, name_code TEXT, first_name TEXT, "first_name_jp" TEXT)

CREATE TABLE conversation_history_cache (
    conversation_id INTEGER PRIMARY KEY,
    history TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES "temp_conversations"(id) ON DELETE CASCADE
)

CREATE TABLE conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    character_type TEXT NOT NULL DEFAULT 'official',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    affection_level INTEGER DEFAULT 0 CHECK (affection_level >= -100 AND affection_level <= 100),
    affection_type TEXT DEFAULT 'friendship' NOT NULL CHECK (affection_type IN ('friendship', 'love')),
    message_count INTEGER DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES "temp_conversations"(id) ON DELETE CASCADE
)

CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_favorite INTEGER DEFAULT 0,
    work_mode INTEGER DEFAULT 0,
    show_time_info INTEGER DEFAULT 1,
    situation_prompt TEXT DEFAULT '',
    knowledge_ids TEXT DEFAULT '[]',
    use_affection_sys INTEGER NOT NULL DEFAULT 0 CHECK (use_affection_sys IN (0, 1)),
    auto_reply_mode_enabled INTEGER DEFAULT 0,
    use_autorag_memory INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
)

CREATE TABLE dating_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    internal_prompt TEXT NOT NULL, -- Private prompt not shown to users
    likes TEXT, -- Comma-separated list
    dislikes TEXT, -- Comma-separated list
    profile_image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE dating_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dating_conversation_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    conversation_data TEXT NOT NULL,
    current_location TEXT NOT NULL,
    time_mode TEXT NOT NULL,
    current_time TEXT NOT NULL,
    current_date TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    character_memory TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dating_conversation_id) REFERENCES "temp_dating_conversations"(id) ON DELETE CASCADE
)

CREATE TABLE dating_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    title TEXT,
    current_location TEXT DEFAULT 'online',
    time_mode TEXT DEFAULT 'auto',
    current_time TEXT DEFAULT 'morning',
    current_date TEXT DEFAULT '2025.04.25',
    random_events_enabled INTEGER DEFAULT 1,
    next_affection_update INTEGER DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (character_id) REFERENCES dating_characters(id)
)

CREATE TABLE dating_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dating_conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    message_time TEXT NOT NULL,
    location TEXT NOT NULL,
    is_offline_meeting INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dating_conversation_id) REFERENCES "temp_dating_conversations"(id) ON DELETE CASCADE
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

CREATE TABLE knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    character_type TEXT DEFAULT 'official' NOT NULL,
    user_characters_id integer,
    user_character_id INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES "temp_conversations"(id),
    FOREIGN KEY (character_id) REFERENCES characters(id),
    FOREIGN KEY (file_id) REFERENCES "temp_files"(id)
)

CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE sekai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    image_path TEXT,
    description TEXT
)

CREATE TABLE user_character_affection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    friendship_level INTEGER DEFAULT 50,
    romantic_level INTEGER DEFAULT 50,
    character_memory TEXT,
    last_memory_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (character_id) REFERENCES dating_characters(id),
    UNIQUE(user_id, character_id)
)

CREATE TABLE "user_characters" (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    profile_image_r2 TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
, sekai TEXT)

CREATE TABLE user_sekai_preferences (
    user_id INTEGER NOT NULL,
    sekai TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, sekai),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
    max_auto_call_sequence INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, tts_language_preference TEXT DEFAULT 'jp')


