CREATE TABLE emails (
	id TEXT PRIMARY KEY,
	message_id TEXT,
	from_address TEXT NOT NULL,
	from_name TEXT NOT NULL DEFAULT '',
	to_address TEXT NOT NULL,
	subject TEXT NOT NULL DEFAULT '',
	text_body TEXT NOT NULL DEFAULT '',
	html_body TEXT NOT NULL DEFAULT '',
	received_at INTEGER NOT NULL,
	size INTEGER NOT NULL,
	raw_key TEXT NOT NULL,
	is_read INTEGER NOT NULL DEFAULT 0,
	is_starred INTEGER NOT NULL DEFAULT 0,
	is_deleted INTEGER NOT NULL DEFAULT 0,
	has_attachments INTEGER NOT NULL DEFAULT 0,
	parse_failed INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX emails_message_alias ON emails (message_id, to_address) WHERE message_id IS NOT NULL;
CREATE INDEX emails_alias_received ON emails (to_address, received_at DESC);
CREATE INDEX emails_deleted_received ON emails (is_deleted, received_at DESC);

CREATE TABLE attachments (
	id TEXT PRIMARY KEY,
	email_id TEXT NOT NULL REFERENCES emails (id) ON DELETE CASCADE,
	filename TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size INTEGER NOT NULL,
	r2_key TEXT NOT NULL
);

CREATE INDEX attachments_email ON attachments (email_id);

CREATE TABLE blocklist (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL CHECK (type IN ('sender', 'alias')),
	pattern TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE (type, pattern)
);
