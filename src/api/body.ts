export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null>
{
	const body = await request.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body))
	{
		return null;
	}

	return body as Record<string, unknown>;
}
