CREATE VIRTUAL TABLE emails_fts USING fts5 (subject, from_address, text_body, content = 'emails', content_rowid = 'rowid');

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
	INSERT INTO emails_fts (rowid, subject, from_address, text_body) VALUES (new.rowid, new.subject, new.from_address, new.text_body);
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
	INSERT INTO emails_fts (emails_fts, rowid, subject, from_address, text_body) VALUES ('delete', old.rowid, old.subject, old.from_address, old.text_body);
END;

CREATE TRIGGER emails_fts_update AFTER UPDATE OF subject, from_address, text_body ON emails BEGIN
	INSERT INTO emails_fts (emails_fts, rowid, subject, from_address, text_body) VALUES ('delete', old.rowid, old.subject, old.from_address, old.text_body);
	INSERT INTO emails_fts (rowid, subject, from_address, text_body) VALUES (new.rowid, new.subject, new.from_address, new.text_body);
END;
