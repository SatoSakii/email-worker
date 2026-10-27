import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
	reactStrictMode: true,
	poweredByHeader: false,
	turbopack: {
		root: path.resolve("."),
	},
	async headers()
	{
		return [
			{
				source: "/((?!_next/).*)",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "no-referrer" },
					{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
				],
			},
		];
	},
};

export default config;
