import { describe, expect, it } from "vitest";
import { isPrefix, toAlias, toPrefix } from "@/lib/alias";

describe("toAlias", () =>
{
	it("appends the domain to a typed prefix", () =>
	{
		expect(toAlias("test123", "sato-mail.xyz")).toBe("test123@sato-mail.xyz");
	});

	it("trims and lowercases the input", () =>
	{
		expect(toAlias("  Test123  ", "sato-mail.xyz")).toBe("test123@sato-mail.xyz");
	});

	it("accepts a full address on the configured domain", () =>
	{
		expect(toAlias("Shop@Sato-Mail.xyz", "sato-mail.xyz")).toBe("shop@sato-mail.xyz");
	});

	it("keeps dots, plus signs, dashes and underscores", () =>
	{
		expect(toAlias("a.b+c-d_e", "sato-mail.xyz")).toBe("a.b+c-d_e@sato-mail.xyz");
	});

	it.each([
		"",
		"   ",
		"a b",
		"a@other.com",
		"a@sato-mail.xyz@sato-mail.xyz",
		"@sato-mail.xyz",
		"a/b",
		"a\\b",
		"a%40b",
		"../x",
		"<script>",
		"é",
		"a".repeat(65),
	])("rejects %j", (input) =>
	{
		expect(toAlias(input, "sato-mail.xyz")).toBeNull();
	});

	it("accepts the longest allowed prefix", () =>
	{
		expect(toAlias("a".repeat(64), "sato-mail.xyz")).toBe(`${"a".repeat(64)}@sato-mail.xyz`);
	});
});

describe("isPrefix", () =>
{
	it("matches what toAlias accepts as a bare prefix", () =>
	{
		expect(isPrefix("test123")).toBe(true);
		expect(isPrefix("Test123")).toBe(true);
		expect(isPrefix("a b")).toBe(false);
		expect(isPrefix("")).toBe(false);
	});
});

describe("toPrefix", () =>
{
	it("returns the part before the last at sign", () =>
	{
		expect(toPrefix("test123@sato-mail.xyz")).toBe("test123");
	});
});
