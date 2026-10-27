import { env } from "cloudflare:workers";
import PostalMime from "postal-mime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentRow, EmailRow } from "../src/db/emails";
import { handleEmail } from "../src/email/handler";
import { buildMail, createMessage, queryAll, resetData } from "./helpers";

async function deliver(from: string, to: string, raw: string, rawSize?: number)
{
	const { message, state } = createMessage(from, to, raw, { rawSize });
	await handleEmail(message, env);
	return state;
}

describe("handleEmail", () =>
{
	beforeEach(resetData);
	afterEach(() => vi.restoreAllMocks());

	it("stores a simple mail and its raw source", async () =>
	{
		const raw = buildMail({ from: "Bob <Bob@Example.com>", to: "Shop@Me.org", subject: "Hello", body: "plain body", messageId: "<m1@example.com>" });

		const state = await deliver("bounce@mailer.example.com", "Shop@Me.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");

		expect(state.rejected).toBeNull();
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			from_address: "bob@example.com",
			from_name: "Bob",
			to_address: "shop@me.org",
			subject: "Hello",
			message_id: "<m1@example.com>",
			is_read: 0,
			is_starred: 0,
			is_deleted: 0,
			has_attachments: 0,
			parse_failed: 0,
		});
		expect(emails[0].text_body.trim()).toBe("plain body");
		expect(emails[0].size).toBe(new TextEncoder().encode(raw).byteLength);

		const stored = await env.BUCKET.get(emails[0].raw_key);
		expect(await stored?.text()).toBe(raw);
	});

	it("stores attachments in R2 and in D1", async () =>
	{
		const raw = buildMail({ attachment: { filename: "note.txt", content: "attached text" } });

		await deliver("a@example.com", "me@example.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		const attachments = await queryAll<AttachmentRow>("SELECT * FROM attachments");

		expect(emails[0].has_attachments).toBe(1);
		expect(attachments).toHaveLength(1);
		expect(attachments[0]).toMatchObject({ email_id: emails[0].id, filename: "note.txt", content_type: "text/plain", size: 13 });
		const object = await env.BUCKET.get(attachments[0].r2_key);
		expect(await object?.text()).toBe("attached text");
	});

	it("stores an html only mail", async () =>
	{
		await deliver("a@example.com", "me@example.org", buildMail({ html: "<b>hi</b>" }));

		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		expect(emails).toHaveLength(1);
		expect(emails[0].html_body).toContain("<b>hi</b>");
		expect(emails[0].parse_failed).toBe(0);
	});

	it("accepts a mail without message id, subject or from header", async () =>
	{
		const raw = buildMail({ from: null, subject: null, messageId: null });

		await deliver("Envelope@Example.com", "me@example.org", raw);
		await deliver("Envelope@Example.com", "me@example.org", raw);

		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		expect(emails).toHaveLength(2);
		expect(emails[0]).toMatchObject({ from_address: "envelope@example.com", subject: "", message_id: null });
	});

	it("keeps the raw mail when parsing fails", async () =>
	{
		vi.spyOn(PostalMime, "parse").mockRejectedValueOnce(new Error("boom"));
		const raw = buildMail();

		await deliver("Envelope@Example.com", "me@example.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");

		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({ parse_failed: 1, from_address: "envelope@example.com", subject: "" });
		const stored = await env.BUCKET.get(emails[0].raw_key);
		expect(await stored?.text()).toBe(raw);
	});

	it("ignores a duplicate for the same alias but stores the same message for another alias", async () =>
	{
		const raw = buildMail({ messageId: "<same@example.com>" });

		await deliver("a@example.com", "one@me.org", raw);
		await deliver("a@example.com", "ONE@me.org", raw);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);

		await deliver("a@example.com", "two@me.org", raw);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(2);
	});

	it("rejects mails above 25 MB and stores nothing", async () =>
	{
		const state = await deliver("a@example.com", "me@example.org", buildMail(), 25 * 1024 * 1024 + 1);

		expect(state.rejected).toBe("message too large");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
	});
});
