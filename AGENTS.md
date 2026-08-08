# AGENTS.md

Instructions pour les agents IA travaillant sur ce dépôt. Les règles du
`AGENTS.md` personnel de l'utilisateur (style des messages de commit)
s'appliquent en plus de celles-ci.

## Projet

Extension Thunderbird « Pixel Detector » : détecte les pixels de suivi dans les
emails **sans jamais charger les contenus distants** (analyse statique du source
HTML via `messages.getFull`), avec alerte visuelle (badge sur le bouton
d'en-tête + popup détaillé). Manifest V3, permission `messagesRead`,
`strict_min_version: 128.0`.

- **Langue du projet : français** (commentaires, messages UI, docs).
- Documents de référence : `README.md` (vue d'ensemble), `DETECTION.md`
  (fonctionnement complet de la détection + guide d'amélioration).

## Commandes

| Commande | Rôle |
| --- | --- |
| `pnpm test` | Tests Vitest (35 tests) |
| `pnpm exec biome check .` | Lint + format (0 erreur attendu) |
| `pnpm build` | `tsc --noEmit` + build Vite → `dist/` |
| `pnpm tb:lint` | build + `web-ext lint` (0 erreur, 4 warnings connus tolérés) |
| `pnpm tb:build` | Génère un XPI signable dans `artifacts/` |

Pipeline de validation avant commit :
`pnpm test` → `pnpm exec biome check .` → `pnpm build` → `pnpm tb:lint`.

## Architecture

- `src/lib/detector.ts` — **moteur de détection pur** : aucune API Thunderbird,
  uniquement de l'analyse de texte. Point d'entrée : `detectTrackingThreats(html)`.
- `src/models/tracking.ts` — types du domaine (`AnalysisResult`, `TrackingPixel`,
  `TrackingLink`, `TrackingResource`), ré-exportés par `detector.ts` pour ne pas
  casser les imports du background et du popup.
- `src/background/background.ts` — orchestration : scan à l'affichage
  (`onMessagesDisplayed`, debounce 300 ms), badge, réponses au popup.
- `src/popup/main.ts` — rendu du popup (appel au background via
  `runtime.sendMessage`).
- `src/types/thunderbird.d.ts` — types minimaux des API Thunderbird
  (`mailTabs`, `messageDisplay`, `messages`, `messageDisplayAction`).

## Conventions de code

- TypeScript strict (`strict`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax`) ; indentation par tabulations ; guillemets doubles
  (Biome).
- Le moteur reste **pur** : ne jamais importer d'API Thunderbird dans
  `detector.ts`.
- **Ne jamais charger un contenu distant**, même pour vérifier une URL.
- Les `reasons[]` (raisons de signalement) sont en **français**, courtes et
  explicites : elles s'affichent telles quelles dans le popup.
- Les nouveaux types de domaine vont dans `src/models/`, ré-exportés depuis
  `detector.ts`.
- Toute nouvelle technique de détection : un test **positif** + un test
  **négatif** (pas de faux positif) dans `src/lib/detector.test.ts`.
- Tout contenu dynamique injecté dans le popup passe par `escapeHtml` (les URLs
  viennent d'emails potentiellement hostiles).

## Pièges connus

- L'ancien moteur s'appelait `detectTrackingPixels` : ne pas utiliser ce nom,
  c'est `detectTrackingThreats`.
- Biome 2 ne supporte pas le Markdown : les `.md` ne sont pas vérifiés ; garder
  les fins de ligne en LF.
- `web-ext lint` : 4 warnings connus à ne pas « corriger » (permission
  `messagesRead` spécifique Thunderbird, `data_collection_permissions` manquante
  dans le manifeste, 2× `innerHTML` déjà échappés).
- Warnings git « LF will be replaced by CRLF » sous Windows : normaux (autocrlf).
- `src/content/content.ts` est vide (réservé) ; `src/style.css` et `src/assets/*`
  sont des vestiges du template Vite inutilisés — ne pas les modifier sans accord.
- Environnement Windows avec shell `sh` (Git Bash) : préfixer les commandes git
  pouvant ouvrir un éditeur par `GIT_EDITOR=true`, et utiliser `--no-pager` pour
  les commandes de lecture (`git log`, `git diff`…).

## Workflow

- L'utilisateur valide les techniques de détection **une par une** : ne pas
  implémenter de nouvelle technique sans son accord explicite.
- Commits conventionnels atomiques (`feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`) — style du message : voir le `AGENTS.md` personnel.
- Ne committer que lorsque l'utilisateur le demande (ou l'a demandé pour la
  session en cours).
- Test manuel dans Thunderbird : « Déboguer les modules complémentaires » →
  « Charger un module complémentaire temporaire » → `dist/manifest.json`, puis
  **Recharger** après chaque `pnpm build`.
