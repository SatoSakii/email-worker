import type { AppProps } from "next/app";
import { Schibsted_Grotesk } from "next/font/google";
import "@/styles/globals.css";

const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted" });

export default function App({ Component, pageProps }: AppProps)
{
	return (
		<div className={`${schibsted.variable} font-sans`}>
			<Component {...pageProps} />
		</div>
	);
}
