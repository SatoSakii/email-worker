import { useState } from "react";

interface Props
{
	html: string;
}

function stripRefresh(html: string): string
{
	return html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
}

function buildDocument(html: string, images: boolean): string
{
	const imageSources = images ? "https: http: data:" : "data:";
	const policy = `default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline'; font-src data:; form-action 'none'`;

	return [
		"<!doctype html><html><head><meta charset=\"utf-8\">",
		`<meta http-equiv="Content-Security-Policy" content="${policy}">`,
		"<base target=\"_blank\">",
		"<style>body{margin:18px;font:15px/1.6 system-ui,sans-serif;color:#2b1722;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#b02a5f}</style>",
		"</head><body>",
		stripRefresh(html),
		"</body></html>",
	].join("");
}

export default function HtmlFrame({ html }: Props)
{
	const [images, setImages] = useState(false);

	return (
		<div>
			<p className="mb-2 flex items-center gap-3 text-sm text-muted">
				{images ? "Images affichées" : "Images bloquées"}
				<button type="button" onClick={() => setImages(!images)} className="text-rose-deep hover:underline">
					{images ? "Bloquer" : "Afficher"}
				</button>
			</p>
			<iframe
				title="Contenu HTML du mail"
				sandbox="allow-popups allow-popups-to-escape-sandbox"
				referrerPolicy="no-referrer"
				srcDoc={buildDocument(html, images)}
				className="h-[68vh] w-full rounded-md border border-line bg-white"
			/>
		</div>
	);
}
