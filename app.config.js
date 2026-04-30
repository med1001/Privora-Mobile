/**
 * API + WebSocket (port 8000) pour le dev local.
 *
 * Défaut (aucune variable) : host = 10.0.2.2 → émulateur Android vers ton PC.
 *
 * Téléphone physique sans bloquer l’émulateur :
 * - Garde `.env` pour Firebase uniquement (comme `.env.example`).
 * - Crée un fichier `.env.local` (déjà ignoré par git) avec UNE ligne :
 *     EXPO_PUBLIC_API_HOST=192.168.x.x
 *   (IPv4 de ton PC, `ipconfig`, même Wi‑Fi que le téléphone ; pare-feu : port 8000.)
 * - Rebuild : `npx expo run:android`
 * - Pour repasser « émulateur seul » : supprime ou renomme `.env.local`, puis rebuild.
 *
 * Astuce : sur beaucoup de réseaux, la même IPv4 PC fonctionne pour l’émulateur ET
 * le téléphone ; dans ce cas tu peux laisser `.env.local` en permanence.
 *
 * USB + reverse (comme du « localhost » sur le téléphone) :
 *   EXPO_PUBLIC_API_HOST=127.0.0.1
 *   puis : adb reverse tcp:8000 tcp:8000  (et tcp:8081 pour Metro si besoin)
 *
 * Tout changement de EXPO_PUBLIC_API_HOST exige un rebuild natif (pas seulement reload).
 */
module.exports = ({ config }) => {
  const host = (process.env.EXPO_PUBLIC_API_HOST || "10.0.2.2").trim();
  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      apiBaseUrl: `http://${host}:8000`,
      wsUrl: `ws://${host}:8000/ws`,
    },
  };
};
