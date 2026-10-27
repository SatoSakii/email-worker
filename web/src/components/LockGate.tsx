import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { api, pinMessage, waitLabel } from "@/lib/client";

interface Props
{
	alias: string;
	prefix: string;
	retryAfter: number;
	onUnlocked: () => void;
}

export default function LockGate({ alias, prefix, retryAfter, onUnlocked }: Props)
{
	const [pin, setPin] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(retryAfter > 0 ? `Trop d'essais. Réessaie dans ${waitLabel(retryAfter)}.` : null);

	async function submit(event: FormEvent)
	{
		event.preventDefault();
		setBusy(true);
		setError(null);

		try
		{
			await api(`/api/mailbox/${encodeURIComponent(prefix)}/unlock`, { method: "POST", body: JSON.stringify({ pin }) });
			onUnlocked();
		}
		catch (caught)
		{
			setError(pinMessage(caught));
			setPin("");
			setBusy(false);
		}
	}

	return (
		<main className="grid min-h-dvh place-items-center px-6">
			<form onSubmit={submit} className="w-full max-w-xs">
				<h1 className="break-all text-xl font-semibold tracking-tight">{alias}</h1>
				<p className="mt-1 text-sm text-muted">Boîte verrouillée</p>

				<label htmlFor="pin" className="sr-only">
					PIN
				</label>
				<input
					id="pin"
					type="password"
					inputMode="numeric"
					autoComplete="off"
					autoFocus
					maxLength={8}
					value={pin}
					onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
					aria-describedby="pin-error"
					placeholder="PIN"
					className="mt-8 w-full border-b border-line bg-transparent py-3 text-center text-2xl tracking-[0.4em] outline-none transition-colors placeholder:text-faint placeholder:tracking-normal focus:border-rose"
				/>

				<p id="pin-error" role="alert" className="mt-2 min-h-6 text-sm text-cherry">
					{error}
				</p>

				<button
					type="submit"
					disabled={busy || pin.length < 4}
					className="mt-4 w-full rounded-md bg-rose py-3 font-medium text-white transition-colors hover:bg-rose-deep disabled:opacity-40 disabled:hover:bg-rose"
				>
					Ouvrir
				</button>

				<Link href="/" className="mt-6 inline-block text-sm text-muted transition-colors hover:text-rose-deep">
					Autre boîte
				</Link>
			</form>
		</main>
	);
}
