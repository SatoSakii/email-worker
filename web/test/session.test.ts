import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "@/lib/session";

const SECRET = "test-session-secret-0123456789abcdef";

describe("session", () =>
{
	it("round-trips the unlocked aliases", () =>
	{
		const value = encodeSession(["a@x.com", "b@x.com"], SECRET, 1000);

		expect(decodeSession(value, SECRET, 2000)).toEqual(["a@x.com", "b@x.com"]);
	});

	it("returns nothing without a cookie", () =>
	{
		expect(decodeSession(undefined, SECRET)).toEqual([]);
		expect(decodeSession("", SECRET)).toEqual([]);
	});

	it("ignores a cookie signed with another secret", () =>
	{
		const value = encodeSession(["a@x.com"], "another-secret-another-secret-00", 1000);

		expect(decodeSession(value, SECRET, 2000)).toEqual([]);
	});

	it("ignores a cookie whose payload was edited", () =>
	{
		const value = encodeSession(["a@x.com"], SECRET, 1000);
		const [, signature] = value.split(".");
		const forged = Buffer.from(JSON.stringify({ a: ["victim@x.com"], e: 99999999999999 })).toString("base64url");

		expect(decodeSession(`${forged}.${signature}`, SECRET, 2000)).toEqual([]);
	});

	it("ignores an expired cookie", () =>
	{
		const value = encodeSession(["a@x.com"], SECRET, 1000);

		expect(decodeSession(value, SECRET, 1000 + 1000 * 60 * 60 * 24)).toEqual([]);
	});

	it.each(["nodot", ".", "a.b.c", "%%%.%%%", "e30.", ".e30"])("ignores the malformed cookie %j", (value) =>
	{
		expect(decodeSession(value, SECRET)).toEqual([]);
	});

	it("keeps at most twenty aliases, newest last", () =>
	{
		const aliases = Array.from({ length: 25 }, (_, index) => `a${index}@x.com`);

		const decoded = decodeSession(encodeSession(aliases, SECRET, 1000), SECRET, 2000);

		expect(decoded).toHaveLength(20);
		expect(decoded[19]).toBe("a24@x.com");
	});
});
