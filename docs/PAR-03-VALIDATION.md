# PAR-03 — Renouvellement du jeton WebSocket

Issue : https://github.com/med1001/Privora-Mobile/issues/4

Branche : `codex/par-03-websocket-token-refresh`, base mobile `2b39e8f`.

## Contexte et solution

Le client conservait la chaîne du jeton obtenue à la connexion initiale et la
réutilisait après chaque coupure. Le test initial a reproduit un deuxième login
envoyant T1 au lieu de T2. La panne sur un véritable appareil n'a pas été reproduite.

`WsClient.connect` reçoit désormais une fonction de récupération du jeton.
Chaque tentative la rappelle ; les reconnexions demandent un renouvellement
forcé à Firebase. `AuthContext` transmet ce paramètre et refuse les demandes
d'une ancienne session. Firebase gère la validité des jetons : aucune durée
d'expiration personnalisée ni modification backend n'est ajoutée.

La tentative en cours est unique et possède une génération. Une déconnexion,
un timeout ou un changement de session invalide ses callbacks et résultats
retardés. Les événements d'une ancienne socket ne peuvent plus fermer la nouvelle.
La récupération du jeton et l'ouverture native sont bornées ensemble à 15 secondes.
Une requête Firebase déjà commencée ne peut pas être annulée, mais son résultat
obsolète ne peut créer aucune socket.

Les erreurs Firebase de session invalide/révoquée, utilisateur supprimé/désactivé
et le refus serveur WebSocket 1008 arrêtent les tentatives et déclenchent logout.
Les autres échecs, notamment réseau, restent récupérables. Les logs n'incluent
pas le jeton ni le contenu brut des erreurs Firebase.

Le heartbeat reste à 30 secondes. Le backoff est 1, 2, 4, 8, 16 puis 30 secondes
maximum. Il revient à 1 seconde après une connexion stable pendant 30 secondes,
pour éviter qu'une succession d'ouvertures très brèves contourne le backoff.

Le ticket [backend #43](https://github.com/med1001/Privora/issues/43), toujours
ouvert, concerne suppression de compte et expiration de tokens de validation.
Il a été examiné : cette correction ne change pas son périmètre ni les règles
d'expiration serveur. La détection d'une révocation est testée à la frontière
Firebase simulée ; aucun durcissement global de `verify_id_token` n'est revendiqué.

Référence du contrat Firebase :
[User.getIdToken](https://firebase.google.com/docs/reference/js/auth.user.md).

## Vérifications locales — 7 octobre 2026

- `npm run typecheck` : réussi.
- `npm run test:ci` : 47 tests réussis, 3 suites.
- 19 tests ajoutés : T1 → T2, erreurs d'authentification, récupération après erreur
  réseau, backoff plafonné, heartbeat, absence de connexions concurrentes,
  résultats tardifs après logout/timeout, événements obsolètes, timeout natif,
  doubles événements, propagation du renouvellement forcé et isolation du logout.
- Auto-revue du diff, sans sous-agent ni revue indépendante.

Les tests WebSocket utilisent une socket simulée et des horloges virtuelles.
Ils ne prouvent pas une reprise réelle après plusieurs heures en arrière-plan.
Aucune publication, fusion ou distribution mobile effectuée pour ce ticket.

## Recette sur téléphone — à réaliser

1. Installer un build natif Android contenant ce correctif. Se connecter avec un
   compte de test et vérifier envoi/réception de messages.
2. Garder la session ouverte au-delà de la durée du jeton initial (prévoir plus
   d'une heure), puis couper/rétablir le réseau. Vérifier la reprise des messages
   sans nouvelle saisie du mot de passe. Refaire après arrière-plan prolongé.
3. Répéter plusieurs coupures rapides : pas de messages dupliqués ni de plusieurs
   connexions actives pour cette instance dans les logs serveur. Plusieurs
   appareils connectés au même compte ne constituent pas une duplication.
4. Déconnecter pendant une coupure ou un renouvellement : aucune reconnexion
   ultérieure de cette session. Connecter B et vérifier l'isolation de A.
5. Avec un compte jetable, révoquer sa session ou désactiver le compte depuis
   l'administration Firebase, puis déclencher une reconnexion : retour au login,
   pas de boucle de reconnexion. Ne pas publier les jetons dans les preuves.
6. Noter commit/build, appareil/OS, durée, manipulations et résultats. Valider iOS
   séparément avant toute affirmation concernant iOS.

Recette appareil et CI distante non exécutées à ce stade ; issue laissée ouverte.
