
-- Dating character basic information table
CREATE TABLE IF NOT EXISTS dating_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    internal_prompt TEXT NOT NULL, -- Private prompt not shown to users
    likes TEXT, -- Comma-separated list
    dislikes TEXT, -- Comma-separated list
    profile_image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-specific character affection and memory table
CREATE TABLE IF NOT EXISTS user_character_affection (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    friendship_level INTEGER DEFAULT 50,
    romantic_level INTEGER DEFAULT 50,
    character_memory TEXT, -- Character's thoughts and memories about the user
    last_memory_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (character_id) REFERENCES dating_characters(id),
    UNIQUE(user_id, character_id)
);

-- Dating simulation conversations
CREATE TABLE IF NOT EXISTS dating_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    title TEXT,
    current_location TEXT DEFAULT 'online',
    time_mode TEXT DEFAULT 'auto', -- 'auto', 'morning', 'day', 'night', 'dawn'
    current_time TEXT DEFAULT 'morning', -- Current time period
    current_date TEXT DEFAULT '2025.04.25', -- Current date in conversation
    random_events_enabled INTEGER DEFAULT 1,
    next_affection_update INTEGER DEFAULT 5, -- Next message count for affection update
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (character_id) REFERENCES dating_characters(id)
);

-- Dating simulation messages
CREATE TABLE IF NOT EXISTS dating_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dating_conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL, -- 'user' or 'assistant'
    content TEXT NOT NULL,
    message_time TEXT NOT NULL, -- 'morning', 'day', 'night', 'dawn'
    location TEXT NOT NULL,
    is_offline_meeting INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dating_conversation_id) REFERENCES dating_conversations(id) ON DELETE CASCADE
);

-- Checkpoints (enhanced to save ALL conversation state)
CREATE TABLE IF NOT EXISTS dating_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dating_conversation_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    conversation_data TEXT NOT NULL, -- JSON data with complete message history
    current_location TEXT NOT NULL,
    time_mode TEXT NOT NULL,
    current_time TEXT NOT NULL,
    current_date TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    character_memory TEXT, -- Character's memory state at checkpoint time
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dating_conversation_id) REFERENCES dating_conversations(id) ON DELETE CASCADE
);

-- Random events log
CREATE TABLE IF NOT EXISTS dating_random_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dating_conversation_id INTEGER NOT NULL,
    event_type TEXT NOT NULL, -- 'late', 'rain', etc.
    event_data TEXT, -- JSON data for event details
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dating_conversation_id) REFERENCES dating_conversations(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_character_affection_user_character ON user_character_affection(user_id, character_id);
CREATE INDEX IF NOT EXISTS idx_dating_conversations_user_character ON dating_conversations(user_id, character_id);
CREATE INDEX IF NOT EXISTS idx_dating_messages_conversation ON dating_messages(dating_conversation_id);
CREATE INDEX IF NOT EXISTS idx_dating_checkpoints_conversation ON dating_checkpoints(dating_conversation_id);
CREATE INDEX IF NOT EXISTS idx_dating_random_events_conversation ON dating_random_events(dating_conversation_id);
