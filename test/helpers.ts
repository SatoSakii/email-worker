import { env } from "cloudflare:workers";
import { app } from "../src/api/app";

export async function request(path: string, init: RequestInit = {}): Promise<Response>
{
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${env.API_TOKEN}`);
	return app.request(path, { ...init, headers }, env);
}

export async function requestJson(path: string, method: string, body: unknown): Promise<Response>
{
	return request(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

export interface SeedEmail
{
	id: string;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	received_at: number;
	size: number;
	raw_key: string;
	is_read: number;
	is_starred: number;
	is_deleted: number;
	has_attachments: number;
	parse_failed: number;
}

export async function queryAll<T>(sql: string, ...params: (string | number)[]): Promise<T[]>
{
	const { results } = await env.DB.prepare(sql).bind(...params).all<T>();
	return results;
}

export async function resetData(): Promise<void>
{
	await env.DB.batch([
		env.DB.prepare("DELETE FROM attachments"),
		env.DB.prepare("DELETE FROM emails"),
		env.DB.prepare("DELETE FROM blocklist"),
	]);

	const listed = await env.BUCKET.list();
	await Promise.all(listed.objects.map((object) => env.BUCKET.delete(object.key)));
}

export async function seedEmail(overrides: Partial<SeedEmail> = {}): Promise<SeedEmail>
{
	const email: SeedEmail = {
		id: crypto.randomUUID(),
		message_id: null,
		from_address: "sender@example.com",
		from_name: "",
		to_address: "me@example.org",
		subject: "subject",
		text_body: "body",
		html_body: "",
		received_at: 1000,
		size: 100,
		raw_key: "raw/seed.eml",
		is_read: 0,
		is_starred: 0,
		is_deleted: 0,
		has_attachments: 0,
		parse_failed: 0,
		...overrides,
	};
	const columns = Object.keys(email);
	const placeholders = columns.map(() => "?").join(", ");

	await env.DB.prepare(`INSERT INTO emails (${columns.join(", ")}) VALUES (${placeholders})`)
		.bind(...Object.values(email))
		.run();

	return email;
}

export interface SeedAttachment
{
	id: string;
	email_id: string;
	filename: string;
	content_type: string;
	size: number;
	r2_key: string;
}

export async function seedAttachment(email_id: string, overrides: Partial<SeedAttachment> = {}): Promise<SeedAttachment>
{
	const id = overrides.id ?? crypto.randomUUID();
	const attachment: SeedAttachment = {
		id,
		email_id,
		filename: "file.txt",
		content_type: "text/plain",
		size: 3,
		r2_key: `attachments/${email_id}/${id}`,
		...overrides,
	};

	await env.DB.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(attachment.id, attachment.email_id, attachment.filename, attachment.content_type, attachment.size, attachment.r2_key)
		.run();

	return attachment;
}

export interface MailOptions
{
	from?: string | null;
	to?: string;
	subject?: string | null;
	body?: string;
	html?: string;
	messageId?: string | null;
	attachment?: { filename: string; content: string };
}

export function buildMail(options: MailOptions = {}): string
{
	const { from = "sender@example.com", to = "me@example.org", subject = "subject", body = "body", messageId = "<id@example.com>", html, attachment } = options;
	const headers = ["MIME-Version: 1.0", `To: ${to}`];

	if (from !== null)
	{
		headers.push(`From: ${from}`);
	}
	if (subject !== null)
	{
		headers.push(`Subject: ${subject}`);
	}
	if (messageId !== null)
	{
		headers.push(`Message-ID: ${messageId}`);
	}

	if (!attachment)
	{
		const type = html === undefined ? "text/plain" : "text/html";
		return [...headers, `Content-Type: ${type}; charset=utf-8`, "", html ?? body, ""].join("\r\n");
	}

	return [
		...headers,
		"Content-Type: multipart/mixed; boundary=\"b1\"",
		"",
		"--b1",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
		"--b1",
		`Content-Type: text/plain; name="${attachment.filename}"`,
		`Content-Disposition: attachment; filename="${attachment.filename}"`,
		"Content-Transfer-Encoding: base64",
		"",
		btoa(attachment.content),
		"--b1--",
		"",
	].join("\r\n");
}

export function createMessage(from: string, to: string, raw: string, options: { rawSize?: number } = {})
{
	const bytes = new TextEncoder().encode(raw);
	const state: { rejected: string | null } = { rejected: null };
	const message = {
		from,
		to,
		headers: new Headers(),
		raw: new Blob([bytes]).stream(),
		rawSize: options.rawSize ?? bytes.byteLength,
		setReject(reason: string)
		{
			state.rejected = reason;
		},
		async forward()
		{
		},
		async reply()
		{
		},
	};

	return { message: message as unknown as ForwardableEmailMessage, state };
}
