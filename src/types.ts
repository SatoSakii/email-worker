export interface Env
{
	DB: D1Database;
	BUCKET: R2Bucket;
	API_TOKEN: string;
}

export interface AppEnv
{
	Bindings: Env;
}
