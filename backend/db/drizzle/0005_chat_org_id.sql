-- Add org_id to chat_conversations for org-scoped shared conversations
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_org
  ON chat_conversations(org_id, updated_at DESC);
