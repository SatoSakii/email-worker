# email-worker

Boîte mail personnelle sur Cloudflare. Un Worker reçoit tout, stocke les mails et expose une API pour les lire.

## Fonctionnement

Un seul Worker avec deux handlers :

- `email()` : reçoit chaque mail, applique la blocklist, parse le message et le stocke.
- `fetch()` : API REST (Hono) protégée par un token Bearer.

| Service | Rôle |
| --- | --- |
| D1 | Métadonnées, texte, HTML, blocklist, index de recherche FTS5 |
| R2 | Mail brut (`.eml`) et pièces jointes |

Les mails sont conservés indéfiniment.

## Fonctionnalités

- Réception de tous les alias du domaine (catch-all)
- Filtre par alias destinataire
- Lu / non lu, étoile, corbeille, suppression définitive
- Recherche plein texte (objet, expéditeur, corps)
- Blocklist d'expéditeurs et d'alias
- Pièces jointes et mail brut dans R2
- Réception seule, pas d'envoi

## Stack

- TypeScript
- Hono
- postal-mime
- Cloudflare Workers, D1, R2
- Wrangler
- Vitest

## Installation

```bash
npm install
npx wrangler d1 create email-worker
npx wrangler r2 bucket create email-worker
```

Reporte l'identifiant de la base D1 dans `wrangler.jsonc`, puis applique les migrations :

```bash
npx wrangler d1 migrations apply email-worker --remote
```

Définis le token de l'API :

```bash
npx wrangler secret put API_TOKEN
```

## Développement

Crée un fichier `.dev.vars` :

```
API_TOKEN=un-token-de-dev
```

```bash
npm run dev
npm test
```

## Déploiement

```bash
npm run deploy
```

Dans le dashboard Cloudflare : Email, Email Routing, Routing Rules, Catch-all address, action « Send to a Worker », puis choisis `email-worker`.

## API

Toutes les routes demandent `Authorization: Bearer <API_TOKEN>`.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/emails` | Liste. Filtres : `alias`, `q`, `unread`, `starred`, `trash`, `limit`, `cursor` |
| GET | `/emails/:id` | Détail d'un mail |
| GET | `/emails/:id/raw` | Mail brut `.eml` |
| PATCH | `/emails/:id` | Modifie `is_read`, `is_starred`, `is_deleted` |
| DELETE | `/emails/:id` | Suppression définitive |
| GET | `/attachments/:id` | Télécharge une pièce jointe |
| GET | `/blocklist` | Liste la blocklist |
| POST | `/blocklist` | Ajoute une entrée |
| DELETE | `/blocklist/:id` | Retire une entrée |
| GET | `/mailboxes/:alias` | Dit si l'alias est verrouillé par un PIN |
| PUT | `/mailboxes/:alias/lock` | Pose un PIN de 4 à 8 chiffres (`{ "pin": "1234" }`) |
| POST | `/mailboxes/:alias/unlock` | Vérifie le PIN. 5 échecs bloquent l'alias 15 minutes (429) |
| DELETE | `/mailboxes/:alias/lock` | Retire le PIN : avec `{ "pin": "1234" }`, ou sans corps pour le forcer |

Pour retirer le PIN d'une boîte dont tu ne connais pas le code :

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$URL/mailboxes/$(printf %s 'alias@ton-domaine' | jq -sRr @uri)/lock"
```

`limit` vaut 50 par défaut, 100 au maximum. Le curseur de la page suivante est fourni par `next_cursor`. La suppression définitive demande que le mail soit d'abord dans la corbeille (`is_deleted: true`).

## Site web

Le dossier `web/` contient un site Next.js (Pages Router, TypeScript, Tailwind 4) pour lire les mails. Tu tapes le début d'une adresse (`test123`) et il ouvre `test123@ton-domaine`.

- Les boîtes sont publiques, sauf celles protégées par un PIN que n'importe quel visiteur peut poser.
- Le token de l'API reste côté serveur Next.js : le navigateur ne parle qu'aux routes `/api` du site.
- Le site ne permet ni de gérer la blocklist ni de supprimer définitivement un mail.
- Raccourcis : `J` `K` naviguer, `S` étoile, `U` lu / non lu, `#` corbeille, `/` chercher, `R` actualiser.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Variables de `web/.env.local` :

| Variable | Rôle |
| --- | --- |
| `WORKER_URL` | URL du Worker déployé |
| `API_TOKEN` | Token Bearer du Worker (le même que `wrangler secret put API_TOKEN`) |
| `MAIL_DOMAIN` | Domaine des alias, par exemple `sato-mail.xyz` |
| `SESSION_SECRET` | Clé de signature du cookie de session, par exemple `openssl rand -hex 32` |

## Limites

- 25 Mo maximum par mail (limite d'Email Routing)
- Plafond de 9 Go sur R2 (le free tier va jusqu'à 10 Go). Un mail qui ferait dépasser ce seuil est rejeté avec `mailbox full`. L'usage compte le `.eml` et les pièces jointes, donc une pièce jointe pèse deux fois. Pour libérer de la place, mets des mails à la corbeille puis supprime-les définitivement.
- Si le parsing échoue, le `.eml` brut reste sauvegardé dans R2

## Structure

```
src/
  index.ts
  email/
  api/
  db/
migrations/
test/
web/
wrangler.jsonc
```

## Licence

Projet open-source personnel, sous licence MIT.