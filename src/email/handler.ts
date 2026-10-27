import PostalMime from "postal-mime";
import type { Attachment, Email } from "postal-mime";
import type { Env } from "../types";
import { isBlocked } from "./blocklist";
import { saveEmail } from "./store";
import type { IncomingAttachment } from "./store";

const MAX_SIZE = 25 * 1024 * 1024;

async function parse(raw: ArrayBuffer): Promise<Email | null>
{
	try
	{
		return await PostalMime.parse(raw);
	}
	catch (_error)
	{
		return null;
	}
}

function toIncomingAttachment(attachment: Attachment): IncomingAttachment
{
	const content = typeof attachment.content === "string"
		? new TextEncoder().encode(attachment.content)
		: attachment.content;

	return {
		filename: attachment.filename ?? "attachment",
		content_type: attachment.mimeType,
		content,
	};
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void>
{
	if (message.rawSize > MAX_SIZE)
	{
		message.setReject("message too large");
		return;
	}

	const raw = await new Response(message.raw).arrayBuffer();
	const parsed = await parse(raw);

	const senders = [message.from.toLowerCase()];
	if (parsed?.from?.address)
	{
		senders.push(parsed.from.address.toLowerCase());
	}

	if (await isBlocked(env.DB, senders, message.to.toLowerCase()))
	{
		message.setReject("rejected");
		return;
	}

	await saveEmail(env, {
		raw,
		message_id: parsed?.messageId ?? null,
		from_address: (parsed?.from?.address || message.from).toLowerCase(),
		from_name: parsed?.from?.name ?? "",
		to_address: message.to.toLowerCase(),
		subject: parsed?.subject ?? "",
		text_body: parsed?.text ?? "",
		html_body: parsed?.html ?? "",
		attachments: (parsed?.attachments ?? []).map(toIncomingAttachment),
		parse_failed: parsed === null,
	});
}
