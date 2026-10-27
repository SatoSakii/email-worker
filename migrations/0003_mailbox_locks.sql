CREATE TABLE mailbox_locks (
	alias TEXT PRIMARY KEY,
	pin_hash TEXT NOT NULL,
	pin_salt TEXT NOT NULL,
	failed_attempts INTEGER NOT NULL DEFAULT 0,
	blocked_until INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
