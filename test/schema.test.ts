import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, resetData, seedEmail } from "./helpers";

async function search(term: string): Promise<string[]>
{
	const rows = await queryAll<{ id: string }>(
		"SELECT e.id FROM emails e WHERE e.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)",
		term,
	);
	return rows.map((row) => row.id);
}

describe("schema", () =>
{
	beforeEach(resetData);

	it("indexes new mails in the full text index", async () =>
	{
		const email = await seedEmail({ subject: "Invoice March", from_address: "billing@shop.com", text_body: "your parcel shipped" });

		expect(await search("invoice")).toEqual([email.id]);
		expect(await search("billing")).toEqual([email.id]);
		expect(await search("parcel")).toEqual([email.id]);
		expect(await search("unrelated")).toEqual([]);
	});

	it("reindexes when searchable columns change and keeps the index when flags change", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });

		await env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([email.id]);

		await env.DB.prepare("UPDATE emails SET subject = 'Refund' WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([]);
		expect(await search("refund")).toEqual([email.id]);
	});

	it("removes deleted mails from the index", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });

		await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([]);
	});

	it("deletes attachments with their mail", async () =>
	{
		const email = await seedEmail();
		await env.DB.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES ('a1', ?, 'f.txt', 'text/plain', 3, 'k')")
			.bind(email.id)
			.run();

		await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(email.id).run();
		expect(await queryAll("SELECT id FROM attachments")).toEqual([]);
	});

	it("rejects the same message id for the same alias but not for another alias", async () =>
	{
		await seedEmail({ message_id: "<a@x>", to_address: "one@me.org" });

		await expect(seedEmail({ message_id: "<a@x>", to_address: "one@me.org" })).rejects.toThrow();
		await expect(seedEmail({ message_id: "<a@x>", to_address: "two@me.org" })).resolves.toBeDefined();
	});

	it("allows several mails without a message id", async () =>
	{
		await seedEmail({ message_id: null });
		await expect(seedEmail({ message_id: null })).resolves.toBeDefined();
	});

	it("restricts blocklist types and rejects duplicate entries", async () =>
	{
		const insert = (type: string, pattern: string) =>
			env.DB.prepare("INSERT INTO blocklist (id, type, pattern, created_at) VALUES (?, ?, ?, 1)")
				.bind(crypto.randomUUID(), type, pattern)
				.run();

		await expect(insert("bogus", "a@b.c")).rejects.toThrow();
		await insert("sender", "a@b.c");
		await expect(insert("sender", "a@b.c")).rejects.toThrow();
		await expect(insert("alias", "a@b.c")).resolves.toBeDefined();
	});
});
