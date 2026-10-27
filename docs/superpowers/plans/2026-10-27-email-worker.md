# Email Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Email Worker qui reçoit le catch-all d'un domaine, stocke les mails dans D1 et R2, et expose une API REST protégée par token pour les lire.

**Architecture:** Un seul Worker avec `email()` (réception) et `fetch()` (API Hono). D1 stocke les métadonnées, les corps, la blocklist et l'index FTS5. R2 stocke le `.eml` brut et les pièces jointes.

**Tech Stack:** TypeScript, Hono, postal-mime, Wrangler, Vitest avec `@cloudflare/vitest-plugin`, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-10-27-email-worker-design.md`

## Global Constraints

- Jamais de git : à la fin de chaque tâche, donner le message de commit à l'utilisateur. Aucun commit pour les docs, specs et plans.
- Aucun commentaire dans le code, ni dans les `.ts`, `.mjs`, `.sql` ou `.jsonc`.
- Style matcha : tabs, accolades Allman (accolade ouvrante sur sa propre ligne, `else` et `catch` sur leur propre ligne), guillemets doubles, points-virgules, `export async function`, un corps de `if` toujours entre accolades, imports triés (externes, parents `../`, frères `./`), variables en camelCase, champs de base de données en snake_case.
- Imports relatifs, pas d'alias `@/`.
- Limite de 25 Mo par mail (`25 * 1024 * 1024` octets).
- Auth : `Authorization: Bearer <API_TOKEN>`, comparaison à temps constant, 401 sinon.
- Erreurs d'API : `{ "errors": ["message"] }` avec le statut HTTP adapté.
- Pagination : `limit` par défaut 50, maximum 100, curseur `<received_at>:<id>`.
- Suppression définitive seulement si le mail est dans la corbeille.
- Rétention indéfinie, pas de Cron. Réception seule, pas d'envoi.
- Les flags sont stockés en 0/1 dans D1 et exposés en booléens par l'API.

## Review Focus

- Alias ou expéditeur en casse mixte (`Shop@Me.org`) : stocké en minuscules, filtre par alias et blocklist insensibles à la casse (tâches 3, 4, 5).
- Même `Message-ID` livré à deux alias (Cc) : les deux copies sont stockées, seul un vrai doublon (même alias) est ignoré (tâche 3).
- Expéditeur d'enveloppe différent du `From:` (adresse de bounce) : la blocklist doit aussi bloquer sur le `From:` du message (tâche 4).
- Recherche avec caractères spéciaux FTS5 (`"`, `*`, `-`, `OR`, `(`, `:`) : jamais de 500 (tâche 7).
- Plusieurs mails avec le même `received_at` : la pagination ne saute ni ne répète aucun mail (tâche 5).

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `migrations/.gitkeep`
- Create: `src/types.ts`, `src/index.ts`, `src/api/app.ts`
- Create: `test/env.d.ts`, `test/apply-migrations.ts`, `test/bindings.test.ts`

**Interfaces:**
- Produces: `Env` (`DB: D1Database`, `BUCKET: R2Bucket`, `API_TOKEN: string`), `AppEnv` (`{ Bindings: Env }`), `app` (instance Hono exportée de `src/api/app.ts`).

- [ ] **Step 1: Créer `package.json`**

```json
{
	"name": "email-worker",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "wrangler dev",
		"deploy": "wrangler deploy",
		"typecheck": "tsc --noEmit",
		"lint": "eslint",
		"lint:fix": "eslint --fix",
		"test": "vitest run"
	}
}
```

- [ ] **Step 2: Installer les dépendances**

```bash
npm install hono postal-mime
npm install -D wrangler typescript@^5 vitest @cloudflare/vitest-plugin @cloudflare/workers-types eslint@^9 typescript-eslint eslint-plugin-import
```

- [ ] **Step 3: Créer `tsconfig.json`**

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ES2022"],
		"types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"],
		"strict": true,
		"noEmit": true,
		"skipLibCheck": true,
		"isolatedModules": true
	},
	"include": ["src", "test"]
}
```

- [ ] **Step 4: Créer `wrangler.jsonc`**

```json
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "email-worker",
	"main": "src/index.ts",
	"compatibility_date": "2026-10-01",
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "email-worker",
			"database_id": "00000000-0000-0000-0000-000000000000",
			"migrations_dir": "migrations"
		}
	],
	"r2_buckets": [
		{
			"binding": "BUCKET",
			"bucket_name": "email-worker"
		}
	]
}
```

L'identifiant D1 nul suffit pour les tests locaux. Il sera remplacé à la tâche 8.

- [ ] **Step 5: Créer `eslint.config.mjs`**

```js
import { defineConfig, globalIgnores } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["node_modules/**", ".wrangler/**", "dist/**", "worker-configuration.d.ts"]),
	...tseslint.configs.recommended,
	{
		plugins: { import: importPlugin },
		settings: {
			"import/core-modules": ["cloudflare:test", "cloudflare:workers"],
		},
		rules: {
			indent: ["error", "tab"],
			quotes: ["error", "double", { avoidEscape: true }],
			semi: ["error", "always"],
			"brace-style": ["error", "allman"],
			"keyword-spacing": ["error", { after: true }],
			"semi-spacing": ["error", { before: false, after: true }],
			curly: ["error", "multi-line", "consistent"],
			"nonblock-statement-body-position": ["error", "below"],
			"import/order": [
				"error",
				{
					groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
					"newlines-between": "never",
					alphabetize: { order: "asc", caseInsensitive: true },
				},
			],
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
]);
```

- [ ] **Step 6: Créer `vitest.config.ts`**

```ts
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () =>
{
	const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						API_TOKEN: "test-token",
					},
				},
			}),
		],
		test: {
			setupFiles: ["./test/apply-migrations.ts"],
		},
	};
});
```

- [ ] **Step 7: Créer les fichiers source et le dossier de migrations**

`migrations/.gitkeep` : fichier vide.

`src/types.ts`
```ts
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
```

`src/api/app.ts`
```ts
import { Hono } from "hono";
import type { AppEnv } from "../types";

export const app = new Hono<AppEnv>();
```

`src/index.ts`
```ts
import { app } from "./api/app";
import type { Env } from "./types";

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 8: Créer les fichiers de test**

`test/env.d.ts`
```ts
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as WorkerEnv } from "../src/types";

declare global
{
	namespace Cloudflare
	{
		interface Env extends WorkerEnv
		{
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
```

`test/apply-migrations.ts`
```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`test/bindings.test.ts`
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("bindings", () =>
{
	it("exposes D1 and R2", async () =>
	{
		const row = await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
		expect(row?.one).toBe(1);

		await env.BUCKET.put("probe", "ok");
		const object = await env.BUCKET.get("probe");
		expect(await object?.text()).toBe("ok");
	});
});
```

- [ ] **Step 9: Vérifier**

Run: `npm test && npm run typecheck && npm run lint`
Expected: 1 test passe, typecheck et lint sans erreur. Si `readD1Migrations` refuse un dossier sans `.sql`, créer `migrations/0001_init.sql` de la tâche 2 avant de relancer. Si `brace-style: allman` rejette les corps de fonctions fléchées, retirer cette règle plutôt que de reformater le code. Corriger le reste avec `npm run lint:fix`.

- [ ] **Step 10: Donner le message de commit à l'utilisateur**

```
chore: scaffold TypeScript Worker with Hono, Vitest and ESLint
```

---

### Task 2: Schéma D1 et recherche plein texte

**Files:**
- Create: `migrations/0001_init.sql`, `migrations/0002_search.sql`
- Create: `test/helpers.ts`, `test/schema.test.ts`

**Interfaces:**
- Produces (tables) : `emails`, `attachments`, `blocklist`, `emails_fts`.
- Produces (`test/helpers.ts`) : `SeedEmail`, `resetData(): Promise<void>`, `seedEmail(overrides?: Partial<SeedEmail>): Promise<SeedEmail>`, `queryAll<T>(sql: string, ...params: (string | number)[]): Promise<T[]>`.

- [ ] **Step 1: Écrire les helpers de test**

`test/helpers.ts`
```ts
import { env } from "cloudflare:workers";

export interface SeedEmail
{
	id: string;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	received_at: number;
	size: number;
	raw_key: string;
	is_read: number;
	is_starred: number;
	is_deleted: number;
	has_attachments: number;
	parse_failed: number;
}

export async function queryAll<T>(sql: string, ...params: (string | number)[]): Promise<T[]>
{
	const { results } = await env.DB.prepare(sql).bind(...params).all<T>();
	return results;
}

export async function resetData(): Promise<void>
{
	await env.DB.batch([
		env.DB.prepare("DELETE FROM attachments"),
		env.DB.prepare("DELETE FROM emails"),
		env.DB.prepare("DELETE FROM blocklist"),
	]);

	const listed = await env.BUCKET.list();
	await Promise.all(listed.objects.map((object) => env.BUCKET.delete(object.key)));
}

export async function seedEmail(overrides: Partial<SeedEmail> = {}): Promise<SeedEmail>
{
	const email: SeedEmail = {
		id: crypto.randomUUID(),
		message_id: null,
		from_address: "sender@example.com",
		from_name: "",
		to_address: "me@example.org",
		subject: "subject",
		text_body: "body",
		html_body: "",
		received_at: 1000,
		size: 100,
		raw_key: "raw/seed.eml",
		is_read: 0,
		is_starred: 0,
		is_deleted: 0,
		has_attachments: 0,
		parse_failed: 0,
		...overrides,
	};
	const columns = Object.keys(email);
	const placeholders = columns.map(() => "?").join(", ");

	await env.DB.prepare(`INSERT INTO emails (${columns.join(", ")}) VALUES (${placeholders})`)
		.bind(...Object.values(email))
		.run();

	return email;
}
```

