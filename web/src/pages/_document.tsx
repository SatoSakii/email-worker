import { Head, Html, Main, NextScript } from "next/document";

export default function Document()
{
	return (
		<Html lang="fr">
			<Head>
				<meta name="theme-color" content="#fffafb" />
				<meta name="robots" content="noindex, nofollow" />
			</Head>
			<body className="bg-paper text-ink antialiased">
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
