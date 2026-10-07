# PAR-02 — Cycle push et changement de compte

Issue : https://github.com/med1001/Privora-Mobile/issues/3

## Livraison locale — 7 octobre 2026

Mobile : branche `codex/par-02-push-account-lifecycle`, base `eff4d231`.
Backend associé : dépôt `med1001/Privora`, branche `codex/par-02-push-recipient`,
base `f258f6ad`. Les deux changements sont nécessaires. Hors périmètre :
refonte de la signalisation/appels et issue backend #107.

Le test de régression a d'abord échoué sur le code initial : après A puis B,
`registerPushToken` n'avait reçu que les identifiants de A pour le même appareil.

## Solution et stratégie d'échec

- `AuthProvider` possède le cycle push. La déconnexion invalide immédiatement
  le destinataire local, nettoie notifications/actions/identifiants en cache,
  tente la désinscription avec l'utilisateur capturé, puis appelle Firebase
  `signOut`. Deux déconnexions simultanées partagent la même opération ; une
  nouvelle connexion attend sa fin.
- Les mutations réseau sont ordonnées et chaque inscription appartient à une
  session. Les opérations devenues obsolètes ne réactivent pas le cache. Chaque
  opération réseau est bornée à 8 secondes avec annulation de la requête ; une
  déconnexion peut attendre l'inscription en cours puis sa désinscription.
- Le backend ne désinscrit un token que si le demandeur authentifié en est
  encore propriétaire. Une désinscription tardive de A ne retire donc pas B.
- Les messages `incoming_call` et `cancel_call` contiennent `toUserId` (email du
  destinataire). Le même traitement filtre premier plan et arrière-plan. Les
  notifications et actions sans destinataire ou destinées à un autre compte
  sont ignorées. Les identifiants en cache sont eux aussi liés au destinataire.
- Hors réseau, la déconnexion locale se termine quand même. Le serveur peut
  conserver l'ancien token : aucune suppression distante immédiate n'est
  garantie. Une inscription réussie de B réattribue le token. Une inscription
  échouée est retentée à la prochaine connexion ou au retour au premier plan ;
  pas de boucle permanente ni de stockage des anciens identifiants pour retry.
- Une réponse en attente correspondant au compte restauré est préservée au
  démarrage. Elle est invalidée lors d'un changement de compte.

## Vérifications automatisées

Sur les sources livrées, avant les commits locaux :

| Commande | Résultat |
| --- | --- |
| Mobile : `npm run typecheck` | Réussi |
| Mobile : `npm run test:ci` | 28 tests réussis, 2 suites |
| Backend, depuis `server/` : `python -m unittest discover -s tests -v` | 4 tests réussis |

Les 23 nouveaux tests mobile couvrent notamment A → B sur le même token,
l'inscription en cours, les identifiants retardés, l'ordre désinscription/signOut,
la déconnexion répétée, le réseau indisponible et bloqué, la reprise de
l'inscription au premier plan, les identifiants révoqués après suppression,
les notifications/actions d'un autre compte, le démarrage à froid et le bridge
de réponse automatique. La majorité utilise la plateforme Android simulée ;
un test conserve le chemin d'inscription iOS.

Les 4 tests backend couvrent la propriété du token, la suppression d'un compte,
les destinataires des deux types de messages et l'absence d'envoi à A après
réattribution à B. Firebase, FCM, Notifee, stockage et réseau sont simulés : ces
tests ne prouvent pas la livraison native ni le comportement en production.
Auto-revue réalisée, sans revue indépendante par un autre agent.

## Ordre de déploiement obligatoire

1. Publier, vérifier et déployer le backend associé : ajout de `toUserId` et
   contrôle du propriétaire à la désinscription. L'ancien mobile accepte ce
   champ supplémentaire et l'API HTTP garde le même format.
2. Construire et distribuer le mobile après validation du backend.
3. Exécuter la recette ci-dessous avant clôture du ticket.

Un nouveau mobile face à l'ancien backend ignore les push sans `toUserId`.
Ne pas revenir à l'ancien backend tant que ce mobile est distribué sans prévoir
un correctif compatible. Aucun déploiement ni envoi FCM réel effectué ici.

## Recette Android à exécuter — non réalisée

Prérequis : build natif avec FCM/Notifee, backend corrigé, appareil Android,
comptes jetables A/B et appelant C. ADB n'est pas disponible dans cette session.
Noter versions/commits, appareil/OS, résultat et preuve pour chaque ligne.

| Scénario | Attendu |
| --- | --- |
| A connecté ; C appelle A, application au premier plan puis en arrière-plan | Appel reçu et réponse/refus fonctionnels |
| Déconnecter A, connecter B sur le même appareil ; C appelle A puis B | Aucun appel de A affiché ; B reçoit son appel |
| Notification A déjà affichée, puis logout A/login B ; utiliser une ancienne action si encore accessible | Notification retirée ; aucune réponse/refus sous B |
| Logout A en mode avion ; rétablir réseau ; connecter B | Logout terminé ; A filtré ; B inscrit et joignable |
| Connexion B sans réseau puis retour du réseau et retour au premier plan | Inscription retentée ; appel vers B reçu |
| Supprimer le compte jetable A depuis les réglages | Déconnexion et nettoyage malgré identifiants révoqués ; B reste utilisable ensuite |
| Appuyer plusieurs fois sur logout | Pas de crash, de session résiduelle ni de désinscription de B |
| Appel B quand l'application a été fermée, puis action Répondre | Restauration de B et réponse au bon appel ; ne pas assimiler fermeture et arrêt forcé Android |

Répéter séparément sur iOS avant d'affirmer une validation iOS. Les vérifications
sur appareil, la CI distante et le déploiement restent non réalisés. L'issue
reste ouverte tant que cette qualification n'est pas terminée.
