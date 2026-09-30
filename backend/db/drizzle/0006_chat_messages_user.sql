-- Add user_id and user_name to chat_messages for tracking who sent messages in org conversations
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_name TEXT;