- [ ] **Step 2: Écrire le test de schéma (échoue)**

`test/schema.test.ts`
```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, resetData, seedEmail } from "./helpers";

async function search(term: string): Promise<string[]>
{
	const rows = await queryAll<{ id: string }>(
		"SELECT e.id FROM emails e WHERE e.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)",
		term,
	);
	return rows.map((row) => row.id);
}

describe("schema", () =>
{
	beforeEach(resetData);

	it("indexes new mails in the full text index", async () =>
	{
		const email = await seedEmail({ subject: "Invoice March", from_address: "billing@shop.com", text_body: "your parcel shipped" });

		expect(await search("invoice")).toEqual([email.id]);
		expect(await search("billing")).toEqual([email.id]);
		expect(await search("parcel")).toEqual([email.id]);
		expect(await search("unrelated")).toEqual([]);
	});

	it("reindexes when searchable columns change and keeps the index when flags change", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });

		await env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([email.id]);

		await env.DB.prepare("UPDATE emails SET subject = 'Refund' WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([]);
		expect(await search("refund")).toEqual([email.id]);
	});

	it("removes deleted mails from the index", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });

		await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(email.id).run();
		expect(await search("invoice")).toEqual([]);
	});

	it("deletes attachments with their mail", async () =>
	{
		const email = await seedEmail();
		await env.DB.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES ('a1', ?, 'f.txt', 'text/plain', 3, 'k')")
			.bind(email.id)
			.run();

		await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(email.id).run();
		expect(await queryAll("SELECT id FROM attachments")).toEqual([]);
	});

	it("rejects the same message id for the same alias but not for another alias", async () =>
	{
		await seedEmail({ message_id: "<a@x>", to_address: "one@me.org" });

		await expect(seedEmail({ message_id: "<a@x>", to_address: "one@me.org" })).rejects.toThrow();
		await expect(seedEmail({ message_id: "<a@x>", to_address: "two@me.org" })).resolves.toBeDefined();
	});

	it("allows several mails without a message id", async () =>
	{
		await seedEmail({ message_id: null });
		await expect(seedEmail({ message_id: null })).resolves.toBeDefined();
	});

	it("restricts blocklist types and rejects duplicate entries", async () =>
	{
		const insert = (type: string, pattern: string) =>
			env.DB.prepare("INSERT INTO blocklist (id, type, pattern, created_at) VALUES (?, ?, ?, 1)")
				.bind(crypto.randomUUID(), type, pattern)
				.run();

		await expect(insert("bogus", "a@b.c")).rejects.toThrow();
		await insert("sender", "a@b.c");
		await expect(insert("sender", "a@b.c")).rejects.toThrow();
		await expect(insert("alias", "a@b.c")).resolves.toBeDefined();
	});
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL avec `no such table: emails`.

- [ ] **Step 4: Écrire les migrations**

`migrations/0001_init.sql`
```sql
CREATE TABLE emails (
	id TEXT PRIMARY KEY,
	message_id TEXT,
	from_address TEXT NOT NULL,
	from_name TEXT NOT NULL DEFAULT '',
	to_address TEXT NOT NULL,
	subject TEXT NOT NULL DEFAULT '',
	text_body TEXT NOT NULL DEFAULT '',
	html_body TEXT NOT NULL DEFAULT '',
	received_at INTEGER NOT NULL,
	size INTEGER NOT NULL,
	raw_key TEXT NOT NULL,
	is_read INTEGER NOT NULL DEFAULT 0,
	is_starred INTEGER NOT NULL DEFAULT 0,
	is_deleted INTEGER NOT NULL DEFAULT 0,
	has_attachments INTEGER NOT NULL DEFAULT 0,
	parse_failed INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX emails_message_alias ON emails (message_id, to_address) WHERE message_id IS NOT NULL;
CREATE INDEX emails_alias_received ON emails (to_address, received_at DESC);
CREATE INDEX emails_deleted_received ON emails (is_deleted, received_at DESC);

CREATE TABLE attachments (
	id TEXT PRIMARY KEY,
	email_id TEXT NOT NULL REFERENCES emails (id) ON DELETE CASCADE,
	filename TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size INTEGER NOT NULL,
	r2_key TEXT NOT NULL
);

CREATE INDEX attachments_email ON attachments (email_id);

CREATE TABLE blocklist (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL CHECK (type IN ('sender', 'alias')),
	pattern TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE (type, pattern)
);
```

`migrations/0002_search.sql`
```sql
CREATE VIRTUAL TABLE emails_fts USING fts5 (subject, from_address, text_body, content = 'emails', content_rowid = 'rowid');

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
	INSERT INTO emails_fts (rowid, subject, from_address, text_body) VALUES (new.rowid, new.subject, new.from_address, new.text_body);
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
	INSERT INTO emails_fts (emails_fts, rowid, subject, from_address, text_body) VALUES ('delete', old.rowid, old.subject, old.from_address, old.text_body);
END;

CREATE TRIGGER emails_fts_update AFTER UPDATE OF subject, from_address, text_body ON emails BEGIN
	INSERT INTO emails_fts (emails_fts, rowid, subject, from_address, text_body) VALUES ('delete', old.rowid, old.subject, old.from_address, old.text_body);
	INSERT INTO emails_fts (rowid, subject, from_address, text_body) VALUES (new.rowid, new.subject, new.from_address, new.text_body);
END;
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tous les tests passent. Si le test de cascade échoue parce que les clés étrangères sont désactivées en local, le signaler à l'utilisateur avant de continuer.

- [ ] **Step 6: Donner le message de commit à l'utilisateur**

```
feat(db): add D1 schema and full-text search migrations
```

---

### Task 3: Réception des mails

**Files:**
- Create: `src/db/emails.ts`, `src/email/store.ts`, `src/email/handler.ts`
- Modify: `src/index.ts`, `test/helpers.ts`
- Test: `test/email-handler.test.ts`

**Interfaces:**
- Consumes: `Env` (`src/types.ts`), tables de la tâche 2.
- Produces (`src/db/emails.ts`) : `EmailRow`, `AttachmentRow`, `NewEmail`, `emailExists(db: D1Database, message_id: string, to_address: string): Promise<boolean>`, `insertEmail(db: D1Database, email: NewEmail, attachments: AttachmentRow[]): Promise<void>`.
- Produces (`src/email/store.ts`) : `IncomingAttachment`, `IncomingEmail`, `saveEmail(env: Env, email: IncomingEmail): Promise<string | null>` (renvoie l'id, ou `null` pour un doublon).
- Produces (`src/email/handler.ts`) : `handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void>`.
- Produces (`test/helpers.ts`) : `MailOptions`, `buildMail(options?: MailOptions): string`, `createMessage(from: string, to: string, raw: string, options?: { rawSize?: number }): { message: ForwardableEmailMessage; state: { rejected: string | null } }`.

- [ ] **Step 1: Ajouter `buildMail` et `createMessage` à `test/helpers.ts`**

```ts
export interface MailOptions
{
	from?: string | null;
	to?: string;
	subject?: string | null;
	body?: string;
	html?: string;
	messageId?: string | null;
	attachment?: { filename: string; content: string };
}

export function buildMail(options: MailOptions = {}): string
{
	const { from = "sender@example.com", to = "me@example.org", subject = "subject", body = "body", messageId = "<id@example.com>", html, attachment } = options;
	const headers = ["MIME-Version: 1.0", `To: ${to}`];

	if (from !== null)
	{
		headers.push(`From: ${from}`);
	}
	if (subject !== null)
	{
		headers.push(`Subject: ${subject}`);
	}
	if (messageId !== null)
	{
		headers.push(`Message-ID: ${messageId}`);
	}

	if (!attachment)
	{
		const type = html === undefined ? "text/plain" : "text/html";
		return [...headers, `Content-Type: ${type}; charset=utf-8`, "", html ?? body, ""].join("\r\n");
	}

	return [
		...headers,
		"Content-Type: multipart/mixed; boundary=\"b1\"",
		"",
		"--b1",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
		"--b1",
		`Content-Type: text/plain; name="${attachment.filename}"`,
		`Content-Disposition: attachment; filename="${attachment.filename}"`,
		"Content-Transfer-Encoding: base64",
		"",
		btoa(attachment.content),
		"--b1--",
		"",
	].join("\r\n");
}

export function createMessage(from: string, to: string, raw: string, options: { rawSize?: number } = {})
{
	const bytes = new TextEncoder().encode(raw);
	const state: { rejected: string | null } = { rejected: null };
	const message = {
		from,
		to,
		headers: new Headers(),
		raw: new Blob([bytes]).stream(),
		rawSize: options.rawSize ?? bytes.byteLength,
		setReject(reason: string)
		{
			state.rejected = reason;
		},
		async forward()
		{
		},
		async reply()
		{
		},
	};

	return { message: message as unknown as ForwardableEmailMessage, state };
}
```

- [ ] **Step 2: Écrire le test du handler (échoue)**

`test/email-handler.test.ts`
```ts
import { env } from "cloudflare:workers";
import PostalMime from "postal-mime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentRow, EmailRow } from "../src/db/emails";
import { handleEmail } from "../src/email/handler";
import { buildMail, createMessage, queryAll, resetData } from "./helpers";

async function deliver(from: string, to: string, raw: string, rawSize?: number)
{
	const { message, state } = createMessage(from, to, raw, { rawSize });
	await handleEmail(message, env);
	return state;
}

describe("handleEmail", () =>
{
	beforeEach(resetData);
	afterEach(() => vi.restoreAllMocks());

	it("stores a simple mail and its raw source", async () =>
	{
		const raw = buildMail({ from: "Bob <Bob@Example.com>", to: "Shop@Me.org", subject: "Hello", body: "plain body", messageId: "<m1@example.com>" });

		const state = await deliver("bounce@mailer.example.com", "Shop@Me.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");

		expect(state.rejected).toBeNull();
		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({
			from_address: "bob@example.com",
			from_name: "Bob",
			to_address: "shop@me.org",
			subject: "Hello",
			message_id: "<m1@example.com>",
			is_read: 0,
			is_starred: 0,
			is_deleted: 0,
			has_attachments: 0,
			parse_failed: 0,
		});
		expect(emails[0].text_body.trim()).toBe("plain body");
		expect(emails[0].size).toBe(new TextEncoder().encode(raw).byteLength);

		const stored = await env.BUCKET.get(emails[0].raw_key);
		expect(await stored?.text()).toBe(raw);
	});

	it("stores attachments in R2 and in D1", async () =>
	{
		const raw = buildMail({ attachment: { filename: "note.txt", content: "attached text" } });

		await deliver("a@example.com", "me@example.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		const attachments = await queryAll<AttachmentRow>("SELECT * FROM attachments");

		expect(emails[0].has_attachments).toBe(1);
		expect(attachments).toHaveLength(1);
		expect(attachments[0]).toMatchObject({ email_id: emails[0].id, filename: "note.txt", content_type: "text/plain", size: 13 });
		const object = await env.BUCKET.get(attachments[0].r2_key);
		expect(await object?.text()).toBe("attached text");
	});

	it("stores an html only mail", async () =>
	{
		await deliver("a@example.com", "me@example.org", buildMail({ html: "<b>hi</b>" }));

		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		expect(emails).toHaveLength(1);
		expect(emails[0].html_body).toContain("<b>hi</b>");
		expect(emails[0].parse_failed).toBe(0);
	});

	it("accepts a mail without message id, subject or from header", async () =>
	{
		const raw = buildMail({ from: null, subject: null, messageId: null });

		await deliver("Envelope@Example.com", "me@example.org", raw);
		await deliver("Envelope@Example.com", "me@example.org", raw);

		const emails = await queryAll<EmailRow>("SELECT * FROM emails");
		expect(emails).toHaveLength(2);
		expect(emails[0]).toMatchObject({ from_address: "envelope@example.com", subject: "", message_id: null });
	});

	it("keeps the raw mail when parsing fails", async () =>
	{
		vi.spyOn(PostalMime, "parse").mockRejectedValueOnce(new Error("boom"));
		const raw = buildMail();

		await deliver("Envelope@Example.com", "me@example.org", raw);
		const emails = await queryAll<EmailRow>("SELECT * FROM emails");

		expect(emails).toHaveLength(1);
		expect(emails[0]).toMatchObject({ parse_failed: 1, from_address: "envelope@example.com", subject: "" });
		const stored = await env.BUCKET.get(emails[0].raw_key);
		expect(await stored?.text()).toBe(raw);
	});

	it("ignores a duplicate for the same alias but stores the same message for another alias", async () =>
	{
		const raw = buildMail({ messageId: "<same@example.com>" });

		await deliver("a@example.com", "one@me.org", raw);
		await deliver("a@example.com", "ONE@me.org", raw);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);

		await deliver("a@example.com", "two@me.org", raw);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(2);
	});

	it("rejects mails above 25 MB and stores nothing", async () =>
	{
		const state = await deliver("a@example.com", "me@example.org", buildMail(), 25 * 1024 * 1024 + 1);

		expect(state.rejected).toBe("message too large");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
	});
});
```

- [ ] **Step 3: Lancer le test, vérifier l'échec**

Run: `npx vitest run test/email-handler.test.ts`
Expected: FAIL avec une erreur de module introuvable pour `../src/email/handler`.

- [ ] **Step 4: Écrire `src/db/emails.ts`**

```ts
export interface EmailRow
{
	id: string;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	received_at: number;
	size: number;
	raw_key: string;
	is_read: number;
	is_starred: number;
	is_deleted: number;
	has_attachments: number;
	parse_failed: number;
}

export interface AttachmentRow
{
	id: string;
	email_id: string;
	filename: string;
	content_type: string;
	size: number;
	r2_key: string;
}

export type NewEmail = Omit<EmailRow, "is_read" | "is_starred" | "is_deleted">;

export async function emailExists(db: D1Database, message_id: string, to_address: string): Promise<boolean>
{
	const row = await db.prepare("SELECT 1 AS found FROM emails WHERE message_id = ? AND to_address = ?")
		.bind(message_id, to_address)
		.first();
	return row !== null;
}

export async function insertEmail(db: D1Database, email: NewEmail, attachments: AttachmentRow[]): Promise<void>
{
	const statements = [
		db.prepare("INSERT INTO emails (id, message_id, from_address, from_name, to_address, subject, text_body, html_body, received_at, size, raw_key, has_attachments, parse_failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.bind(
				email.id,
				email.message_id,
				email.from_address,
				email.from_name,
				email.to_address,
				email.subject,
				email.text_body,
				email.html_body,
				email.received_at,
				email.size,
				email.raw_key,
				email.has_attachments,
				email.parse_failed,
			),
		...attachments.map((attachment) => db.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)")
			.bind(attachment.id, attachment.email_id, attachment.filename, attachment.content_type, attachment.size, attachment.r2_key)),
	];

	await db.batch(statements);
}
```

- [ ] **Step 5: Écrire `src/email/store.ts`**

```ts
import { emailExists, insertEmail } from "../db/emails";
import type { AttachmentRow } from "../db/emails";
import type { Env } from "../types";

export interface IncomingAttachment
{
	filename: string;
	content_type: string;
	content: ArrayBuffer | Uint8Array;
}

export interface IncomingEmail
{
	raw: ArrayBuffer;
	message_id: string | null;
	from_address: string;
	from_name: string;
	to_address: string;
	subject: string;
	text_body: string;
	html_body: string;
	attachments: IncomingAttachment[];
	parse_failed: boolean;
}

export async function saveEmail(env: Env, email: IncomingEmail): Promise<string | null>
{
	if (email.message_id && await emailExists(env.DB, email.message_id, email.to_address))
	{
		return null;
	}

	const id = crypto.randomUUID();
	const rawKey = `raw/${id}.eml`;
	const keys = [rawKey];

	try
	{
		await env.BUCKET.put(rawKey, email.raw);

		const attachments: AttachmentRow[] = [];
		for (const attachment of email.attachments)
		{
			const attachmentId = crypto.randomUUID();
			const attachmentKey = `attachments/${id}/${attachmentId}`;
			keys.push(attachmentKey);
			await env.BUCKET.put(attachmentKey, attachment.content);
			attachments.push({
				id: attachmentId,
				email_id: id,
				filename: attachment.filename,
				content_type: attachment.content_type,
				size: attachment.content.byteLength,
				r2_key: attachmentKey,
			});
		}

		await insertEmail(env.DB, {
			id,
			message_id: email.message_id,
			from_address: email.from_address,
			from_name: email.from_name,
			to_address: email.to_address,
			subject: email.subject,
			text_body: email.text_body,
			html_body: email.html_body,
			received_at: Date.now(),
			size: email.raw.byteLength,
			raw_key: rawKey,
			has_attachments: attachments.length > 0 ? 1 : 0,
			parse_failed: email.parse_failed ? 1 : 0,
		}, attachments);
	}
	catch (error)
	{
		await env.BUCKET.delete(keys);
		throw error;
	}

	return id;
}
```

- [ ] **Step 6: Écrire `src/email/handler.ts`**

```ts
import PostalMime from "postal-mime";
import type { Attachment, Email } from "postal-mime";
import type { Env } from "../types";
import { saveEmail } from "./store";
import type { IncomingAttachment } from "./store";

const MAX_SIZE = 25 * 1024 * 1024;

async function parse(raw: ArrayBuffer): Promise<Email | null>
{
	try
	{
		return await PostalMime.parse(raw);
	}
	catch (_error)
	{
		return null;
	}
}

function toIncomingAttachment(attachment: Attachment): IncomingAttachment
{
	const content = typeof attachment.content === "string"
		? new TextEncoder().encode(attachment.content)
		: attachment.content;

	return {
		filename: attachment.filename ?? "attachment",
		content_type: attachment.mimeType,
		content,
	};
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void>
{
	if (message.rawSize > MAX_SIZE)
	{
		message.setReject("message too large");
		return;
	}

	const raw = await new Response(message.raw).arrayBuffer();
	const parsed = await parse(raw);

	await saveEmail(env, {
		raw,
		message_id: parsed?.messageId ?? null,
		from_address: (parsed?.from?.address || message.from).toLowerCase(),
		from_name: parsed?.from?.name ?? "",
		to_address: message.to.toLowerCase(),
		subject: parsed?.subject ?? "",
		text_body: parsed?.text ?? "",
		html_body: parsed?.html ?? "",
		attachments: (parsed?.attachments ?? []).map(toIncomingAttachment),
		parse_failed: parsed === null,
	});
}
```

- [ ] **Step 7: Brancher `email()` dans `src/index.ts`**

```ts
import { app } from "./api/app";
import { handleEmail } from "./email/handler";
import type { Env } from "./types";

export default {
	fetch: app.fetch,
	async email(message, env)
	{
		await handleEmail(message, env);
	},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 8: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: tous les tests passent. Si `vi.spyOn(PostalMime, "parse")` ne s'applique pas au handler, importer `PostalMime` de la même façon dans le test et le handler et vérifier qu'il s'agit du même module.

- [ ] **Step 9: Donner le message de commit à l'utilisateur**

```
feat(email): receive mails and store them in D1 and R2
```

---

### Task 4: Authentification et blocklist

**Files:**
- Create: `src/api/auth.ts`, `src/api/body.ts`, `src/api/blocklist.ts`, `src/db/blocklist.ts`, `src/email/blocklist.ts`
- Modify: `src/api/app.ts`, `src/email/handler.ts`, `test/helpers.ts`
- Test: `test/auth.test.ts`, `test/blocklist.test.ts`

**Interfaces:**
- Consumes: `AppEnv`, `handleEmail`, `app`.
- Produces (`src/api/auth.ts`) : `requireToken(c: Context<AppEnv>, next: Next): Promise<Response | void>`.
- Produces (`src/api/body.ts`) : `readJsonObject(request: Request): Promise<Record<string, unknown> | null>`.
- Produces (`src/db/blocklist.ts`) : `BlocklistType`, `BlocklistRow`, `listBlocklist(db)`, `addBlocklistEntry(db, type, pattern): Promise<BlocklistRow | null>` (`null` si déjà présent), `removeBlocklistEntry(db, id): Promise<boolean>`.
- Produces (`src/email/blocklist.ts`) : `matchesPattern(pattern: string, address: string): boolean`, `isBlocked(db: D1Database, senders: string[], alias: string): Promise<boolean>`.
- Produces (`test/helpers.ts`) : `request(path: string, init?: RequestInit): Promise<Response>` (avec le bon token), `requestJson(path: string, method: string, body: unknown): Promise<Response>`.

- [ ] **Step 1: Ajouter `request` et `requestJson` à `test/helpers.ts`**

Ajouter l'import en tête (après `cloudflare:workers`) puis les fonctions :

```ts
import { app } from "../src/api/app";
```

```ts
export async function request(path: string, init: RequestInit = {}): Promise<Response>
{
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${env.API_TOKEN}`);
	return app.request(path, { ...init, headers }, env);
}

export async function requestJson(path: string, method: string, body: unknown): Promise<Response>
{
	return request(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}
```

- [ ] **Step 2: Écrire les tests (échouent)**

`test/auth.test.ts`
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/api/app";
import { request } from "./helpers";

function call(path: string, authorization?: string): Promise<Response> | Response
{
	const headers: Record<string, string> = {};
	if (authorization !== undefined)
	{
		headers.Authorization = authorization;
	}
	return app.request(path, { headers }, env);
}

describe("auth", () =>
{
	it.each([
		["no header", undefined],
		["empty bearer", "Bearer "],
		["wrong token", "Bearer nope"],
		["longer wrong token", `Bearer ${"x".repeat(200)}`],
		["wrong scheme", "Basic test-token"],
		["token without scheme", "test-token"],
	])("rejects %s", async (_name, authorization) =>
	{
		const response = await call("/blocklist", authorization);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ errors: ["unauthorized"] });
	});

	it("accepts the right token", async () =>
	{
		const response = await call("/blocklist", "Bearer test-token");
		expect(response.status).toBe(200);
	});

	it("does not reveal unknown routes without a token", async () =>
	{
		expect((await call("/nothing")).status).toBe(401);
	});

	it("returns a json 404 for unknown routes with a token", async () =>
	{
		const response = await request("/nothing");

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ errors: ["not found"] });
	});
});
```

`test/blocklist.test.ts`
```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleEmail } from "../src/email/handler";
import { matchesPattern } from "../src/email/blocklist";
import { buildMail, createMessage, queryAll, request, requestJson, resetData } from "./helpers";

