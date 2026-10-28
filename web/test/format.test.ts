import { describe, expect, it } from "vitest";
import { formatStorage, usagePercent } from "@/lib/client";

describe("formatStorage", () =>
{
	it.each([
		[0, "0 o"],
		[999, "999 o"],
		[14_235, "14,2 Ko"],
		[7_115_000, "7,1 Mo"],
		[999_000_000, "999 Mo"],
		[2_345_000_000, "2,35 Go"],
		[9_000_000_000, "9 Go"],
		[12_000_000_000, "12 Go"],
	])("shows %d bytes as %s", (bytes, expected) =>
	{
		expect(formatStorage(bytes)).toBe(expected);
	});

	it.each([-5, Number.NaN, Number.POSITIVE_INFINITY])("falls back to zero for %s", (bytes) =>
	{
		expect(formatStorage(bytes)).toBe("0 o");
	});
});

describe("usagePercent", () =>
{
	it("returns the share of the limit that is used", () =>
	{
		expect(usagePercent(2_250_000_000, 9_000_000_000)).toBe(25);
		expect(usagePercent(0, 9_000_000_000)).toBe(0);
	});

	it("never goes above 100 or below 0", () =>
	{
		expect(usagePercent(10_000_000_000, 9_000_000_000)).toBe(100);
		expect(usagePercent(-1, 9_000_000_000)).toBe(0);
	});

	it("is zero without a usable limit", () =>
	{
		expect(usagePercent(5, 0)).toBe(0);
		expect(usagePercent(5, Number.NaN)).toBe(0);
	});
});
