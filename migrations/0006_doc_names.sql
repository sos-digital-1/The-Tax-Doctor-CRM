-- keep the file name the sender used, next to the tidy display name we give it
ALTER TABLE documents ADD COLUMN original_name TEXT;
