import { saveAttempts } from "../db/locks";
import type { LockRow } from "../db/locks";

const ITERATIONS = 20_000;
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;
const PIN = /^\d{4,8}$/;

export type PinResult =
	| { status: "ok" }
	| { status: "wrong" }
	| { status: "blocked"; retry_after: number };

export function isValidPin(value: unknown): value is string
{
	return typeof value === "string" && PIN.test(value);
}

function toHex(bytes: Uint8Array): string
{
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array
{
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index++)
	{
		bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

export function newSalt(): string
{
	return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin: string, salt: string): Promise<string>
{
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: ITERATIONS }, key, 256);
	return toHex(new Uint8Array(bits));
}

export function retryAfter(lock: LockRow, now: number): number
{
	return lock.blocked_until > now ? Math.ceil((lock.blocked_until - now) / 1000) : 0;
}

export async function checkPin(db: D1Database, lock: LockRow, pin: string, now: number): Promise<PinResult>
{
	const wait = retryAfter(lock, now);
	if (wait > 0)
	{
		return { status: "blocked", retry_after: wait };
	}

	const given = fromHex(await hashPin(pin, lock.pin_salt));
	const expected = fromHex(lock.pin_hash);
	if (crypto.subtle.timingSafeEqual(given, expected))
	{
		if (lock.failed_attempts > 0 || lock.blocked_until > 0)
		{
			await saveAttempts(db, lock.alias, 0, 0);
		}
		return { status: "ok" };
	}

	const failures = lock.failed_attempts + 1;
	if (failures >= MAX_ATTEMPTS)
	{
		await saveAttempts(db, lock.alias, 0, now + BLOCK_MS);
		return { status: "blocked", retry_after: BLOCK_MS / 1000 };
	}

	await saveAttempts(db, lock.alias, failures, 0);
	return { status: "wrong" };
}
