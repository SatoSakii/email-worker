import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { request, resetData, seedAttachment, seedEmail } from "./helpers";

interface ListBody
{
	emails: { id: string }[];
	next_cursor: string | null;
}

async function list(query: string): Promise<ListBody>
{
	const response = await request(`/emails${query}`);
	expect(response.status).toBe(200);
	return await response.json() as ListBody;
}

async function listIds(query: string): Promise<string[]>
{
	return (await list(query)).emails.map((email) => email.id);
}

describe("GET /emails", () =>
{
	beforeEach(resetData);

	it("lists newest first and hides the trash", async () =>
	{
		const old = await seedEmail({ received_at: 1000 });
		const recent = await seedEmail({ received_at: 3000 });
		const middle = await seedEmail({ received_at: 2000 });
		await seedEmail({ received_at: 4000, is_deleted: 1 });

		expect(await listIds("")).toEqual([recent.id, middle.id, old.id]);
	});

	it("returns only the trash with trash=1", async () =>
	{
		await seedEmail();
		const trashed = await seedEmail({ is_deleted: 1 });

		expect(await listIds("?trash=1")).toEqual([trashed.id]);
	});

	it("filters by alias regardless of case", async () =>
	{
		const shop = await seedEmail({ to_address: "shop@me.org" });
		await seedEmail({ to_address: "news@me.org" });

		expect(await listIds("?alias=SHOP@Me.org")).toEqual([shop.id]);
	});

	it("filters unread and starred mails", async () =>
	{
		const unread = await seedEmail({ is_read: 0, received_at: 2000 });
		const starred = await seedEmail({ is_read: 1, is_starred: 1, received_at: 1000 });

		expect(await listIds("?unread=1")).toEqual([unread.id]);
		expect(await listIds("?starred=1")).toEqual([starred.id]);
	});

	it("does not skip or repeat mails sharing a timestamp across pages", async () =>
	{
		const ids = [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
		for (const id of ids)
		{
			await seedEmail({ id, received_at: 5000 });
		}
		const older = await seedEmail({ received_at: 4000 });

		const first = await list("?limit=2");
		expect(first.emails.map((email) => email.id)).toEqual([ids[2], ids[1]]);
		expect(first.next_cursor).toBe(`5000:${ids[1]}`);

		const second = await list(`?limit=2&cursor=${first.next_cursor}`);
		expect(second.emails.map((email) => email.id)).toEqual([ids[0], older.id]);
		expect(second.next_cursor).toBeNull();
	});

	it("accepts a limit above the maximum by clamping it", async () =>
	{
		await seedEmail();
		expect(await listIds("?limit=1000")).toHaveLength(1);
	});

	it.each(["?limit=0", "?limit=abc", "?limit=1.5", "?limit=-3", "?cursor=nope", "?cursor=5000:xyz"])("rejects %s", async (query) =>
	{
		expect((await request(`/emails${query}`)).status).toBe(400);
	});

	it("returns summaries without bodies or storage keys", async () =>
	{
		await seedEmail({ is_starred: 1 });

		const body = await (await request("/emails")).json() as { emails: Record<string, unknown>[] };

		expect(Object.keys(body.emails[0]).sort()).toEqual([
			"from_address",
			"from_name",
			"has_attachments",
			"id",
			"is_deleted",
			"is_read",
			"is_starred",
			"parse_failed",
			"received_at",
			"size",
			"subject",
			"to_address",
		]);
		expect(body.emails[0]).toMatchObject({ is_read: false, is_starred: true, is_deleted: false });
	});
});

describe("GET /emails/:id", () =>
{
	beforeEach(resetData);

	it("returns the full mail with its attachments", async () =>
	{
		const email = await seedEmail({ subject: "Hello", text_body: "text", html_body: "<p>html</p>", has_attachments: 1, is_starred: 1 });
		const attachment = await seedAttachment(email.id, { filename: "a.pdf", content_type: "application/pdf", size: 42 });

		const response = await request(`/emails/${email.id}`);
		const body = await response.json() as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			id: email.id,
			subject: "Hello",
			text_body: "text",
			html_body: "<p>html</p>",
			is_starred: true,
			is_read: false,
			has_attachments: true,
			attachments: [{ id: attachment.id, filename: "a.pdf", content_type: "application/pdf", size: 42 }],
		});
		expect(body).not.toHaveProperty("raw_key");
	});

	it("still shows a trashed mail", async () =>
	{
		const email = await seedEmail({ is_deleted: 1 });
		expect((await request(`/emails/${email.id}`)).status).toBe(200);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await request("/emails/unknown")).status).toBe(404);
	});
});

describe("GET /emails/:id/raw", () =>
{
	beforeEach(resetData);

	it("streams the stored source", async () =>
	{
		await env.BUCKET.put("raw/x.eml", "RAW SOURCE");
		const email = await seedEmail({ raw_key: "raw/x.eml" });

		const response = await request(`/emails/${email.id}/raw`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("message/rfc822");
		expect(await response.text()).toBe("RAW SOURCE");
	});

	it("returns 404 when the mail or the object is missing", async () =>
	{
		const email = await seedEmail({ raw_key: "raw/missing.eml" });

		expect((await request(`/emails/${email.id}/raw`)).status).toBe(404);
		expect((await request("/emails/unknown/raw")).status).toBe(404);
	});
});

describe("GET /attachments/:id", () =>
{
	beforeEach(resetData);

	it("downloads the file as an attachment with safe headers", async () =>
	{
		const email = await seedEmail();
		const attachment = await seedAttachment(email.id, { filename: "evil\"\r\nX: y.html", content_type: "text/html", size: 5 });
		await env.BUCKET.put(attachment.r2_key, "<b>x</b>");

		const response = await request(`/attachments/${attachment.id}`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(response.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''evil%22%0D%0AX%3A%20y.html");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await response.text()).toBe("<b>x</b>");
	});

	it("returns 404 for an unknown attachment or a missing object", async () =>
	{
		const email = await seedEmail();
		const attachment = await seedAttachment(email.id);

		expect((await request("/attachments/unknown")).status).toBe(404);
		expect((await request(`/attachments/${attachment.id}`)).status).toBe(404);
	});
});
