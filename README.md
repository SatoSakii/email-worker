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
| GET | `/emails` | Liste. Filtres : `alias`, `q`, `unread`, `starred`, `trash`, `cursor` |
| GET | `/emails/:id` | Détail d'un mail |
| GET | `/emails/:id/raw` | Mail brut `.eml` |
| PATCH | `/emails/:id` | Modifie `is_read`, `is_starred`, `is_deleted` |
| DELETE | `/emails/:id` | Suppression définitive |
| GET | `/attachments/:id` | Télécharge une pièce jointe |
| GET | `/blocklist` | Liste la blocklist |
| POST | `/blocklist` | Ajoute une entrée |
| DELETE | `/blocklist/:id` | Retire une entrée |

## Limites

- 25 Mo maximum par mail (limite d'Email Routing)
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
wrangler.jsonc
```

## Licence

Projet open-source personnel, sous licence MIT.