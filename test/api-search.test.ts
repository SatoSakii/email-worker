import { beforeEach, describe, expect, it } from "vitest";
import { toFtsQuery } from "../src/db/emails";
import { request, requestJson, resetData, seedEmail } from "./helpers";

async function search(q: string, extra = ""): Promise<string[]>
{
	const response = await request(`/emails?q=${encodeURIComponent(q)}${extra}`);
	expect(response.status).toBe(200);
	const body = await response.json() as { emails: { id: string }[] };
	return body.emails.map((email) => email.id);
}

describe("toFtsQuery", () =>
{
	it("quotes every term and escapes quotes", () =>
	{
		expect(toFtsQuery("hello  world")).toBe("\"hello\" \"world\"");
		expect(toFtsQuery("say \"hi\"")).toBe("\"say\" \"\"\"hi\"\"\"");
	});

	it("returns null when no term contains a letter or a digit", () =>
	{
		expect(toFtsQuery("   ")).toBeNull();
		expect(toFtsQuery("- * (")).toBeNull();
	});
});

describe("GET /emails?q=", () =>
{
	beforeEach(resetData);

	it("finds mails by subject, sender and body regardless of case", async () =>
	{
		const bySubject = await seedEmail({ subject: "Invoice March" });
		const bySender = await seedEmail({ from_address: "billing@shop.com" });
		const byBody = await seedEmail({ text_body: "your parcel shipped" });

		expect(await search("INVOICE")).toEqual([bySubject.id]);
		expect(await search("billing")).toEqual([bySender.id]);
		expect(await search("parcel")).toEqual([byBody.id]);
	});

	it("requires every term", async () =>
	{
		const both = await seedEmail({ subject: "Invoice March", received_at: 2000 });
		await seedEmail({ subject: "Invoice April", received_at: 1000 });

		expect(await search("invoice march")).toEqual([both.id]);
	});

	it("combines with the alias filter and excludes the trash", async () =>
	{
		const kept = await seedEmail({ subject: "Invoice", to_address: "shop@me.org" });
		await seedEmail({ subject: "Invoice", to_address: "news@me.org" });
		await seedEmail({ subject: "Invoice", to_address: "shop@me.org", is_deleted: 1 });

		expect(await search("invoice", "&alias=shop@me.org")).toEqual([kept.id]);
	});

	it("keeps finding a mail after its flags change", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });
		await requestJson(`/emails/${email.id}`, "PATCH", { is_read: true, is_starred: true });

		expect(await search("invoice")).toEqual([email.id]);
	});

	it("paginates search results", async () =>
	{
		await seedEmail({ subject: "Invoice", received_at: 2000 });
		await seedEmail({ subject: "Invoice", received_at: 1000 });

		const first = await (await request("/emails?q=invoice&limit=1")).json() as { emails: unknown[]; next_cursor: string };
		expect(first.emails).toHaveLength(1);

		const second = await (await request(`/emails?q=invoice&limit=1&cursor=${first.next_cursor}`)).json() as { emails: unknown[]; next_cursor: string | null };
		expect(second.emails).toHaveLength(1);
		expect(second.next_cursor).toBeNull();
	});

	it("ignores an empty query", async () =>
	{
		await seedEmail();
		expect(await search("")).toHaveLength(1);
		expect(await search("   ")).toHaveLength(1);
	});

	it.each(["\"", "*", "-", "OR", "AND", "NOT", "(", ")", "a:b", "^x", "'", "\"unterminated", "foo OR", "NEAR(", "é"])("does not fail on special input %s", async (q) =>
	{
		await seedEmail({ subject: "Invoice" });
		const response = await request(`/emails?q=${encodeURIComponent(q)}`);
		expect(response.status).toBe(200);
	});

	it("returns nothing for a query made only of punctuation", async () =>
	{
		await seedEmail();
		expect(await search("- *")).toEqual([]);
	});
});
