import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, request, resetData, seedAttachment, seedEmail } from "./helpers";
import type { SeedEmail } from "./helpers";

const ALIAS = "shop@sato-mail.xyz";

function emptyTrash(alias = ALIAS): Promise<Response>
{
	return request(`/mailboxes/${encodeURIComponent(alias)}/trash`, { method: "DELETE" });
}

async function seedStored(overrides: Partial<SeedEmail> = {}): Promise<SeedEmail>
{
	const id = overrides.id ?? crypto.randomUUID();
	const email = await seedEmail({ id, to_address: ALIAS, raw_key: `raw/${id}.eml`, ...overrides });
	await env.BUCKET.put(email.raw_key, "RAW");
	return email;
}

async function objectKeys(): Promise<string[]>
{
	return (await env.BUCKET.list()).objects.map((object) => object.key).sort();
}

describe("DELETE /mailboxes/:alias/trash", () =>
{
	beforeEach(resetData);

	it("deletes the trashed mails of the alias with their stored objects and attachments", async () =>
	{
		const first = await seedStored({ is_deleted: 1, has_attachments: 1 });
		const second = await seedStored({ is_deleted: 1 });
		const kept = await seedStored({ is_deleted: 0 });
		const other = await seedStored({ is_deleted: 1, to_address: "other@sato-mail.xyz" });
		const attachment = await seedAttachment(first.id);
		await env.BUCKET.put(attachment.r2_key, "abc");
		const keptAttachment = await seedAttachment(kept.id);
		await env.BUCKET.put(keptAttachment.r2_key, "def");

		const response = await emptyTrash();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ deleted: 2, remaining: false });
		const rows = await queryAll<{ id: string }>("SELECT id FROM emails ORDER BY id");
		expect(rows.map((row) => row.id).sort()).toEqual([kept.id, other.id].sort());
		expect(await queryAll("SELECT id FROM attachments")).toEqual([{ id: keptAttachment.id }]);
		expect(await objectKeys()).toEqual([keptAttachment.r2_key, kept.raw_key, other.raw_key].sort());
		expect(await objectKeys()).not.toContain(first.raw_key);
		expect(await objectKeys()).not.toContain(second.raw_key);
	});

	it("removes the deleted mails from the full text index", async () =>
	{
		await seedStored({ is_deleted: 1, subject: "Invoice" });

		await emptyTrash();

		const hits = await queryAll("SELECT rowid FROM emails_fts WHERE emails_fts MATCH 'invoice'");
		expect(hits).toEqual([]);
	});

	it("works in batches and reports what is left", async () =>
	{
		for (let index = 0; index < 120; index++)
		{
			await seedEmail({ to_address: ALIAS, is_deleted: 1 });
		}

		const counts: { deleted: number; remaining: boolean }[] = [];
		for (let call = 0; call < 5; call++)
		{
			const body = await (await emptyTrash()).json() as { deleted: number; remaining: boolean };
			counts.push(body);
			if (!body.remaining)
			{
				break;
			}
		}

		expect(counts).toEqual([
			{ deleted: 50, remaining: true },
			{ deleted: 50, remaining: true },
			{ deleted: 20, remaining: false },
		]);
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
	});

	it("matches the alias regardless of case", async () =>
	{
		await seedStored({ is_deleted: 1 });

		const response = await emptyTrash("SHOP@Sato-Mail.xyz");

		expect(await response.json()).toEqual({ deleted: 1, remaining: false });
	});

	it("reports nothing to delete when the trash is empty", async () =>
	{
		await seedStored({ is_deleted: 0 });

		const response = await emptyTrash();

		expect(await response.json()).toEqual({ deleted: 0, remaining: false });
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);
	});

	it.each(["nope", "a b@c.d", "@c.d"])("rejects the invalid alias %s", async (alias) =>
	{
		expect((await emptyTrash(alias)).status).toBe(400);
	});
});
