# email-worker : design

## Objectif

Boîte mail personnelle sur Cloudflare. Le catch-all d'un domaine déjà sur Cloudflare (Email Routing actif) pointe vers un Worker qui stocke tous les mails et expose une API de lecture. Réception seule.

## Décisions validées

| Sujet | Choix |
| --- | --- |
| Interface | API REST seule (pas de web UI pour l'instant) |
| Rétention | Indéfinie, pas de Cron |
| Pièces jointes | R2, avec le `.eml` brut |
| Envoi | Aucun |
| Stack | TypeScript, Hono, postal-mime, Vitest, Wrangler |
| Auth | Token Bearer en secret Wrangler (`API_TOKEN`) |
| Fonctions | Filtre par alias, lu/étoile/corbeille, recherche FTS5, blocklist |
| Limite | 25 Mo par mail (limite Email Routing) |

## Architecture

Un seul Worker, deux handlers.

- `email(message, env)` : réception.
- `fetch(request, env)` : API Hono.

Bindings : `DB` (D1), `BUCKET` (R2), `API_TOKEN` (secret).

## Données (D1)

`emails`
- `id` (TEXT, PK, UUID)
- `message_id` (TEXT, nullable)
- `from_address`, `from_name`
- `to_address` (alias destinataire, en minuscules)
- `subject`, `text_body`, `html_body`
- `received_at` (INTEGER, epoch ms)
- `size` (INTEGER)
- `raw_key` (TEXT, clé R2)
- `is_read`, `is_starred`, `is_deleted` (INTEGER 0/1)
- `has_attachments` (INTEGER 0/1)
- `parse_failed` (INTEGER 0/1)

`attachments`
- `id` (TEXT, PK), `email_id` (FK, ON DELETE CASCADE)
- `filename`, `content_type`, `size`, `r2_key`

`blocklist`
- `id` (TEXT, PK)
- `type` (`sender` ou `alias`)
- `pattern` (adresse exacte ou `*@domaine`)
- `created_at`

`emails_fts` : table FTS5 externe sur `subject`, `from_address`, `text_body`, maintenue par triggers (insert, update, delete).

Index : `emails(to_address, received_at)`, `emails(is_deleted, received_at)`, et un index unique partiel sur `emails(message_id, to_address)` quand `message_id` n'est pas nul.

## Réception

1. Si `message.rawSize` dépasse 25 Mo : `message.setReject("message too large")` et fin.
2. Lire `message.raw` en `ArrayBuffer` et parser avec postal-mime.
3. Normaliser expéditeur et alias en minuscules. Si une entrée de la blocklist correspond à l'expéditeur d'enveloppe, au `From:` du message ou à l'alias : `message.setReject("rejected")` et fin, sans rien écrire.
4. Écrire le `.eml` dans R2 (`raw/<id>.eml`) et chaque pièce jointe (`attachments/<id>/<attachment_id>`).
5. Insérer le mail et les pièces jointes en D1 dans un `batch`. En cas d'erreur, supprimer les objets R2 écrits et relancer l'erreur.
6. Si le parsing échoue : insérer une ligne avec `parse_failed = 1`, le `.eml` reste dans R2. Aucun mail n'est perdu.

Un message sans `Message-ID` est accepté. Un doublon (même `message_id` pour le même alias) est ignoré. Le même `Message-ID` livré à deux alias différents est stocké deux fois.

## API

Toutes les routes exigent `Authorization: Bearer <API_TOKEN>`. Comparaison à temps constant. Sinon 401.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/emails` | Liste paginée par curseur. Filtres : `alias`, `q`, `unread`, `starred`, `trash` |
| GET | `/emails/:id` | Détail et liste des pièces jointes |
| GET | `/emails/:id/raw` | Flux `.eml` |
| PATCH | `/emails/:id` | `is_read`, `is_starred`, `is_deleted` |
| DELETE | `/emails/:id` | Suppression définitive (D1 et R2), seulement si en corbeille |
| GET | `/attachments/:id` | Flux de la pièce jointe |
| GET | `/blocklist` | Liste |
| POST | `/blocklist` | Ajoute `{ type, pattern }` |
| DELETE | `/blocklist/:id` | Retire |

- Par défaut, `/emails` exclut la corbeille. `trash=1` ne renvoie que la corbeille.
- `q` utilise FTS5 avec la requête échappée par guillemets.
- Pagination : `limit` (défaut 50, max 100), `cursor` = `received_at` et `id` du dernier élément.
- Erreurs : `{ "errors": ["message"] }` avec le statut HTTP adapté.
- Les flags sont stockés en 0/1 et exposés en booléens. La liste ne renvoie ni les corps ni `raw_key`.

## Structure

```
src/
  index.ts
  types.ts
  email/
    handler.ts
    blocklist.ts
    store.ts
  api/
    app.ts
    auth.ts
    body.ts
    emails.ts
    attachments.ts
    blocklist.ts
  db/
    emails.ts
    blocklist.ts
migrations/
test/
wrangler.jsonc
```

## Style de code

Style de matcha : tabs, accolades Allman, guillemets doubles, points-virgules, imports triés, `export async function`, champs en snake_case. Aucun commentaire dans le code. ESLint configuré pour l'imposer.

## Tests

Vitest avec `@cloudflare/vitest-pool-workers` (D1 et R2 locaux).
- Blocklist : rejet par expéditeur, alias, joker de domaine.
- Réception : mail simple, avec pièces jointes, parsing en échec, doublon.
- API : auth, filtres, pagination, recherche, statuts, suppression.

## Étapes

1. Scaffold : package.json, tsconfig, wrangler.jsonc, ESLint, Vitest.
2. Migrations D1 : tables, index, FTS5 et triggers.
3. Réception : handler `email()`, stockage D1 et R2.
4. Auth Bearer et blocklist : correspondance, rejet, routes.
5. API de lecture : liste, détail, alias, pièces jointes, raw.
6. Statuts : lu, étoile, corbeille, suppression définitive.
7. Recherche FTS5 sur `/emails?q=`.
8. Déploiement : bindings réels, secret, catch-all, vérification de bout en bout.

Après chaque étape : un message de commit fourni à l'utilisateur, sans utiliser git.