async function block(type: string, pattern: string): Promise<void>
{
	const response = await requestJson("/blocklist", "POST", { type, pattern });
	expect(response.status).toBe(201);
}

async function deliver(from: string, to: string, header: string)
{
	const { message, state } = createMessage(from, to, buildMail({ from: header, to }));
	await handleEmail(message, env);
	return state;
}

describe("matchesPattern", () =>
{
	it("matches exact addresses regardless of case", () =>
	{
		expect(matchesPattern("spam@evil.com", "SPAM@Evil.com")).toBe(true);
		expect(matchesPattern("spam@evil.com", "other@evil.com")).toBe(false);
	});

	it("matches a whole domain with a wildcard but not look-alike or sub domains", () =>
	{
		expect(matchesPattern("*@evil.com", "anyone@evil.com")).toBe(true);
		expect(matchesPattern("*@evil.com", "anyone@notevil.com")).toBe(false);
		expect(matchesPattern("*@evil.com", "anyone@sub.evil.com")).toBe(false);
	});
});

describe("blocklist reception", () =>
{
	beforeEach(resetData);

	it("rejects a blocked envelope sender and stores nothing", async () =>
	{
		await block("sender", "spam@evil.com");

		const state = await deliver("Spam@Evil.com", "me@example.org", "Someone <someone@ok.com>");

		expect(state.rejected).toBe("rejected");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
	});

	it("rejects a blocked sender seen only in the From header", async () =>
	{
		await block("sender", "*@evil.com");

		const state = await deliver("bounce@mailer.example.net", "me@example.org", "Promo <promo@evil.com>");

		expect(state.rejected).toBe("rejected");
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
	});

	it("rejects a blocked alias regardless of case", async () =>
	{
		await block("alias", "spam@me.org");

		const state = await deliver("a@ok.com", "SPAM@Me.org", "a@ok.com");

		expect(state.rejected).toBe("rejected");
	});

	it("does not mix sender and alias entries", async () =>
	{
		await block("alias", "a@ok.com");

		const state = await deliver("a@ok.com", "me@example.org", "a@ok.com");

		expect(state.rejected).toBeNull();
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);
	});

	it("accepts unrelated mails", async () =>
	{
		await block("sender", "spam@evil.com");

		const state = await deliver("friend@ok.com", "me@example.org", "friend@ok.com");

		expect(state.rejected).toBeNull();
	});
});

