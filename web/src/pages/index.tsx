import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowIcon } from "@/components/icons";
import { toAlias, toPrefix } from "@/lib/alias";
import { readConfig } from "@/lib/config";

interface Props
{
	domain: string;
}

const STORAGE = "recent-boxes";
const MAX_RECENT = 6;

export const getServerSideProps: GetServerSideProps<Props> = async () =>
{
	return { props: { domain: readConfig().mailDomain } };
};

function readRecent(): string[]
{
	try
	{
		const stored = JSON.parse(window.localStorage.getItem(STORAGE) ?? "[]");
		return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT) : [];
	}
	catch (_error)
	{
		return [];
	}
}

export default function Home({ domain }: Props)
{
	const router = useRouter();
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [recent, setRecent] = useState<string[]>([]);
	const input = useRef<HTMLInputElement>(null);

	useEffect(() =>
	{
		input.current?.focus();

		const timer = window.setTimeout(() => setRecent(readRecent()), 0);
		return () => window.clearTimeout(timer);
	}, []);

	function open(event: FormEvent)
	{
		event.preventDefault();

		const alias = toAlias(value, domain);
		if (!alias)
		{
			setError("Lettres, chiffres et . _ + - seulement.");
			return;
		}

		const prefix = toPrefix(alias);
		window.localStorage.setItem(STORAGE, JSON.stringify([prefix, ...readRecent().filter((item) => item !== prefix)].slice(0, MAX_RECENT)));
		void router.push(`/m/${encodeURIComponent(prefix)}`);
	}

	return (
		<>
			<Head>
				<title>{domain}</title>
			</Head>
			<main className="flex min-h-dvh flex-col px-6 py-6 md:px-14 md:py-8">
				<header className="border-b border-line pb-5 text-base font-semibold">{domain}</header>

				<div className="mx-auto my-auto w-full max-w-lg py-14">
					<form onSubmit={open}>
						<label htmlFor="alias" className="text-sm font-semibold">
							Ouvrir une boîte
						</label>

						<div className="mt-3 flex gap-2">
							<div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-white px-4 transition focus-within:border-rose focus-within:ring-4 focus-within:ring-rose/15">
								<input
									id="alias"
									ref={input}
									value={value}
									onChange={(event) =>
									{
										setValue(event.target.value.replace(/\s/g, ""));
										setError(null);
									}}
									placeholder="nom"
									autoCapitalize="none"
									autoCorrect="off"
									autoComplete="off"
									spellCheck={false}
									inputMode="email"
									maxLength={64}
									aria-describedby="alias-help"
									aria-invalid={error !== null}
									className="min-w-0 flex-1 bg-transparent py-3.5 text-lg font-semibold caret-rose outline-none placeholder:font-normal placeholder:text-faint"
								/>
								<span className="shrink-0 text-muted">@{domain}</span>
							</div>
							<button type="submit" className="rounded-md bg-rose px-5 font-semibold text-white transition-colors hover:bg-rose-deep">
								Ouvrir
							</button>
						</div>

						<p id="alias-help" role={error ? "alert" : undefined} className={`mt-2.5 text-sm ${error ? "text-cherry" : "text-muted"}`}>
							{error ?? "Choisis n'importe quel nom : tout ce qui lui est envoyé arrive ici."}
						</p>
					</form>

					<section aria-labelledby="recent-title" className="mt-12">
						<h2 id="recent-title" className="text-sm font-semibold text-rose-deep">
							Boîtes récentes
						</h2>
						{recent.length === 0 ? (
							<p className="mt-3 text-sm text-faint">Aucune pour l&apos;instant.</p>
						) : (
							<ul className="mt-3 divide-y divide-line border-y border-line">
								{recent.map((prefix) => (
									<li key={prefix}>
										<Link href={`/m/${encodeURIComponent(prefix)}`} className="group flex items-center justify-between gap-4 py-3">
											<span className="min-w-0 truncate">
												<span className="font-semibold">{prefix}</span>
												<span className="text-muted">@{domain}</span>
											</span>
											<ArrowIcon className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-rose" />
										</Link>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>

				<footer className="border-t border-line pt-5 text-sm text-muted">Sans PIN, une boîte est lisible par tous.</footer>
			</main>
		</>
	);
}
