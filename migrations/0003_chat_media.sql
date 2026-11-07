ALTER TABLE chat_messages ADD COLUMN file_key TEXT;
ALTER TABLE chat_messages ADD COLUMN file_name TEXT;
ALTER TABLE chat_messages ADD COLUMN file_mime TEXT;
ALTER TABLE chat_messages ADD COLUMN file_size INTEGER;