describe("blocklist routes", () =>
{
	beforeEach(resetData);

	it("adds, lists and removes entries", async () =>
	{
		const created = await requestJson("/blocklist", "POST", { type: "sender", pattern: "  Spam@Evil.com " });
		expect(created.status).toBe(201);
		const entry = await created.json() as { id: string; type: string; pattern: string };
		expect(entry).toMatchObject({ type: "sender", pattern: "spam@evil.com" });

		const listed = await (await request("/blocklist")).json() as { entries: { id: string }[] };
		expect(listed.entries.map((item) => item.id)).toEqual([entry.id]);

		expect((await request(`/blocklist/${entry.id}`, { method: "DELETE" })).status).toBe(204);
		expect((await request(`/blocklist/${entry.id}`, { method: "DELETE" })).status).toBe(404);
	});

	it("rejects duplicates", async () =>
	{
		await block("sender", "spam@evil.com");

		expect((await requestJson("/blocklist", "POST", { type: "sender", pattern: "SPAM@evil.com" })).status).toBe(409);
	});

	it.each([
		[{ type: "bogus", pattern: "a@b.c" }],
		[{ type: "sender", pattern: "not-an-address" }],
		[{ type: "sender", pattern: "a@b@c.d" }],
		[{ type: "sender", pattern: "*@*.com" }],
		[{ type: "sender", pattern: 42 }],
		[{ type: "sender" }],
		[[]],
		[null],
	])("rejects invalid body %j", async (body) =>
	{
		expect((await requestJson("/blocklist", "POST", body)).status).toBe(400);
	});

	it("rejects a body that is not json", async () =>
	{
		const response = await request("/blocklist", { method: "POST", body: "{nope" });
		expect(response.status).toBe(400);
	});
});
```

- [ ] **Step 3: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/auth.test.ts test/blocklist.test.ts`
Expected: FAIL (modules introuvables, routes absentes).

