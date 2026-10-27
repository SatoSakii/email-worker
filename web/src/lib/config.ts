export interface Config
{
	workerUrl: string;
	apiToken: string;
	mailDomain: string;
	sessionSecret: string;
}

export function readConfig(): Config
{
	const values = {
		workerUrl: process.env.WORKER_URL,
		apiToken: process.env.API_TOKEN,
		mailDomain: process.env.MAIL_DOMAIN,
		sessionSecret: process.env.SESSION_SECRET,
	};

	const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
	if (missing.length > 0)
	{
		throw new Error(`missing configuration: ${missing.join(", ")}`);
	}

	return {
		workerUrl: values.workerUrl!.replace(/\/+$/, ""),
		apiToken: values.apiToken!,
		mailDomain: values.mailDomain!.toLowerCase(),
		sessionSecret: values.sessionSecret!,
	};
}
