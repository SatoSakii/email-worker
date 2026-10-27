const PREFIX = /^[a-z0-9._+-]{1,64}$/;

export function isPrefix(input: string): boolean
{
	return PREFIX.test(input.trim().toLowerCase());
}

export function toAlias(input: string, domain: string): string | null
{
	const value = input.trim().toLowerCase();
	const suffix = `@${domain.toLowerCase()}`;
	const prefix = value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;

	return PREFIX.test(prefix) ? `${prefix}${suffix}` : null;
}

export function toPrefix(alias: string): string
{
	return alias.slice(0, alias.lastIndexOf("@"));
}
