import { emailExists, insertEmail } from "../db/emails";
import type { AttachmentRow } from "../db/emails";
import type { Env } from "../types";

export interface IncomingAttachment
{
	filename: string;
	content_type: string;
	content: ArrayBuffer | Uint8Array;
}

export interface IncomingEmail
{
	raw: ArrayBuffer;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	attachments: IncomingAttachment[];
	parse_failed: boolean;
}

export async function saveEmail(env: Env, email: IncomingEmail): Promise<string | null>
{
	if (email.message_id && await emailExists(env.DB, email.message_id, email.to_address))
	{
		return null;
	}

	const id = crypto.randomUUID();
	const rawKey = `raw/${id}.eml`;
	const keys = [rawKey];

	try
	{
		await env.BUCKET.put(rawKey, email.raw);

		const attachments: AttachmentRow[] = [];
		for (const attachment of email.attachments)
		{
			const attachmentId = crypto.randomUUID();
			const attachmentKey = `attachments/${id}/${attachmentId}`;
			keys.push(attachmentKey);
			await env.BUCKET.put(attachmentKey, attachment.content);
			attachments.push({
				id: attachmentId,
				email_id: id,
				filename: attachment.filename,
				content_type: attachment.content_type,
				size: attachment.content.byteLength,
				r2_key: attachmentKey,
			});
		}

		await insertEmail(env.DB, {
			id,
			message_id: email.message_id,
			from_address: email.from_address,
			from_name: email.from_name,
			to_address: email.to_address,
			subject: email.subject,
			text_body: email.text_body,
			html_body: email.html_body,
			received_at: Date.now(),
			size: email.raw.byteLength,
			raw_key: rawKey,
			has_attachments: attachments.length > 0 ? 1 : 0,
			parse_failed: email.parse_failed ? 1 : 0,
		}, attachments);
	}
	catch (error)
	{
		await env.BUCKET.delete(keys);
		throw error;
	}

	return id;
}
