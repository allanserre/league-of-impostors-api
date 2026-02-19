## Déploiement (Cloud Run)

```bash
gcloud run deploy league-of-impostors --source .
```

## Fonctionnement des rooms websocket

- Une room a un code unique (`6` caractères hex), un propriétaire, une liste de joueurs et un état de partie.
- `createRoom` crée la room et ajoute automatiquement le créateur.
- `joinRoom` valide le code, limite la room à `5` joueurs, et évite les doubles inscriptions.
- `leaveRoom` retire proprement un joueur, supprime les rooms vides et transfère le rôle de propriétaire si nécessaire.
- `startGame` vérifie qu'il y a au moins `2` joueurs puis assigne un rôle à chacun avant d'émettre l'état de partie.

## Idées d'améliorations complémentaires

- Ajouter une persistance Redis (rooms + sessions) pour supporter plusieurs instances serveur.
- Ajouter un timer d'expiration des rooms inactives.
- Ajouter des ACK Socket.IO (callbacks de succès/erreur) pour fiabiliser l'UI côté client.
- Ajouter des tests d'intégration Socket.IO (création/join/leave/startGame).