- [ ] **Step 4: Écrire `src/api/auth.ts` et `src/api/body.ts`**

`src/api/auth.ts`
```ts
import type { Context, Next } from "hono";
import type { AppEnv } from "../types";

async function digest(value: string): Promise<Uint8Array>
{
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function requireToken(c: Context<AppEnv>, next: Next): Promise<Response | void>
{
	const match = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "");
	if (!match || !c.env.API_TOKEN)
	{
		return c.json({ errors: ["unauthorized"] }, 401);
	}

	const [given, expected] = await Promise.all([digest(match[1]), digest(c.env.API_TOKEN)]);
	if (!crypto.subtle.timingSafeEqual(given, expected))
	{
		return c.json({ errors: ["unauthorized"] }, 401);
	}

	await next();
}
```

`src/api/body.ts`
```ts
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null>
{
	const body = await request.json().catch(() => null);
	if (typeof body !== "object" || body === null || Array.isArray(body))
	{
		return null;
	}

	return body as Record<string, unknown>;
}
```

- [ ] **Step 5: Écrire `src/db/blocklist.ts`**

```ts
export type BlocklistType = "sender" | "alias";

export interface BlocklistRow
{
	id: string;
	type: BlocklistType;
	pattern: string;
	created_at: number;
}

export async function listBlocklist(db: D1Database): Promise<BlocklistRow[]>
{
	const { results } = await db.prepare("SELECT id, type, pattern, created_at FROM blocklist ORDER BY created_at DESC, id")
		.all<BlocklistRow>();
	return results;
}

export async function addBlocklistEntry(db: D1Database, type: BlocklistType, pattern: string): Promise<BlocklistRow | null>
{
	const entry: BlocklistRow = { id: crypto.randomUUID(), type, pattern, created_at: Date.now() };
	const result = await db.prepare("INSERT INTO blocklist (id, type, pattern, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (type, pattern) DO NOTHING")
		.bind(entry.id, entry.type, entry.pattern, entry.created_at)
		.run();
	return result.meta.changes === 0 ? null : entry;
}

export async function removeBlocklistEntry(db: D1Database, id: string): Promise<boolean>
{
	const result = await db.prepare("DELETE FROM blocklist WHERE id = ?").bind(id).run();
	return result.meta.changes > 0;
}
```

- [ ] **Step 6: Écrire `src/email/blocklist.ts`**

```ts
import { listBlocklist } from "../db/blocklist";

export function matchesPattern(pattern: string, address: string): boolean
{
	const expected = pattern.toLowerCase();
	const actual = address.toLowerCase();

	if (expected.startsWith("*@"))
	{
		return actual.endsWith(expected.slice(1));
	}

	return expected === actual;
}

export async function isBlocked(db: D1Database, senders: string[], alias: string): Promise<boolean>
{
	const entries = await listBlocklist(db);

	return entries.some((entry) =>
	{
		if (entry.type === "alias")
		{
			return matchesPattern(entry.pattern, alias);
		}

		return senders.some((sender) => matchesPattern(entry.pattern, sender));
	});
}
```

- [ ] **Step 7: Écrire `src/api/blocklist.ts`**

```ts
import { Hono } from "hono";
import { addBlocklistEntry, listBlocklist, removeBlocklistEntry } from "../db/blocklist";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";

const PATTERN = /^(\*|[^\s@*]+)@[^\s@*]+$/;

export const blocklistRoutes = new Hono<AppEnv>();

blocklistRoutes.get("/", async (c) =>
{
	return c.json({ entries: await listBlocklist(c.env.DB) });
});

blocklistRoutes.post("/", async (c) =>
{
	const body = await readJsonObject(c.req.raw);
	if (!body)
	{
		return c.json({ errors: ["invalid request body"] }, 400);
	}

	const { type, pattern: rawPattern } = body;
	if (type !== "sender" && type !== "alias")
	{
		return c.json({ errors: ["type must be sender or alias"] }, 400);
	}

	const pattern = typeof rawPattern === "string" ? rawPattern.trim().toLowerCase() : "";
	if (!PATTERN.test(pattern))
	{
		return c.json({ errors: ["pattern must be an address or *@domain"] }, 400);
	}

	const entry = await addBlocklistEntry(c.env.DB, type, pattern);
	if (!entry)
	{
		return c.json({ errors: ["already blocked"] }, 409);
	}

	return c.json(entry, 201);
});

blocklistRoutes.delete("/:id", async (c) =>
{
	if (!await removeBlocklistEntry(c.env.DB, c.req.param("id")))
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return c.body(null, 204);
});
```

- [ ] **Step 8: Mettre à jour `src/api/app.ts`**

```ts
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireToken } from "./auth";
import { blocklistRoutes } from "./blocklist";

export const app = new Hono<AppEnv>();

app.use("*", requireToken);
app.route("/blocklist", blocklistRoutes);

app.notFound((c) =>
{
	return c.json({ errors: ["not found"] }, 404);
});

app.onError((error, c) =>
{
	console.error(error);
	return c.json({ errors: ["internal error"] }, 500);
});
```

- [ ] **Step 9: Appliquer la blocklist dans `src/email/handler.ts`**

Ajouter l'import `import { isBlocked } from "./blocklist";` (avant `./store`), puis dans `handleEmail`, juste après `const parsed = await parse(raw);` :

```ts
	const senders = [message.from.toLowerCase()];
	if (parsed?.from?.address)
	{
		senders.push(parsed.from.address.toLowerCase());
	}

	if (await isBlocked(env.DB, senders, message.to.toLowerCase()))
	{
		message.setReject("rejected");
		return;
	}
```

- [ ] **Step 10: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: tous les tests passent.

- [ ] **Step 11: Donner le message de commit à l'utilisateur**

```
feat(api): add bearer auth and sender/alias blocklist
```

---

### Task 5: API de lecture

**Files:**
- Modify: `src/db/emails.ts`, `src/api/app.ts`, `test/helpers.ts`
- Create: `src/api/emails.ts`, `src/api/attachments.ts`
- Test: `test/api-emails.test.ts`

