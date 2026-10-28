export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpInput
{
	name: string;
	secret: string;
	digits: number;
	period: number;
	algorithm: TotpAlgorithm;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGORITHMS: Record<string, TotpAlgorithm> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

export function normalizeSecret(value: string): string
{
	return value.replace(/[\s=-]/g, "").toUpperCase();
}

export function decodeBase32(value: string): Uint8Array | null
{
	const clean = normalizeSecret(value);
	if (clean === "")
	{
		return null;
	}

	const bytes: number[] = [];
	let bits = 0;
	let buffer = 0;

	for (const char of clean)
	{
		const index = ALPHABET.indexOf(char);
		if (index === -1)
		{
			return null;
		}
		buffer = (buffer << 5) | index;
		bits += 5;
		if (bits >= 8)
		{
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}

	return new Uint8Array(bytes);
}

function boundedInt(value: string | null, fallback: number, min: number, max: number): number
{
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function parseTotpInput(input: string): TotpInput | null
{
	const text = input.trim();

	if (/^otpauth:\/\//i.test(text))
	{
		let url: URL;
		try
		{
			url = new URL(text);
		}
		catch
		{
			return null;
		}
		if (url.hostname.toLowerCase() !== "totp")
		{
			return null;
		}

		const secret = normalizeSecret(url.searchParams.get("secret") ?? "");
		if (!decodeBase32(secret))
		{
			return null;
		}

		let label = url.pathname.replace(/^\//, "");
		try
		{
			label = decodeURIComponent(label);
		}
		catch
		{
			label = url.pathname.replace(/^\//, "");
		}
		const issuer = url.searchParams.get("issuer") ?? "";
		const account = label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : label.trim();
		const name = issuer !== "" ? (account !== "" ? `${issuer} (${account})` : issuer) : label.trim();

		return {
			name,
			secret,
			digits: boundedInt(url.searchParams.get("digits"), 6, 6, 8),
			period: boundedInt(url.searchParams.get("period"), 30, 1, 300),
			algorithm: ALGORITHMS[(url.searchParams.get("algorithm") ?? "SHA1").toUpperCase()] ?? "SHA-1",
		};
	}

	const secret = normalizeSecret(text);
	if (secret.length < 8 || !decodeBase32(secret))
	{
		return null;
	}

	return { name: "", secret, digits: 6, period: 30, algorithm: "SHA-1" };
}

export async function generateCode(account: Omit<TotpInput, "name">, now: number): Promise<string>
{
	const key = decodeBase32(account.secret);
	if (!key)
	{
		return "";
	}

	const counter = Math.floor(now / 1000 / account.period);
	const message = new DataView(new ArrayBuffer(8));
	message.setUint32(0, Math.floor(counter / 2 ** 32));
	message.setUint32(4, counter >>> 0);

	const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: account.algorithm }, false, ["sign"]);
	const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, message));
	const offset = digest[digest.length - 1] & 0x0f;
	const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];

	return String(value % 10 ** account.digits).padStart(account.digits, "0");
}

export function secondsLeft(period: number, now: number): number
{
	return period - (Math.floor(now / 1000) % period);
}

export function groupCode(code: string): string
{
	const half = Math.ceil(code.length / 2);
	return code.length > 4 ? `${code.slice(0, half)} ${code.slice(half)}` : code;
}
