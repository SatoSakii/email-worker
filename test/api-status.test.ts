import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, request, requestJson, resetData, seedAttachment, seedEmail } from "./helpers";

describe("PATCH /emails/:id", () =>
{
	beforeEach(resetData);

	it("updates flags and returns booleans", async () =>
	{
		const email = await seedEmail();

		const response = await requestJson(`/emails/${email.id}`, "PATCH", { is_read: true, is_starred: true });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: email.id, is_read: true, is_starred: true, is_deleted: false });
	});

	it("only changes the flags that are sent", async () =>
	{
		const email = await seedEmail({ is_read: 1, is_starred: 1 });

		await requestJson(`/emails/${email.id}`, "PATCH", { is_starred: false });
		const rows = await queryAll<{ is_read: number; is_starred: number }>("SELECT is_read, is_starred FROM emails WHERE id = ?", email.id);

		expect(rows[0]).toEqual({ is_read: 1, is_starred: 0 });
	});

	it("moves a mail to the trash and back", async () =>
	{
		const email = await seedEmail();

		await requestJson(`/emails/${email.id}`, "PATCH", { is_deleted: true });
		expect((await (await request("/emails")).json() as { emails: unknown[] }).emails).toHaveLength(0);

		await requestJson(`/emails/${email.id}`, "PATCH", { is_deleted: false });
		expect((await (await request("/emails")).json() as { emails: unknown[] }).emails).toHaveLength(1);
	});

	it.each([
		[{ is_read: 1 }],
		[{ is_read: "true" }],
		[{ is_read: null }],
		[{}],
		[{ unknown: true }],
		[[]],
		[null],
	])("rejects invalid body %j", async (body) =>
	{
		const email = await seedEmail();
		expect((await requestJson(`/emails/${email.id}`, "PATCH", body)).status).toBe(400);
	});

	it("rejects a body that is not json", async () =>
	{
		const email = await seedEmail();
		expect((await request(`/emails/${email.id}`, { method: "PATCH", body: "{nope" })).status).toBe(400);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await requestJson("/emails/unknown", "PATCH", { is_read: true })).status).toBe(404);
	});
});

describe("DELETE /emails/:id", () =>
{
	beforeEach(resetData);

	it("refuses to delete a mail that is not in the trash", async () =>
	{
		const email = await seedEmail();

		const response = await request(`/emails/${email.id}`, { method: "DELETE" });

		expect(response.status).toBe(409);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);
	});

	it("deletes a trashed mail, its attachments and its stored objects", async () =>
	{
		await env.BUCKET.put("raw/x.eml", "RAW");
		const email = await seedEmail({ raw_key: "raw/x.eml", is_deleted: 1, has_attachments: 1, subject: "Invoice" });
		const attachment = await seedAttachment(email.id);
		await env.BUCKET.put(attachment.r2_key, "abc");

		const response = await request(`/emails/${email.id}`, { method: "DELETE" });

		expect(response.status).toBe(204);
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect(await queryAll("SELECT id FROM attachments")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
		expect((await request(`/emails/${email.id}`)).status).toBe(404);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await request("/emails/unknown", { method: "DELETE" })).status).toBe(404);
	});
});