**Interfaces:**
- Consumes: `EmailRow`, `AttachmentRow` (tâche 3), `request` (tâche 4).
- Produces (`src/db/emails.ts`) :
  - `EmailSummary` (`Pick<EmailRow, "id" | "from_address" | "from_name" | "to_address" | "subject" | "received_at" | "size" | "is_read" | "is_starred" | "is_deleted" | "has_attachments" | "parse_failed">`)
  - `ListFilters` (`{ alias?: string; q?: string; unread?: boolean; starred?: boolean; trash?: boolean; limit: number; cursor?: { received_at: number; id: string } }`)
  - `listEmails(db, filters): Promise<EmailSummary[]>` (renvoie jusqu'à `limit + 1` lignes)
  - `getEmail(db, id): Promise<EmailRow | null>`
  - `listAttachments(db, email_id): Promise<AttachmentRow[]>`
  - `getAttachment(db, id): Promise<AttachmentRow | null>`
- Produces (`src/api/emails.ts`) : `emailRoutes` (Hono), `toSummary(row: EmailSummary)`.
- Produces (`test/helpers.ts`) : `SeedAttachment`, `seedAttachment(email_id: string, overrides?: Partial<SeedAttachment>): Promise<SeedAttachment>`.

- [ ] **Step 1: Ajouter `seedAttachment` à `test/helpers.ts`**

```ts
export interface SeedAttachment
{
	id: string;
	email_id: string;
	filename: string;
	content_type: string;
	size: number;
	r2_key: string;
}

export async function seedAttachment(email_id: string, overrides: Partial<SeedAttachment> = {}): Promise<SeedAttachment>
{
	const id = overrides.id ?? crypto.randomUUID();
	const attachment: SeedAttachment = {
		id,
		email_id,
		filename: "file.txt",
		content_type: "text/plain",
		size: 3,
		r2_key: `attachments/${email_id}/${id}`,
		...overrides,
	};

	await env.DB.prepare("INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(attachment.id, attachment.email_id, attachment.filename, attachment.content_type, attachment.size, attachment.r2_key)
		.run();

	return attachment;
}
```

- [ ] **Step 2: Écrire les tests (échouent)**

`test/api-emails.test.ts`
```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { request, resetData, seedAttachment, seedEmail } from "./helpers";

interface ListBody
{
	emails: { id: string }[];
	next_cursor: string | null;
}

async function list(query: string): Promise<ListBody>
{
	const response = await request(`/emails${query}`);
	expect(response.status).toBe(200);
	return await response.json() as ListBody;
}

async function listIds(query: string): Promise<string[]>
{
	return (await list(query)).emails.map((email) => email.id);
}

describe("GET /emails", () =>
{
	beforeEach(resetData);

	it("lists newest first and hides the trash", async () =>
	{
		const old = await seedEmail({ received_at: 1000 });
		const recent = await seedEmail({ received_at: 3000 });
		const middle = await seedEmail({ received_at: 2000 });
		await seedEmail({ received_at: 4000, is_deleted: 1 });

		expect(await listIds("")).toEqual([recent.id, middle.id, old.id]);
	});

	it("returns only the trash with trash=1", async () =>
	{
		await seedEmail();
		const trashed = await seedEmail({ is_deleted: 1 });

		expect(await listIds("?trash=1")).toEqual([trashed.id]);
	});

	it("filters by alias regardless of case", async () =>
	{
		const shop = await seedEmail({ to_address: "shop@me.org" });
		await seedEmail({ to_address: "news@me.org" });

		expect(await listIds("?alias=SHOP@Me.org")).toEqual([shop.id]);
	});

	it("filters unread and starred mails", async () =>
	{
		const unread = await seedEmail({ is_read: 0, received_at: 2000 });
		const starred = await seedEmail({ is_read: 1, is_starred: 1, received_at: 1000 });

		expect(await listIds("?unread=1")).toEqual([unread.id]);
		expect(await listIds("?starred=1")).toEqual([starred.id]);
	});

	it("does not skip or repeat mails sharing a timestamp across pages", async () =>
	{
		const ids = [1, 2, 3].map((n) => `00000000-0000-0000-0000-00000000000${n}`);
		for (const id of ids)
		{
			await seedEmail({ id, received_at: 5000 });
		}
		const older = await seedEmail({ received_at: 4000 });

		const first = await list("?limit=2");
		expect(first.emails.map((email) => email.id)).toEqual([ids[2], ids[1]]);
		expect(first.next_cursor).toBe(`5000:${ids[1]}`);

		const second = await list(`?limit=2&cursor=${first.next_cursor}`);
		expect(second.emails.map((email) => email.id)).toEqual([ids[0], older.id]);
		expect(second.next_cursor).toBeNull();
	});

	it("accepts a limit above the maximum by clamping it", async () =>
	{
		await seedEmail();
		expect(await listIds("?limit=1000")).toHaveLength(1);
	});

	it.each(["?limit=0", "?limit=abc", "?limit=1.5", "?limit=-3", "?cursor=nope", "?cursor=5000:xyz"])("rejects %s", async (query) =>
	{
		expect((await request(`/emails${query}`)).status).toBe(400);
	});

	it("returns summaries without bodies or storage keys", async () =>
	{
		await seedEmail({ is_starred: 1 });

		const body = await (await request("/emails")).json() as { emails: Record<string, unknown>[] };

		expect(Object.keys(body.emails[0]).sort()).toEqual([
			"from_address",
			"from_name",
			"has_attachments",
			"id",
			"is_deleted",
			"is_read",
			"is_starred",
			"parse_failed",
			"received_at",
			"size",
			"subject",
			"to_address",
		]);
		expect(body.emails[0]).toMatchObject({ is_read: false, is_starred: true, is_deleted: false });
	});
});

describe("GET /emails/:id", () =>
{
	beforeEach(resetData);

	it("returns the full mail with its attachments", async () =>
	{
		const email = await seedEmail({ subject: "Hello", text_body: "text", html_body: "<p>html</p>", has_attachments: 1, is_starred: 1 });
		const attachment = await seedAttachment(email.id, { filename: "a.pdf", content_type: "application/pdf", size: 42 });

		const response = await request(`/emails/${email.id}`);
		const body = await response.json() as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			id: email.id,
			subject: "Hello",
			text_body: "text",
			html_body: "<p>html</p>",
			is_starred: true,
			is_read: false,
			has_attachments: true,
			attachments: [{ id: attachment.id, filename: "a.pdf", content_type: "application/pdf", size: 42 }],
		});
		expect(body).not.toHaveProperty("raw_key");
	});

	it("still shows a trashed mail", async () =>
	{
		const email = await seedEmail({ is_deleted: 1 });
		expect((await request(`/emails/${email.id}`)).status).toBe(200);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await request("/emails/unknown")).status).toBe(404);
	});
});

describe("GET /emails/:id/raw", () =>
{
	beforeEach(resetData);

	it("streams the stored source", async () =>
	{
		await env.BUCKET.put("raw/x.eml", "RAW SOURCE");
		const email = await seedEmail({ raw_key: "raw/x.eml" });

		const response = await request(`/emails/${email.id}/raw`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("message/rfc822");
		expect(await response.text()).toBe("RAW SOURCE");
	});

	it("returns 404 when the mail or the object is missing", async () =>
	{
		const email = await seedEmail({ raw_key: "raw/missing.eml" });

		expect((await request(`/emails/${email.id}/raw`)).status).toBe(404);
		expect((await request("/emails/unknown/raw")).status).toBe(404);
	});
});

describe("GET /attachments/:id", () =>
{
	beforeEach(resetData);

	it("downloads the file as an attachment with safe headers", async () =>
	{
		const email = await seedEmail();
		const attachment = await seedAttachment(email.id, { filename: "evil\"\r\nX: y.html", content_type: "text/html", size: 5 });
		await env.BUCKET.put(attachment.r2_key, "<b>x</b>");

		const response = await request(`/attachments/${attachment.id}`);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/html");
		expect(response.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''evil%22%0D%0AX%3A%20y.html");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await response.text()).toBe("<b>x</b>");
	});

	it("returns 404 for an unknown attachment or a missing object", async () =>
	{
		const email = await seedEmail();
		const attachment = await seedAttachment(email.id);

		expect((await request("/attachments/unknown")).status).toBe(404);
		expect((await request(`/attachments/${attachment.id}`)).status).toBe(404);
	});
});
```

- [ ] **Step 3: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/api-emails.test.ts`
Expected: FAIL, les routes renvoient 404.

- [ ] **Step 4: Compléter `src/db/emails.ts`**

Ajouter à la fin du fichier :

```ts
export type EmailSummary = Pick<EmailRow, "id" | "from_address" | "from_name" | "to_address" | "subject" | "received_at" | "size" | "is_read" | "is_starred" | "is_deleted" | "has_attachments" | "parse_failed">;

export interface ListFilters
{
	alias?: string;
	q?: string;
	unread?: boolean;
	starred?: boolean;
	trash?: boolean;
	limit: number;
	cursor?: { received_at: number; id: string };
}

const SUMMARY_COLUMNS = "e.id, e.from_address, e.from_name, e.to_address, e.subject, e.received_at, e.size, e.is_read, e.is_starred, e.is_deleted, e.has_attachments, e.parse_failed";

export async function listEmails(db: D1Database, filters: ListFilters): Promise<EmailSummary[]>
{
	const conditions = [filters.trash ? "e.is_deleted = 1" : "e.is_deleted = 0"];
	const params: (string | number)[] = [];

	if (filters.alias)
	{
		conditions.push("e.to_address = ?");
		params.push(filters.alias.toLowerCase());
	}
	if (filters.unread)
	{
		conditions.push("e.is_read = 0");
	}
	if (filters.starred)
	{
		conditions.push("e.is_starred = 1");
	}
	if (filters.cursor)
	{
		conditions.push("(e.received_at < ? OR (e.received_at = ? AND e.id < ?))");
		params.push(filters.cursor.received_at, filters.cursor.received_at, filters.cursor.id);
	}
	params.push(filters.limit + 1);

	const { results } = await db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM emails e WHERE ${conditions.join(" AND ")} ORDER BY e.received_at DESC, e.id DESC LIMIT ?`)
		.bind(...params)
		.all<EmailSummary>();
	return results;
}

export async function getEmail(db: D1Database, id: string): Promise<EmailRow | null>
{
	return await db.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first<EmailRow>();
}

export async function listAttachments(db: D1Database, email_id: string): Promise<AttachmentRow[]>
{
	const { results } = await db.prepare("SELECT * FROM attachments WHERE email_id = ? ORDER BY id")
		.bind(email_id)
		.all<AttachmentRow>();
	return results;
}

export async function getAttachment(db: D1Database, id: string): Promise<AttachmentRow | null>
{
	return await db.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<AttachmentRow>();
}
```

- [ ] **Step 5: Écrire `src/api/emails.ts`**

```ts
import { Hono } from "hono";
import { getEmail, listAttachments, listEmails } from "../db/emails";
import type { EmailSummary } from "../db/emails";
import type { AppEnv } from "../types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CURSOR = /^(\d+):([0-9a-f-]{36})$/;

export function toSummary(row: EmailSummary)
{
	return {
		id: row.id,
		from_address: row.from_address,
		from_name: row.from_name,
		to_address: row.to_address,
		subject: row.subject,
		received_at: row.received_at,
		size: row.size,
		is_read: row.is_read === 1,
		is_starred: row.is_starred === 1,
		is_deleted: row.is_deleted === 1,
		has_attachments: row.has_attachments === 1,
		parse_failed: row.parse_failed === 1,
	};
}

export const emailRoutes = new Hono<AppEnv>();

emailRoutes.get("/", async (c) =>
{
	const limitParam = c.req.query("limit");
	const requested = limitParam === undefined ? DEFAULT_LIMIT : Number(limitParam);
	if (!Number.isInteger(requested) || requested < 1)
	{
		return c.json({ errors: ["invalid limit"] }, 400);
	}
	const limit = Math.min(requested, MAX_LIMIT);

	let cursor: { received_at: number; id: string } | undefined;
	const cursorParam = c.req.query("cursor");
	if (cursorParam !== undefined)
	{
		const match = CURSOR.exec(cursorParam);
		if (!match)
		{
			return c.json({ errors: ["invalid cursor"] }, 400);
		}
		cursor = { received_at: Number(match[1]), id: match[2] };
	}

	const rows = await listEmails(c.env.DB, {
		alias: c.req.query("alias"),
		unread: c.req.query("unread") === "1",
		starred: c.req.query("starred") === "1",
		trash: c.req.query("trash") === "1",
		limit,
		cursor,
	});

	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = rows.length > limit ? `${last.received_at}:${last.id}` : null;

	return c.json({ emails: page.map(toSummary), next_cursor: nextCursor });
});

emailRoutes.get("/:id/raw", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	const object = email ? await c.env.BUCKET.get(email.raw_key) : null;
	if (!email || !object)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return new Response(object.body, {
		headers: {
			"Content-Type": "message/rfc822",
			"Content-Disposition": `attachment; filename="${email.id}.eml"`,
		},
	});
});

emailRoutes.get("/:id", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	const attachments = await listAttachments(c.env.DB, email.id);

	return c.json({
		...toSummary(email),
		message_id: email.message_id,
		text_body: email.text_body,
		html_body: email.html_body,
		attachments: attachments.map((attachment) => ({
			id: attachment.id,
			filename: attachment.filename,
			content_type: attachment.content_type,
			size: attachment.size,
		})),
	});
});
```

- [ ] **Step 6: Écrire `src/api/attachments.ts`**

```ts
import { Hono } from "hono";
import { getAttachment } from "../db/emails";
import type { AppEnv } from "../types";

function encodeFilename(filename: string): string
{
	return encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export const attachmentRoutes = new Hono<AppEnv>();

attachmentRoutes.get("/:id", async (c) =>
{
	const attachment = await getAttachment(c.env.DB, c.req.param("id"));
	const object = attachment ? await c.env.BUCKET.get(attachment.r2_key) : null;
	if (!attachment || !object)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return new Response(object.body, {
		headers: {
			"Content-Type": attachment.content_type,
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeFilename(attachment.filename)}`,
			"Content-Length": String(object.size),
			"X-Content-Type-Options": "nosniff",
		},
	});
});
```

- [ ] **Step 7: Monter les routes dans `src/api/app.ts`**

Ajouter les imports `import { attachmentRoutes } from "./attachments";` (avant `./auth`) et `import { emailRoutes } from "./emails";` (après `./blocklist`), puis après `app.use("*", requireToken);` :

```ts
app.route("/emails", emailRoutes);
app.route("/attachments", attachmentRoutes);
```

- [ ] **Step 8: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: tous les tests passent.

- [ ] **Step 9: Donner le message de commit à l'utilisateur**

```
feat(api): add mail listing, detail, raw and attachment routes
```

---

### Task 6: Statuts et suppression définitive

**Files:**
- Modify: `src/db/emails.ts`, `src/api/emails.ts`
- Test: `test/api-status.test.ts`

**Interfaces:**
- Consumes: `getEmail`, `listAttachments`, `toSummary`, `readJsonObject` (`src/api/body.ts`), `requestJson`.
- Produces (`src/db/emails.ts`) : `FlagPatch` (`Partial<Pick<EmailRow, "is_read" | "is_starred" | "is_deleted">>`), `updateFlags(db, id, patch: FlagPatch): Promise<boolean>`, `deleteEmail(db, id): Promise<void>`.

- [ ] **Step 1: Écrire les tests (échouent)**

`test/api-status.test.ts`
```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll, request, requestJson, resetData, seedAttachment, seedEmail } from "./helpers";

