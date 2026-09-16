# MyTV

MyTV est un guide TV/EPG français mobile-first, statique et installable. Il ouvre directement sur une grille dense « maintenant / ensuite », avec une chronologie proportionnelle, les chaînes TNT fixes à gauche et les horaires fixes en haut.

## Démarrage local

Aucune installation ni compilation n’est nécessaire.

```sh
python3 -m http.server 8080
```

Ouvrez ensuite `http://localhost:8080`. Un serveur HTTP est nécessaire : les modules JavaScript, le service worker et les requêtes XMLTV ne fonctionnent pas correctement depuis une URL `file://`.

Pour développer sans source distante, passez `DATA_SOURCE` de `"remote"` à `"demo"` dans `js/app.js`. Le fichier `demo/sample.xml` est alors utilisé et ses horaires sont repositionnés sur le jour courant.

## Données EPG

Le projet s’appuie sur les outils du dépôt [IPTV-org/epg](https://github.com/iptv-org/epg) et sur sa configuration `programme-tv.net`. La liste réduite aux chaînes TNT se trouve dans `config/channels.xml`.

L’ancienne URL publique souvent référencée, `https://iptv-org.github.io/epg/guides/fr/programme-tv.net.epg.xml`, renvoie actuellement une erreur 404 (vérifié le 16 septembre 2026). Le serveur GitHub Pages envoie bien un en-tête CORS, mais il n’y a plus de fichier à cette adresse. L’accès direct à la source éditoriale depuis un navigateur n’est pas une solution fiable non plus : l’extracteur IPTV-org emploie des paramètres et en-têtes côté outil qui peuvent changer.

MyTV utilise donc une solution entièrement GitHub-native :

1. `.github/workflows/update-epg.yml` récupère le dépôt IPTV-org officiel ;
2. l’outil IPTV-org génère trois jours de XMLTV pour les 19 chaînes configurées ;
3. le résultat est validé puis enregistré dans `data/epg.xml` ;
4. l’Action redéploie Pages avec la nouvelle donnée ;
5. l’application charge ce fichier depuis sa propre origine GitHub Pages, sans problème CORS.

L’Action s’exécute toutes les huit heures et peut aussi être lancée manuellement dans l’onglet **Actions**.

## Cache et mode hors ligne

- Le XMLTV est analysé dans le navigateur puis normalisé en objets simples.
- Le résultat normalisé est enregistré dans IndexedDB pendant huit heures.
- Un cache encore frais évite tout téléchargement réseau.
- Si le rafraîchissement échoue, la dernière grille IndexedDB reste affichée.
- Le service worker met en cache l’interface et conserve aussi la dernière réponse XMLTV.
- Les préférences de chaînes et le niveau de zoom sont enregistrés dans `localStorage`.

L’abstraction `EpgProvider` dans `js/epg.js` expose `fetch()`, `parse()`, `getChannels()` et `getPrograms(channelId, start, end)`. La recherche de programmes utilise une recherche binaire dans des listes triées.

## Déploiement GitHub Pages

Le workflow `.github/workflows/pages.yml` déploie automatiquement le dépôt à chaque push sur `main`.

Dans **Settings → Pages** du dépôt GitHub :

1. choisissez **GitHub Actions** comme source ;
2. lancez une première fois **Mettre à jour le guide TV** si `data/epg.xml` n’est pas encore présent ;
3. attendez la fin du workflow **Déployer GitHub Pages**.

Le manifeste utilise des chemins relatifs : l’application fonctionne aussi bien sur un domaine racine que sous `https://utilisateur.github.io/MyTV/`.

## PWA iPhone

Dans Safari, ouvrez le site puis choisissez **Partager → Sur l’écran d’accueil**. L’application s’ouvre en mode autonome, respecte les zones sûres de l’iPhone, le mode sombre et le mode économie de mouvement.

La chronologie couvre sans coupure tous les jours présents dans le guide : continuez simplement à faire défiler vers la droite pour passer minuit et atteindre le lendemain. Le sélecteur de date se met à jour automatiquement. Un geste à deux doigts agrandit ou réduit les créneaux autour de l’heure située entre les doigts ; le même réglage reste accessible dans **Mes chaînes → Zoom de la grille**.

## Structure

```text
index.html                  interface et dialogues
css/app.css                 grille responsive, thèmes et interactions tactiles
js/app.js                   orchestration, navigation et rafraîchissement
js/epg.js                   fournisseur XMLTV et gestion des dates
js/storage.js               IndexedDB et préférences locales
js/ui.js                    rendu de la grille et panneaux
data/epg.xml                copie XMLTV générée automatiquement
demo/sample.xml             fixture de développement
config/channels.xml         sélection TNT pour IPTV-org
service-worker.js           cache du shell PWA
```

## Limites et licences

Le code de l’outil IPTV-org est publié sous sa propre licence, mais cela ne signifie pas que les horaires, descriptions, images et autres métadonnées collectés auprès de sources tierces sont libres de droits ou librement redistribuables. Vérifiez les conditions de la source avant toute diffusion publique ou commerciale. Le propriétaire du déploiement reste responsable de la collecte et de la redistribution de `data/epg.xml`.

La disponibilité et la structure de la source peuvent changer sans préavis. Le mode démo et le cache hors ligne permettent à l’interface de rester testable, mais ne remplacent pas un EPG à jour.
