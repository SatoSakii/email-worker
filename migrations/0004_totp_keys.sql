CREATE TABLE totp_keys (
	id TEXT PRIMARY KEY,
	alias TEXT NOT NULL,
	name TEXT NOT NULL,
	secret TEXT NOT NULL,
	digits INTEGER NOT NULL DEFAULT 6,
	period INTEGER NOT NULL DEFAULT 30,
	algorithm TEXT NOT NULL DEFAULT 'SHA-1',
	created_at INTEGER NOT NULL
);

CREATE INDEX idx_totp_keys_alias ON totp_keys (alias, created_at);