describe("PATCH /emails/:id", () =>
{
	beforeEach(resetData);

	it("updates flags and returns booleans", async () =>
	{
		const email = await seedEmail();

		const response = await requestJson(`/emails/${email.id}`, "PATCH", { is_read: true, is_starred: true });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: email.id, is_read: true, is_starred: true, is_deleted: false });
	});

	it("only changes the flags that are sent", async () =>
	{
		const email = await seedEmail({ is_read: 1, is_starred: 1 });

		await requestJson(`/emails/${email.id}`, "PATCH", { is_starred: false });
		const rows = await queryAll<{ is_read: number; is_starred: number }>("SELECT is_read, is_starred FROM emails WHERE id = ?", email.id);

		expect(rows[0]).toEqual({ is_read: 1, is_starred: 0 });
	});

	it("moves a mail to the trash and back", async () =>
	{
		const email = await seedEmail();

		await requestJson(`/emails/${email.id}`, "PATCH", { is_deleted: true });
		expect((await (await request("/emails")).json() as { emails: unknown[] }).emails).toHaveLength(0);

		await requestJson(`/emails/${email.id}`, "PATCH", { is_deleted: false });
		expect((await (await request("/emails")).json() as { emails: unknown[] }).emails).toHaveLength(1);
	});

	it.each([
		[{ is_read: 1 }],
		[{ is_read: "true" }],
		[{ is_read: null }],
		[{}],
		[{ unknown: true }],
		[[]],
		[null],
	])("rejects invalid body %j", async (body) =>
	{
		const email = await seedEmail();
		expect((await requestJson(`/emails/${email.id}`, "PATCH", body)).status).toBe(400);
	});

	it("rejects a body that is not json", async () =>
	{
		const email = await seedEmail();
		expect((await request(`/emails/${email.id}`, { method: "PATCH", body: "{nope" })).status).toBe(400);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await requestJson("/emails/unknown", "PATCH", { is_read: true })).status).toBe(404);
	});
});

