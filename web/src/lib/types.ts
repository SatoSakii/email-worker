export type Folder = "inbox" | "starred" | "trash";

export interface MailSummary
{
	id: string;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	received_at: number;
	size: number;
	is_read: boolean;
	is_starred: boolean;
	is_deleted: boolean;
	has_attachments: boolean;
	parse_failed: boolean;
}

export interface MailAttachment
{
	id: string;
	filename: string;
	content_type: string;
	size: number;
}

export interface MailDetail extends MailSummary
{
	message_id: string | null;
	text_body: string;
	html_body: string;
	attachments: MailAttachment[];
}

export interface MailPage
{
	emails: MailSummary[];
	next_cursor: string | null;
}

export interface MailboxStatus
{
	alias: string;
	locked: boolean;
	unlocked: boolean;
	retry_after: number;
}

export interface FlagPatch
{
	is_read?: boolean;
	is_starred?: boolean;
	is_deleted?: boolean;
}

export interface TrashResult
{
	deleted: number;
	remaining: boolean;
}

export interface Usage
{
	used: number;
	limit: number;
}

export interface TotpKey
{
	id: string;
	name: string;
	secret: string;
	digits: number;
	period: number;
	algorithm: "SHA-1" | "SHA-256" | "SHA-512";
}

export type NewTotpKey = Omit<TotpKey, "id">;
