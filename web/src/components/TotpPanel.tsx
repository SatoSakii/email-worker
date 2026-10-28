import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import { ApiError, api } from "@/lib/client";
import { readQr } from "@/lib/qr";
import { generateCode, groupCode, parseTotpInput, secondsLeft } from "@/lib/totp";
import type { TotpKey } from "@/lib/types";
import ConfirmButton from "./ConfirmButton";
import { ClipIcon } from "./icons";

const field = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-rose";

interface Props
{
	base: string;
	onForbidden: (error: ApiError) => void;
}

export default function TotpPanel({ base, onForbidden }: Props)
{
	const [accounts, setAccounts] = useState<TotpKey[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [codes, setCodes] = useState<Record<string, string>>({});
	const [now, setNow] = useState(() => Date.now());
	const [name, setName] = useState("");
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const [saving, setSaving] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const fail = useCallback((error: unknown, message: string) =>
	{
		if (error instanceof ApiError && error.status === 403)
		{
			onForbidden(error);
			return;
		}
		setError(message);
	}, [onForbidden]);

	useEffect(() =>
	{
		let active = true;

		api<{ keys: TotpKey[] }>(`${base}/totp`)
			.then((result) =>
			{
				if (active)
				{
					setAccounts(result.keys);
					setLoaded(true);
				}
			})
			.catch((error) =>
			{
				if (active)
				{
					fail(error, "Impossible de charger les clés.");
				}
			});

		return () =>
		{
			active = false;
		};
	}, [base, fail]);

	useEffect(() =>
	{
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() =>
	{
		let active = true;

		Promise.all(accounts.map(async (account) => [account.id, await generateCode(account, now)] as const)).then((entries) =>
		{
			if (active)
			{
				setCodes(Object.fromEntries(entries));
			}
		});

		return () =>
		{
			active = false;
		};
	}, [accounts, now]);

	useEffect(() =>
	{
		if (!copied)
		{
			return;
		}

		const timer = window.setTimeout(() => setCopied(null), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const importImage = useCallback(async (file: Blob) =>
	{
		setReading(true);
		setError(null);

		const text = await readQr(file);
		const parsed = text ? parseTotpInput(text) : null;
		setReading(false);

		if (!parsed)
		{
			setError(text ? "Ce QR code n'est pas une clé 2FA." : "Aucun QR code lisible dans cette image.");
			return;
		}

		setSecret(text ?? "");
		setName((current) => (current.trim() === "" ? parsed.name : current));
	}, []);

	async function submit(event: FormEvent)
	{
		event.preventDefault();

		const parsed = parseTotpInput(secret);
		if (!parsed)
		{
			setError("Clé invalide.");
			return;
		}

		setSaving(true);
		setError(null);

		try
		{
			const created = await api<TotpKey>(`${base}/totp`, {
				method: "POST",
				body: JSON.stringify({ name: (name.trim() || parsed.name || "Sans nom").slice(0, 60), secret: parsed.secret, digits: parsed.digits, period: parsed.period, algorithm: parsed.algorithm }),
			});
			setAccounts((current) => [...current, created]);
			setName("");
			setSecret("");
		}
		catch (failure)
		{
			fail(failure, failure instanceof ApiError && failure.status === 409 ? "Trop de clés sur cette boîte." : "Ajout impossible.");
		}
		finally
		{
			setSaving(false);
		}
	}

	async function remove(id: string)
	{
		try
		{
			await api(`${base}/totp/${id}`, { method: "DELETE" });
			setAccounts((current) => current.filter((item) => item.id !== id));
		}
		catch (failure)
		{
			fail(failure, "Suppression impossible.");
		}
	}

	function onPaste(event: ClipboardEvent)
	{
		const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
		if (image)
		{
			event.preventDefault();
			void importImage(image);
		}
	}

	async function copy(account: TotpKey)
	{
		try
		{
			await navigator.clipboard.writeText(codes[account.id] ?? "");
			setCopied(account.id);
		}
		catch
		{
			setError("Copie impossible.");
		}
	}

	return (
		<div className="flex-1 overflow-y-auto px-5 py-7 md:px-10" onPaste={onPaste}>
			<div className="mx-auto max-w-xl">
				<h2 className="text-2xl font-semibold tracking-tight">2FA</h2>
				<p className="mt-1 text-sm text-faint">Liées à cette boîte.</p>

				<form onSubmit={(event) => void submit(event)} className="mt-6 space-y-2.5">
					<label htmlFor="totp-name" className="sr-only">
						Nom
					</label>
					<input id="totp-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom" autoComplete="off" maxLength={60} className={field} />
					<label htmlFor="totp-secret" className="sr-only">
						Clé
					</label>
					<input
						id="totp-secret"
						value={secret}
						onChange={(event) => setSecret(event.target.value)}
						placeholder="Clé ou lien otpauth"
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						className={`${field} font-mono`}
					/>
					<div className="flex items-center gap-2">
						<button type="submit" disabled={secret.trim() === "" || saving} className="rounded-md bg-rose px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-deep disabled:opacity-50">
							Ajouter
						</button>
						<button
							type="button"
							onClick={() => fileRef.current?.click()}
							disabled={reading}
							className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-tint hover:text-ink disabled:opacity-50"
						>
							<ClipIcon width={14} height={14} /> {reading ? "Lecture…" : "Scanner un QR"}
						</button>
						<input
							ref={fileRef}
							type="file"
							accept="image/*"
							className="hidden"
							onChange={(event) =>
							{
								const file = event.target.files?.[0];
								event.target.value = "";
								if (file)
								{
									void importImage(file);
								}
							}}
						/>
					</div>
					<p className="text-xs text-faint">Tu peux aussi coller une capture d&apos;écran.</p>
					{error && (
						<p role="alert" className="text-sm text-cherry">
							{error}
						</p>
					)}
				</form>

				{loaded && accounts.length === 0 && <p className="mt-10 text-sm text-faint">Aucune clé.</p>}

				<ul className="mt-8 divide-y divide-line border-y border-line">
					{accounts.map((account) =>
					{
						const left = secondsLeft(account.period, now);
						const code = codes[account.id] ?? "";

						return (
							<li key={account.id} className="flex items-center gap-4 py-4">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm text-muted">{account.name}</p>
									<button
										type="button"
										onClick={() => void copy(account)}
										title="Copier"
										className="mt-0.5 font-mono text-3xl font-semibold tracking-wider tabular-nums transition-colors hover:text-rose-deep"
									>
										{code ? groupCode(code) : "······"}
									</button>
									<p className="h-4 text-xs text-faint" role="status">
										{copied === account.id ? "Copié" : ""}
									</p>
								</div>
								<div className="flex flex-col items-end gap-2">
									<span className={`font-mono text-sm tabular-nums ${left <= 5 ? "text-cherry" : "text-muted"}`}>{left}s</span>
									<div className="h-1 w-16 overflow-hidden rounded-full bg-tint">
										<div className={`h-full transition-[width] duration-1000 ease-linear ${left <= 5 ? "bg-cherry" : "bg-rose"}`} style={{ width: `${(left / account.period) * 100}%` }} />
									</div>
									<ConfirmButton
										label="Retirer"
										confirmLabel="Confirmer ?"
										className="rounded-md px-2 py-0.5 text-xs text-muted transition-colors hover:text-cherry"
										onConfirm={() => void remove(account.id)}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