describe("DELETE /emails/:id", () =>
{
	beforeEach(resetData);

	it("refuses to delete a mail that is not in the trash", async () =>
	{
		const email = await seedEmail();

		const response = await request(`/emails/${email.id}`, { method: "DELETE" });

		expect(response.status).toBe(409);
		expect(await queryAll("SELECT id FROM emails")).toHaveLength(1);
	});

	it("deletes a trashed mail, its attachments and its stored objects", async () =>
	{
		await env.BUCKET.put("raw/x.eml", "RAW");
		const email = await seedEmail({ raw_key: "raw/x.eml", is_deleted: 1, has_attachments: 1, subject: "Invoice" });
		const attachment = await seedAttachment(email.id);
		await env.BUCKET.put(attachment.r2_key, "abc");

		const response = await request(`/emails/${email.id}`, { method: "DELETE" });

		expect(response.status).toBe(204);
		expect(await queryAll("SELECT id FROM emails")).toEqual([]);
		expect(await queryAll("SELECT id FROM attachments")).toEqual([]);
		expect((await env.BUCKET.list()).objects).toEqual([]);
		expect((await request(`/emails/${email.id}`)).status).toBe(404);
	});

	it("returns 404 for an unknown id", async () =>
	{
		expect((await request("/emails/unknown", { method: "DELETE" })).status).toBe(404);
	});
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/api-status.test.ts`
Expected: FAIL, les routes PATCH et DELETE renvoient 404.

- [ ] **Step 3: Ajouter `updateFlags` et `deleteEmail` à `src/db/emails.ts`**

```ts
export type FlagPatch = Partial<Pick<EmailRow, "is_read" | "is_starred" | "is_deleted">>;

export async function updateFlags(db: D1Database, id: string, patch: FlagPatch): Promise<boolean>
{
	const assignments = Object.keys(patch).map((column) => `${column} = ?`).join(", ");
	const result = await db.prepare(`UPDATE emails SET ${assignments} WHERE id = ?`)
		.bind(...Object.values(patch), id)
		.run();
	return result.meta.changes > 0;
}

export async function deleteEmail(db: D1Database, id: string): Promise<void>
{
	await db.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
}
```

Les noms de colonnes viennent uniquement de la liste blanche `FLAGS` de la route, jamais de l'entrée utilisateur.

- [ ] **Step 4: Ajouter les routes à `src/api/emails.ts`**

Mettre à jour les imports :

```ts
import { Hono } from "hono";
import { deleteEmail, getEmail, listAttachments, listEmails, updateFlags } from "../db/emails";
import type { EmailSummary, FlagPatch } from "../db/emails";
import type { AppEnv } from "../types";
import { readJsonObject } from "./body";
```

Ajouter sous `CURSOR` :

```ts
const FLAGS = ["is_read", "is_starred", "is_deleted"] as const;
```

Ajouter à la fin du fichier :

```ts
emailRoutes.patch("/:id", async (c) =>
{
	const body = await readJsonObject(c.req.raw);
	if (!body)
	{
		return c.json({ errors: ["invalid request body"] }, 400);
	}

	const patch: FlagPatch = {};
	for (const flag of FLAGS)
	{
		const value = body[flag];
		if (value === undefined)
		{
			continue;
		}
		if (typeof value !== "boolean")
		{
			return c.json({ errors: [`${flag} must be a boolean`] }, 400);
		}
		patch[flag] = value ? 1 : 0;
	}
	if (Object.keys(patch).length === 0)
	{
		return c.json({ errors: ["no flag to update"] }, 400);
	}

	const id = c.req.param("id");
	if (!await updateFlags(c.env.DB, id, patch))
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	const email = await getEmail(c.env.DB, id);
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}

	return c.json(toSummary(email));
});

emailRoutes.delete("/:id", async (c) =>
{
	const email = await getEmail(c.env.DB, c.req.param("id"));
	if (!email)
	{
		return c.json({ errors: ["not found"] }, 404);
	}
	if (email.is_deleted !== 1)
	{
		return c.json({ errors: ["email must be in trash"] }, 409);
	}

	const attachments = await listAttachments(c.env.DB, email.id);
	await c.env.BUCKET.delete([email.raw_key, ...attachments.map((attachment) => attachment.r2_key)]);
	await deleteEmail(c.env.DB, email.id);

	return c.body(null, 204);
});
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: tous les tests passent.

- [ ] **Step 6: Donner le message de commit à l'utilisateur**

```
feat(api): add read, star and trash flags and permanent delete
```

---

### Task 7: Recherche plein texte

**Files:**
- Modify: `src/db/emails.ts`, `src/api/emails.ts`
- Test: `test/api-search.test.ts`

**Interfaces:**
- Consumes: `listEmails`, `ListFilters.q`, `emails_fts` (tâche 2).
- Produces (`src/db/emails.ts`) : `toFtsQuery(q: string): string | null` (renvoie `null` quand aucun terme n'est exploitable).

- [ ] **Step 1: Écrire les tests (échouent)**

`test/api-search.test.ts`
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { toFtsQuery } from "../src/db/emails";
import { request, requestJson, resetData, seedEmail } from "./helpers";

async function search(q: string, extra = ""): Promise<string[]>
{
	const response = await request(`/emails?q=${encodeURIComponent(q)}${extra}`);
	expect(response.status).toBe(200);
	const body = await response.json() as { emails: { id: string }[] };
	return body.emails.map((email) => email.id);
}

describe("toFtsQuery", () =>
{
	it("quotes every term and escapes quotes", () =>
	{
		expect(toFtsQuery("hello  world")).toBe("\"hello\" \"world\"");
		expect(toFtsQuery("say \"hi\"")).toBe("\"say\" \"\"\"hi\"\"\"");
	});

	it("returns null when no term contains a letter or a digit", () =>
	{
		expect(toFtsQuery("   ")).toBeNull();
		expect(toFtsQuery("- * (")).toBeNull();
	});
});

describe("GET /emails?q=", () =>
{
	beforeEach(resetData);

	it("finds mails by subject, sender and body regardless of case", async () =>
	{
		const bySubject = await seedEmail({ subject: "Invoice March" });
		const bySender = await seedEmail({ from_address: "billing@shop.com" });
		const byBody = await seedEmail({ text_body: "your parcel shipped" });

		expect(await search("INVOICE")).toEqual([bySubject.id]);
		expect(await search("billing")).toEqual([bySender.id]);
		expect(await search("parcel")).toEqual([byBody.id]);
	});

	it("requires every term", async () =>
	{
		const both = await seedEmail({ subject: "Invoice March", received_at: 2000 });
		await seedEmail({ subject: "Invoice April", received_at: 1000 });

		expect(await search("invoice march")).toEqual([both.id]);
	});

	it("combines with the alias filter and excludes the trash", async () =>
	{
		const kept = await seedEmail({ subject: "Invoice", to_address: "shop@me.org" });
		await seedEmail({ subject: "Invoice", to_address: "news@me.org" });
		await seedEmail({ subject: "Invoice", to_address: "shop@me.org", is_deleted: 1 });

		expect(await search("invoice", "&alias=shop@me.org")).toEqual([kept.id]);
	});

	it("keeps finding a mail after its flags change", async () =>
	{
		const email = await seedEmail({ subject: "Invoice" });
		await requestJson(`/emails/${email.id}`, "PATCH", { is_read: true, is_starred: true });

		expect(await search("invoice")).toEqual([email.id]);
	});

	it("paginates search results", async () =>
	{
		await seedEmail({ subject: "Invoice", received_at: 2000 });
		await seedEmail({ subject: "Invoice", received_at: 1000 });

		const first = await (await request("/emails?q=invoice&limit=1")).json() as { emails: unknown[]; next_cursor: string };
		expect(first.emails).toHaveLength(1);

		const second = await (await request(`/emails?q=invoice&limit=1&cursor=${first.next_cursor}`)).json() as { emails: unknown[]; next_cursor: string | null };
		expect(second.emails).toHaveLength(1);
		expect(second.next_cursor).toBeNull();
	});

	it("ignores an empty query", async () =>
	{
		await seedEmail();
		expect(await search("")).toHaveLength(1);
		expect(await search("   ")).toHaveLength(1);
	});

	it.each(["\"", "*", "-", "OR", "AND", "NOT", "(", ")", "a:b", "^x", "'", "\"unterminated", "foo OR", "NEAR(", "é"])("does not fail on special input %s", async (q) =>
	{
		await seedEmail({ subject: "Invoice" });
		const response = await request(`/emails?q=${encodeURIComponent(q)}`);
		expect(response.status).toBe(200);
	});

	it("returns nothing for a query made only of punctuation", async () =>
	{
		await seedEmail();
		expect(await search("- *")).toEqual([]);
	});
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/api-search.test.ts`
Expected: FAIL, `toFtsQuery` n'existe pas et `q` est ignoré.

- [ ] **Step 3: Ajouter `toFtsQuery` et le filtre à `src/db/emails.ts`**

Ajouter avant `listEmails` :

```ts
export function toFtsQuery(q: string): string | null
{
	const terms = q.split(/\s+/).filter((term) => /[\p{L}\p{N}]/u.test(term));
	if (terms.length === 0)
	{
		return null;
	}

	return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
}
```

Dans `listEmails`, juste après `params.push(filters.cursor...)` bloc du curseur et avant `params.push(filters.limit + 1);`, ajouter :

```ts
	if (filters.q !== undefined && filters.q.trim() !== "")
	{
		const query = toFtsQuery(filters.q);
		if (query === null)
		{
			return [];
		}
		conditions.push("e.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)");
		params.push(query);
	}
```

- [ ] **Step 4: Passer `q` depuis la route dans `src/api/emails.ts`**

Dans l'appel à `listEmails` de `emailRoutes.get("/")`, ajouter `q: c.req.query("q"),` après la ligne `alias`.

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npm test && npm run typecheck && npm run lint:fix && npm run lint`
Expected: tous les tests passent. Si un cas spécial renvoie 500, vérifier la requête produite par `toFtsQuery` avant de changer le test.

- [ ] **Step 6: Donner le message de commit à l'utilisateur**

```
feat(api): add full-text search on listing
```

---

### Task 8: Déploiement

**Files:**
- Modify: `wrangler.jsonc`, `README.md`

**Interfaces:**
- Consumes: le Worker complet des tâches 1 à 7.

- [ ] **Step 1: Vérification finale locale**

Run: `npm test && npm run typecheck && npm run lint`
Expected: tout passe.

- [ ] **Step 2: Créer les ressources Cloudflare**

```bash
npx wrangler login
npx wrangler d1 create email-worker
npx wrangler r2 bucket create email-worker
```

Reporter le `database_id` affiché dans `wrangler.jsonc` à la place de `00000000-0000-0000-0000-000000000000`.

- [ ] **Step 3: Appliquer les migrations en production**

```bash
npx wrangler d1 migrations apply email-worker --remote
```
Expected: `0001_init.sql` et `0002_search.sql` appliquées.

- [ ] **Step 4: Définir le secret et déployer**

```bash
npx wrangler secret put API_TOKEN
npm run deploy
```

Générer un token long et aléatoire, par exemple avec `openssl rand -hex 32`, et le conserver.

- [ ] **Step 5: Pointer le catch-all vers le Worker**

Dashboard Cloudflare : le domaine, Email, Email Routing, Routing Rules, Catch-all address, action « Send to a Worker », destination `email-worker`, puis activer la règle.

- [ ] **Step 6: Vérifier de bout en bout**

1. Envoyer un mail depuis une autre boîte vers `test-<n'importe quoi>@ton-domaine`.
2. Lister : `curl -H "Authorization: Bearer $TOKEN" https://email-worker.<sous-domaine>.workers.dev/emails`
3. Lire le détail avec l'`id` renvoyé : `/emails/<id>`.
4. Envoyer un mail avec pièce jointe, télécharger `/attachments/<id>`.
5. Ajouter l'expéditeur à la blocklist : `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"type":"sender","pattern":"toi@example.com"}' .../blocklist`, renvoyer un mail et vérifier qu'il est rejeté (`npx wrangler tail` montre l'événement).
6. Sans token : `curl .../emails` doit renvoyer 401.

- [ ] **Step 7: Aligner le README**

Dans le tableau de l'API de `README.md`, la ligne `GET /emails` doit lister les filtres `alias`, `q`, `unread`, `starred`, `trash`, `limit`, `cursor`. Ajouter sous le tableau : « `limit` vaut 50 par défaut, 100 au maximum. Le curseur est fourni par `next_cursor`. »

- [ ] **Step 8: Donner le message de commit à l'utilisateur**

```
chore: configure Cloudflare bindings for deployment
```
