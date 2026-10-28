import type { MailSummary } from "./types";

export class ApiError extends Error
{
	status: number;
	body: { errors?: string[]; retry_after?: number; locked?: boolean };

	constructor(status: number, body: ApiError["body"])
	{
		super(body.errors?.[0] ?? `request failed (${status})`);
		this.status = status;
		this.body = body;
	}
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T>
{
	const response = await fetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
		credentials: "same-origin",
	});

	if (response.status === 204)
	{
		return undefined as T;
	}

	const body = await response.json().catch(() => ({}));
	if (!response.ok)
	{
		throw new ApiError(response.status, body);
	}

	return body as T;
}

export function formatWhen(timestamp: number, now = new Date()): string
{
	const date = new Date(timestamp);
	if (date.toDateString() === now.toDateString())
	{
		return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
	}
	if (date.getFullYear() === now.getFullYear())
	{
		return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
	}
	return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function formatFull(timestamp: number): string
{
	return new Date(timestamp).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

export function formatSize(bytes: number): string
{
	if (bytes < 1024)
	{
		return `${bytes} o`;
	}
	if (bytes < 1024 * 1024)
	{
		return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} Ko`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function sender(mail: Pick<MailSummary, "from_name" | "from_address">): string
{
	return mail.from_name.trim() || mail.from_address;
}

export function waitLabel(seconds: number): string
{
	const minutes = Math.ceil(seconds / 60);
	return minutes <= 1 ? "1 minute" : `${minutes} minutes`;
}

export function pinMessage(error: unknown): string
{
	if (error instanceof ApiError)
	{
		if (error.status === 401)
		{
			return "PIN incorrect.";
		}
		if (error.status === 429)
		{
			return `Trop d'essais. Réessaie dans ${waitLabel(error.body.retry_after ?? 900)}.`;
		}
		if (error.status === 400)
		{
			return "Le PIN doit faire 4 à 8 chiffres.";
		}
		if (error.status === 409)
		{
			return "Cette boîte a déjà un PIN.";
		}
	}
	return "Le serveur ne répond pas. Réessaie dans un instant.";
}

function decimals(value: number, maximumFractionDigits: number): string
{
	return new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value);
}

export function formatStorage(bytes: number): string
{
	if (!Number.isFinite(bytes) || bytes <= 0)
	{
		return "0 o";
	}
	if (bytes < 1000)
	{
		return `${bytes} o`;
	}
	if (bytes < 1_000_000)
	{
		return `${decimals(bytes / 1000, 1)} Ko`;
	}
	if (bytes < 1_000_000_000)
	{
		return `${decimals(bytes / 1_000_000, 1)} Mo`;
	}
	return `${decimals(bytes / 1_000_000_000, 2)} Go`;
}

export function usagePercent(used: number, limit: number): number
{
	if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0)
	{
		return 0;
	}
	return Math.min(100, Math.max(0, (used / limit) * 100));
}
