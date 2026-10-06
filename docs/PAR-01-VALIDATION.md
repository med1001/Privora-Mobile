# PAR-01 — Validation locale

Issue : https://github.com/med1001/Privora-Mobile/issues/2

Branche : `codex/par-01-mobile-tests-ci`.
Base : `4d1d31fdce92dc9b51ce7794b85b5ea017ec6e93`.
Livraison : modifications locales non commitées, validées indépendamment du développeur.

## Résultats

Environnement : Windows, Node.js 24.15.0, npm 11.12.1. Installation dans une
copie séparée sans node_modules préexistant, fichier .env ou identifiant natif.

| Vérification | Résultat |
|---|---|
| `npm ci` depuis le lockfile livré | Code 0 |
| `npm run typecheck` | Code 0 |
| `npm run test:ci` | 5 tests réussis, code 0 |
| Assertion volontairement erronée dans la copie de validation | Échec attendu, code 1 |
| Restauration intégrale du fichier, puis `npm run test:ci` | 5 tests réussis, code 0 |
| Comparaison SHA-256 package, lockfile, config Jest et tests après validation | Identiques à la livraison |
| Revue du workflow | PR et déclenchement manuel ; Node 24 ; npm ci, typecheck et test:ci ; permissions contents read ; aucun secret ou déploiement |

Le contrôle négatif remplace temporairement l'attente du compteur de non-lus
de 1 par 999 dans la copie de validation. La restauration est effectuée dans
un bloc finally. Aucun test volontairement cassé n'est livré.

## Couverture et limites

Les tests montent le vrai hook useChatSession : réception, fusion et déduplication
message/offline/history par msg_id, tri, séparation des conversations, nettoyage
au logout puis connexion d'un autre compte et rejet des événements tardifs.

Les frontières auth, réseau et audio sont simulées. Aucun changement au code
produit n'est inclus. Le remplacement direct de A par B sans logout et le compteur
de non-lus sur doublon sont des observations à suivre séparément.

Le workflow n'a pas encore été publié ni exécuté sur GitHub Actions. La validation
locale Windows ne prouve pas à elle seule l'exécution Linux du job distant.
Aucun appareil, Firebase réel, serveur WebSocket ou appel WebRTC n'a été testé.

Verdict : livraison validée localement, prête pour revue et publication ; ne pas
fermer l'issue comme intégrée avant la revue et le résultat de la CI distante.
