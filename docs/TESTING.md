# Tests mobiles

Prérequis : Node.js 24 LTS (CI), npm et le dépôt mobile. Aucun téléphone,
serveur, compte Firebase, fichier `.env` ou identifiant natif n'est nécessaire.

```sh
npm ci
npm run typecheck
npm run test:ci
```

`npm test` lance aussi une exécution unique ; `npm test -- --watch` active
explicitement la surveillance. Un test en échec retourne un code non nul.
La CI `.github/workflows/mobile-tests.yml` exécute les trois commandes sur
chaque pull request et peut être déclenchée manuellement. Elle ne déploie rien
et ne demande aucun secret. Rendre le job `tests` obligatoire avant fusion
nécessite une règle de protection GitHub distincte.

## Périmètre

Jest 29 et le preset `jest-expo` 54 correspondent au SDK Expo 54 du projet.
React Native Testing Library 13 monte le vrai hook `useChatSession` avec
`react-test-renderer` fixé à **19.1.0**, exactement comme React. Conserver cet
alignement lors des mises à jour. Le lockfile assure l'installation reproductible.

Les tests `src/hooks/__tests__/useChatSession.test.ts` vérifient :

- réception d'un message, création du contact et lecture des non-lus ;
- fusion des messages temps réel, hors ligne et de l'historique par `msg_id` ;
- actualisation des données et tri chronologique de l'historique ;
- séparation des conversations entrantes et sortantes ;
- déconnexion, purge de l'état puis connexion d'un autre compte, y compris
  un événement tardif de l'ancien abonnement.

Seules les frontières `useAuth` (Firebase et stockage natif), `WsClient`
(réseau) et `expo-av` (son) sont remplacées dans ce fichier. Le hook et ses
transformations ne sont pas simulés. Chaque test recrée ses doubles ; Testing
Library démonte automatiquement le hook. Aucun accès réel à Firebase ou au
réseau n'est requis.

## Ajouter un scénario

Créer un fichier `*.test.ts` ou `*.test.tsx` sous `src`. Monter le composant ou
hook réel, simuler uniquement ses dépendances externes, utiliser `act` pour les
événements et `waitFor` pour les effets asynchrones. Vérifier le comportement
observable ; éviter les délais arbitraires et les copies de logique métier.

Ces tests ne valident pas le transport WebSocket réel, Firebase, les sons sur
appareil, les notifications, WebRTC ni le fonctionnement en arrière-plan.
Les vérifications fonctionnelles sur appareils restent nécessaires.
Le changement de compte couvert passe par la déconnexion (`user = null`).
Le remplacement direct de A par B sans déconnexion et la déduplication du
compteur de non-lus restent hors de ce socle de tests et demandent un suivi.

Référence : [tests unitaires Expo](https://docs.expo.dev/develop/unit-testing/).
