import { describe, expect, it } from "vitest";
import { decodeBase32, generateCode, groupCode, parseTotpInput, secondsLeft } from "@/lib/totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () =>
{
	it("decodes base32 and rejects invalid characters", () =>
	{
		expect(new TextDecoder().decode(decodeBase32(RFC_SECRET) as Uint8Array)).toBe("12345678901234567890");
		expect(decodeBase32("gezd gnbv-gy3t")).not.toBeNull();
		expect(decodeBase32("abc1")).toBeNull();
		expect(decodeBase32("")).toBeNull();
	});

	it("matches the RFC 6238 SHA-1 vectors", async () =>
	{
		const account = { secret: RFC_SECRET, digits: 8, period: 30, algorithm: "SHA-1" as const };

		expect(await generateCode(account, 59_000)).toBe("94287082");
		expect(await generateCode(account, 1_111_111_109_000)).toBe("07081804");
		expect(await generateCode(account, 20_000_000_000_000)).toBe("65353130");
		expect(await generateCode({ ...account, digits: 6 }, 59_000)).toBe("287082");
	});

	it("supports other hash algorithms", async () =>
	{
		const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";

		expect(await generateCode({ secret, digits: 8, period: 30, algorithm: "SHA-512" }, 59_000)).toBe("90693936");
	});

	it("parses a raw key", () =>
	{
		expect(parseTotpInput("gezd gnbv gy3t qojq")).toEqual({ name: "", secret: "GEZDGNBVGY3TQOJQ", digits: 6, period: 30, algorithm: "SHA-1" });
		expect(parseTotpInput("short")).toBeNull();
		expect(parseTotpInput("not base 32 !!!!")).toBeNull();
	});

	it("parses an otpauth link", () =>
	{
		const parsed = parseTotpInput("otpauth://totp/GitHub:sato%40example.com?secret=GEZDGNBVGY3TQOJQ&issuer=GitHub&digits=8&period=60&algorithm=SHA256");

		expect(parsed).toEqual({ name: "GitHub (sato@example.com)", secret: "GEZDGNBVGY3TQOJQ", digits: 8, period: 60, algorithm: "SHA-256" });
		expect(parseTotpInput("otpauth://totp/Site?secret=GEZDGNBVGY3TQOJQ")?.name).toBe("Site");
		expect(parseTotpInput("otpauth://hotp/Site?secret=GEZDGNBVGY3TQOJQ")).toBeNull();
		expect(parseTotpInput("otpauth://totp/Site")).toBeNull();
		expect(parseTotpInput("otpauth://totp/Site?secret=GEZDGNBVGY3TQOJQ&digits=99")?.digits).toBe(6);
	});

	it("computes the remaining seconds and groups codes", () =>
	{
		expect(secondsLeft(30, 0)).toBe(30);
		expect(secondsLeft(30, 29_999)).toBe(1);
		expect(groupCode("123456")).toBe("123 456");
		expect(groupCode("12345678")).toBe("1234 5678");
	});
});
