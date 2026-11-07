# SC-overlay : overlay tout-en-un (Tauri + moteur Python)

## Contexte

Aujourd'hui l'utilisateur a deux outils séparés :
- **SC-hauling** : overlay tkinter. Il lit `Game.log`, fait l'OCR et calcule la route, le commerce et le partage d'équipe.
- **SC-map** : la carte web, avec son API sur Cloudflare.

Il veut un overlay unique, façon Arkanis : on choisit ses widgets, on les place, on les règle, et la carte en fait partie. SC-map continue de vivre dans le navigateur.

Décisions prises :
- **Tauri (WebView2) + moteur Python** de SC-hauling, qui tourne à côté (sidecar).
- **L'overlay tkinter sera remplacé à terme.** Il reste utilisable pendant la transition.
- **La carte vient du site en ligne** (`https://versetime.ofs.workers.dev`), pas d'une copie incluse.

Contraintes :
- Aucune injection ni lecture mémoire (Easy Anti-Cheat).
- Le jeu doit tourner en fenêtré sans bordure.
- Peu de builds Netlify. Le site se déploie à la main avec `npm run deploy:site`, et seulement avec le feu vert de l'utilisateur dans la session SC-map.

## Vision

Réunir le meilleur des deux mondes :
- **Ce que personne d'autre ne fait** et qu'on a déjà : la route de transport (origine d'abord, temps de saut par vaisseau), l'heure locale et le jour ou la nuit, l'équipe en direct sur la carte (route, contrats, point qui avance pendant le saut), le commerce calé sur la tournée, la liste de courses.
- **Ce que font Arkanis et Wingman AI** : un overlay modulaire en jeu avec une palette de recherche (objets, lieux, vaisseaux, prix UEX) et, plus tard, un assistant vocal.

## Règles de travail
- **Captures en jeu à la demande.** Dès qu'une étape a besoin de vraies captures ou de vrais logs (OCR de la route du starmap, zones d'écran, rendu de l'overlay en jeu), on les demande à l'utilisateur à ce moment-là, avec la liste précise de ce qu'il doit capturer. On ne code jamais un OCR à l'aveugle.
- Au démarrage de l'exécution, enregistrer en mémoire : (a) cette règle des captures ; (b) l'idée d'assistant vocal, gardée pour plus tard.

## Économie de tokens

### Une seule session pour les 3 projets
- Nouvelle session, modèle **Sonnet**, dossier `C:\Users\Alexis\Documents\SC-overlay`, avec `SC-map` et `SC-hauling` ajoutés comme dossiers.
- Plus de relais entre sessions : c'était le gros coût (formats recopiés, corrections renvoyées).
- Avant de basculer, solder les 2 anciennes sessions :
  - SC-map : feu vert (ou non) pour déployer le correctif de fusion des contrats partagés ;
  - SC-hauling : feu vert pour ses commits en attente.
  
  Puis les archiver. Celle-ci aussi.
- Contexte de départ : ce plan + `contracts.md` (formats `/state`, `/ui`, `/action`, `/events`, routes Worker), pas les transcriptions.

### Sous-agents (dans `C:\Users\Alexis\.claude\agents\`, donc dispo dans toute session)
| Fichier | `model` | `tools` | Rôle |
|---|---|---|---|
| `search.md` | `haiku` | Read, Grep, Glob | cartographie un repo, lecture seule. Rend chemins + lignes + résumé court, jamais de fichier entier. |
| `grep.md` | `haiku` | Grep, Glob, Read | trouve les appels d'un symbole. Rend `fichier:ligne` + 1 ligne de contexte. |
| `tests.md` | `haiku` | Bash, Read | lance la suite : SC-hauling `python -m unittest discover -s tests -t .`, SC-map `npm test`, SC-overlay `cargo test`. Rend le total et seulement les échecs (nom + erreur). Ne corrige rien. |
| `reviewer.md` | `opus` | Read | lit seulement le plan et le diff final (fichier écrit par la session principale dans le scratchpad). Répond `APPROVE` ou `REJECT` + 5 raisons max. |

Alias `haiku` / `opus` = dernier modèle de la famille (Haiku 5.5, Opus 5.5). Les flags `--advisor` / `--subagents` ne sont pas vérifiés : on ne s'en sert pas, ces fichiers font le même travail.

### Règle ajoutée à `C:\Users\Alexis\Documents\CLAUDE.md`
(chargé par toute session sous `Documents`, donc les 3 repos)
```
## Agents
- Every repo search goes to the `search` or `grep` agent (haiku). Every test run goes to the `tests` agent (haiku).
- Call the `reviewer` agent (opus) before a plan locks, and after the same error happens twice. Give it the plan file and a diff file only.
- Read targeted excerpts, never whole files. No re-read after an edit.
- One site deploy per batch, only with the user's go-ahead.
```
Les MCP token-optimizer et token-savior-recall restent actifs ; les agents haiku peuvent s'en servir.

### Rythme
- Vague 1 : phase 0 (bugs), 1, 2, 3 (coque avec un faux `/ui`). Vague 2 : le reste.
- 1b et 4e attendent les captures de l'utilisateur.
- Un déploiement par vague.

## Phase 0. Bugs et petites améliorations (`SC-hauling/bug_improve.txt`)
| # | Retour | Repo probable |
|---|---|---|
| 1 | Fil d'Ariane : recentrer sur la planète ou le système, dézoomer sur la carte à plat | SC-map |
| 2 | Encart équipe reste bleu une fois décoché ; masqué, il réapparaît à chaque mise à jour | SC-map |
| 3 | Pas de bouton pour masquer ou afficher les contrats | SC-map (à confirmer) |
| 4 | Équipe créée et rejointe depuis le site : mal synchro, il faut passer par l'overlay | SC-map + SC-hauling |
| 5 | « Show only over the game » décoché, popup « join team » ouvert, Alt+Tab : l'overlay déraille | SC-hauling |
| 6 | Chip « Shared with me » dans les contrats | SC-hauling (+ SC-map) |
| 7 | Contrat partagé puis annulé par le coéquipier : reste chez moi « From Helmarok », perdu sur la carte | SC-hauling (+ SC-map) |
| 8 | OCR de route à étapes | déjà la phase 1b |

Chaque bug : `search`/`grep` pour trouver le code, correctif, test, `tests`. Le n°7 et le n°4 touchent le contrat d'équipe : passer par `reviewer`.

## Architecture

```
SC-overlay.exe (Tauri, Rust)
 ├─ fenêtre transparente plein écran sur l'écran du jeu, toujours au premier plan
 │    └─ widgets HTML/JS (route, cargaison, équipe, commerce, cap, alertes)
 │         └─ widget Carte = iframe https://versetime.ofs.workers.dev/?embed&live=<port>
 ├─ raccourci global, suivi du jeu au premier plan, exclusion des captures (pour l'OCR)
 └─ lance et arrête le sidecar : schauling-service.exe --port P --token T --parent-pid N
        └─ moteur SC-hauling sans interface : /state (public, inchangé), /ui, /events, /action (protégés par token)
```

### Modes de la fenêtre
- **Jeu** : les clics passent à travers. Seuls les widgets épinglés sont visibles, sans interaction.
- **Interaction** (raccourci, par exemple `Alt+O`) : l'overlay prend la souris, le fond s'assombrit et tous les widgets deviennent cliquables.
- **Édition** (depuis le mode Interaction) : déplacer, redimensionner, régler l'opacité et les options de chaque widget. Bouton « Ajouter un widget ».
- La fenêtre se masque quand le jeu n'est plus au premier plan, comme l'option actuelle de SC-hauling.

## Phases

### 1. SC-hauling : moteur sans interface + service (repo SC-hauling, sa session)
- **Extraire `schauling/controller.py`** de `overlay.py`, sans tkinter. Il récupère :
  - la boucle `tick` et le traitement des drapeaux de `Session.update()` (`session.py:245`) ;
  - `request_plan` (planning/replan) ;
  - la règle du vaisseau (`overlay.py:371-379`), `set_start` et sa source ;
  - `check_clipboard`, à refaire avec ctypes `OpenClipboard` au lieu de tk ;
  - `_apply_pages`, `read_contract_page` et `PageWatcher` (le HWND à exclure devient un paramètre facultatif) ;
  - `auto_showlocation` ;
  - les actions d'équipe (`create_team`, `join_team`, `leave_team`, `fill_from_team`) ;
  - `find_eta`, `refresh_prices` + `trade.suggest` ;
  - `watch_game` ;
  - la construction de `_live` (`overlay.py:820-830`), qui ne doit plus dépendre du rendu.
- **`overlay.py` devient une fine couche tk au-dessus du controller.** Le comportement ne change pas, et les tests existants doivent passer.
- **`python -m schauling --service --port P --token T --parent-pid N`** (nouveau `service.py`) lance le controller et le liveserver étendu. Il s'arrête si le process parent meurt.
- **Liveserver étendu** (`liveserver.py`) :
  - `GET /state` : inchangé (contrat public utilisé par le site et l'équipe).
  - `GET /ui` (token) : JSON structuré pour les widgets.
    - statut, vaisseau, départ et sa source ;
    - contrats et cargaisons avec leurs ids et marques sûr/`~`/`?` ;
    - étapes de la route avec actions, heures et jumps ;
    - total et capacité ;
    - suggestions de commerce ;
    - membres de l'équipe et recoupements (`team.crossings`) ;
    - cap/ETA, avertissements de patch, réglages ;
    - listes de lieux et de vaisseaux pour la recherche.
  - `GET /events` (token, Server-Sent Events) : pousse un événement à chaque changement de `/ui`.
  - `POST /action` (token) avec `{type, ...}`. Types : `set_start`, `set_ship`, `set_pickup`, `hide_contract`, `read_page`, `team_create`, `team_join`, `team_leave`, `team_name`, `set_option` (trade, budget, illegal, auto_showlocation…). Chaque action appelle les fonctions listées dans l'exploration (`tracker.set_pickup`, `team.api.create`, `config.save`…).
  - Token comparé en temps constant. CORS des routes à token limité à `http://tauri.localhost` et `https://tauri.localhost`. Le contrôle Host reste tel quel.
- **Build** : deuxième cible PyInstaller `schauling-service.exe` (console, lancée sans fenêtre par Tauri). En mode service, `updater.py` est coupé : c'est Tauri qui met à jour.
- **Tests** : controller (drapeaux, règle du vaisseau, départ), `/ui`, `/action` (token absent → 401, mauvais token → 401), SSE, CORS tauri.

### 1b. SC-hauling : OCR de la route du starmap du jeu (étapes intermédiaires)
Le jeu peut imposer des sauts intermédiaires pour contourner une planète : points OM, puis destination. Le log n'en donne que le nombre, jamais les noms. Vu dans les logs de l'utilisateur : `Local Route Guard … |FinalStop=N` avec N = 0, 1 ou -1 (pas de route), et `CalculateRoute|Projected Start Location is X for route to destination Y`.
- **Étape 0, calibrage :** au moment de commencer cette étape, demander à l'utilisateur 2 ou 3 captures du starmap avec une route à étapes (et le Game.log du moment). Elles servent à repérer la zone du panneau de route et le format des lignes (nom, distance en Gm/Mm).
- **Déclencheur :** une ligne `CalculateRoute` pour son vaisseau, suivie d'un `FinalStop ≥ 1`. On ne fait l'OCR que s'il y a des étapes intermédiaires, et seulement si le jeu est au premier plan. Captures à environ 0,6 / 1,2 / 2,0 s, sur le modèle de `pagewatch.py` (`PageWatcher`, `ocr.capture_window`, le worker PowerShell de `ocr.py`), limitées à la zone du panneau de route.
- **Lecture :** une liste ordonnée d'étapes. Chaque nom est résolu par `places.resolve`. Les points OM restent en texte (`"OM-3 microTech"`) avec la position de leur corps parent, tant que SC-map n'a pas leurs coordonnées. Le nombre d'étapes lues doit correspondre à `FinalStop`, sinon le résultat est rejeté.
- **Résultat :**
  - `heading.via = [{name, place|null}]` (facultatif, 8 au plus), dans `/state`, `/ui` et le PUT d'équipe ;
  - l'eta additionne les étapes ;
  - la distance tirée du carburant (déjà calculée) sert de contrôle ;
  - le détour est gardé en cache (`from → to → via`) pour corriger les futures estimations de route de SC-hauling.
- **Sans OCR ou en cas d'échec :** ligne droite, comme aujourd'hui.
- **SC-map** (avec la phase 2) :
  - le Worker garde `heading.via` ;
  - le site trace la route par les étapes, et le point mobile avance sur cette ligne brisée, au prorata des distances.
- **Tests :** parse de captures d'exemple (fixtures), correspondance avec `FinalStop`, `via` vide → ligne droite.

### 2. SC-map : mode `?embed` (repo SC-map, sa session, un seul déploiement)
- `?embed` masque la topbar, la sidebar et les panneaux. Il garde la carte, la route live, l'équipe et le point mobile, avec une étiquette compacte.
- `&bg=transparent` active `WebGLRenderer({ alpha: true })` (`js/scene/view.js:16`) et un fond transparent (`css/style.css:24`).
- En embed, les raccourcis clavier ne réagissent qu'au focus. Le rendu est limité (par exemple 30 i/s) et mis en pause si la page est cachée (`visibilitychange`) ou sur un `postMessage({pause:true})` du parent.
- Le site garde `?live` tel quel : le sidecar sert le même `/state` sur 127.0.0.1.

### 3. SC-overlay : la coque (nouveau repo `C:\Users\Alexis\Documents\SC-overlay`)
- Tauri 2, frontend en JS vanilla sans bundler (comme SC-map), plugins `global-shortcut`, `shell` (sidecar via `externalBin`), `updater`, `single-instance`.
- Rust (`src-tauri/src/`) :
  - fenêtre `transparent`, `decorations: false`, `always_on_top`, `skip_taskbar`, sur l'écran du jeu ;
  - `set_ignore_cursor_events` selon le mode ;
  - suivi du jeu au premier plan (crate `windows` : `GetForegroundWindow` + nom du process `StarCitizen.exe`, sans ouvrir le process) ;
  - `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` sur la fenêtre, pour que l'OCR ne capture pas l'overlay ;
  - lancement du sidecar avec un port libre et un token aléatoire, transmis au front par une commande Tauri ; arrêt du sidecar à la fermeture.
- Front (`ui/`) :
  - `overlay.js` : modes, grille, glisser et redimensionner, sauvegarde ;
  - `api.js` : `/ui`, `/events`, `/action` avec le token ;
  - un module par widget dans `ui/widgets/`.

### 4. Widgets v1
Carte (iframe embed), Route, Cargaison et contrats, Équipe, Commerce sur la route, Cap et heure (destination, ETA, heure locale d'arrivée), Alertes (avertissements de patch, erreurs du service). Chaque widget a un `type`, des `settings`, une position, une taille, une opacité et un drapeau « épinglé en mode jeu ».

### 4a. Rappel d'achat sur place
- La liste de courses (encart Shopping de SC-map, stockée en localStorage `shoppingItems`) est copiée dans l'overlay. Elle reste modifiable depuis la palette de recherche (4b).
- Quand `location` (log ou `/showlocation`) est un lieu qui vend un objet de la liste (`/buy?item=…`, résultat gardé en cache par lieu), un widget ou une notification affiche « ici : P4-AR (12 400), MedPen ».
- Un clic coche l'objet comme acheté.
- **Même rappel pour le commerce sur la route.** À un arrêt où `trade.suggest` prévoit un achat ou une vente, le widget affiche par exemple « ici : achète 32 SCU Agricium (max 8 379/SCU) » ou « ici : vends 32 SCU Agricium (+45k) ». Le rappel tombe quand l'arrêt suivant est atteint ou quand l'utilisateur le coche (`/action trade_done`). Les suggestions viennent de `/ui` (déjà calculées par `trade.py`).

### 4c. Équipe+
Toutes ces fonctions passent par le Worker existant (Durable Object `Team`, WebSocket) et la carte de l'équipe.
- **Même serveur.** SC-hauling lit l'identifiant du serveur de jeu dans le log (`pub_euw1b_…`, vu dans le Game.log de l'utilisateur) et l'ajoute à `/state` (`shard`). La carte et le widget Équipe grisent les membres d'un autre serveur.
- **Repères partagés.**
  - Action « Marquer ici » : SC-hauling prend les dernières coordonnées `/showlocation` (`places.parse_coordinates`) et un libellé.
  - Le Worker reçoit `POST /teams/<code>/marks` (expiration 24 h) et diffuse le repère par la WebSocket.
  - La carte affiche le repère. L'overlay donne le cap et la distance depuis la position de chacun (calcul de rotation de `js/astro.js`).
  - Le format du presse-papiers `/showlocation` est à vérifier sur de vraies captures, au moment de le coder.
- **Rendez-vous équitable.** Nouvelle route d'API `/meet?from=A,B,C&ship=…&service=refuel|clinic|padL` : le lieu qui réduit le plus long trajet. Un clic sur le résultat le propose à toute l'équipe (« RDV Seraphim 21:30 »), puis chacun voit son temps de trajet.
- **Notes sur les lieux.** `PUT /teams/<code>/notes/<lieu>` : texte court, visible dans la fiche du lieu sur la carte et dans la palette.
- Côté Worker : la validation garde `shard`, et les nouvelles routes sont limitées en débit comme les PUT actuels.

### 4d. Jauge quantique (abandonnée)
Widget, lecture OCR du panneau et calcul de route supprimés à la demande de l'utilisateur : la jauge n'apportait rien de plus que l'info à bord. Ce qui suit est l'idée d'origine, gardée pour mémoire.
- SC-hauling cumule le carburant de chaque saut. La consommation se lit dans le « fuel estimate » du log, déjà parsé pour l'eta.
- La capacité du réservoir vient de scunpacked : `Systems.QuantumDrives.Summary.FuelCapacity`, à ajouter à `ships.json` de SC-map par `tools/import-ships.mjs`.
- `/state` et `/ui` reçoivent `qtFuel: {used, capacity, jumpsLeft}`. `jumpsLeft` se calcule sur la consommation moyenne, ou sur le prochain saut de la route quand il est connu.
- Remise à zéro :
  - si le plein apparaît dans le log (à vérifier sur un vrai log, à demander à l'utilisateur au moment de le coder) ;
  - sinon, par une action « plein fait » (`/action refuel`) ;
  - et à chaque changement de vaisseau.
- Le widget affiche une jauge. Si le reste ne couvre pas la route, il propose le premier arrêt de la route qui a le service de carburant (`amenities.json`).

### 4e. Pad ou hangar attribué
- Quand l'ATC attribue un pad ou un hangar, un widget l'affiche en grand (« Hangar 04 ») jusqu'à l'atterrissage ou au départ.
- Source : les lignes ATC et `Hangar Request Completed` du log. Le numéro reste à confirmer : au moment de le coder, demander à l'utilisateur une capture de l'attribution et le Game.log du moment. Si le log ne donne pas le numéro, on passe par l'OCR du message à l'écran.

### 4f. Widgets sur tablette ou téléphone
- Option « Second écran » : le service sert les widgets en lecture seule sur le réseau local (`http://<ip-du-PC>:<port>/tablet`).
- Accès protégé par un code d'appairage affiché dans l'overlay (QR code), qui produit un jeton distinct de celui de Tauri.
- Les actions depuis la tablette sont limitées : cocher un achat, « plein fait ».
- L'option est coupée par défaut. En la cochant, l'utilisateur voit que le PC écoute sur son réseau local.

### 1c. Textes du jeu : marcher sans réglage, pack d'améliorations en option
Aujourd'hui, SC-hauling s'appuie sur des surcharges de texte que l'utilisateur colle dans le `user.ini` de Smart Citizen (`smartcitizen/user.ini.example`). Exemples : `HaulCargo_obj_itemspecifics_01` avec `|Address` pour avoir la station plutôt que « Stanton System », les titres Ling Family MultiToSingle et SingleToMulti, Covalex et Red Wind avec tous les lieux. Un nouvel utilisateur n'aura pas ces surcharges.
- **Marcher avec les textes de base du jeu.**
  - Faire la liste de ce qui dépend des surcharges, puis prévoir un repli pour chaque cas :
    - destination « Stanton System » : position du marqueur (`places.nearest`, déjà utilisé pour les pickups), puis OCR de la page du contrat ;
    - titres sans lieux : OCR de la page et code du contrat.
  - Ajouter des tests sur des fixtures de `global.ini` d'origine, en anglais et en français. L'overlay doit afficher une route juste avec les textes de base, même si quelques lieux restent marqués `~` ou `?`.
- **Pack d'améliorations, en un clic.**
  - Les surcharges vivent dans un fichier versionné du dépôt (successeur de `user.ini.example`). Il est mis à jour comme `rules.json`.
  - L'overlay détecte la situation et propose « Installer les améliorations de texte » :
    - **Smart Citizen présent** : il fusionne les clés dans `LIVE\user.ini` de Smart Citizen, entre des marqueurs `; SC-overlay begin/end`. Les lignes de l'utilisateur ne sont pas touchées. Il lui dit ensuite de cliquer « Apply Enhancements » dans Smart Citizen.
    - **Un `global.ini` de localisation existe déjà** (pack de traduction) : il remplace les clés dans ce fichier, avec une sauvegarde et un retour arrière.
    - **Aucune localisation** : il installe le `global.ini` par défaut du dépôt (voir plus bas) dans `LIVE\data\Localization\english\global.ini`, avec `g_language = english` dans `LIVE\user.cfg` si la ligne manque. Un bouton « Désinstaller » le retire et revient aux textes du jeu.
- **`global.ini` par défaut, versionné dans le dépôt.**
  - Source sans extraire `Data.p4k` : `labels.json` de scunpacked-data. C'est le `global.ini` anglais complet, en JSON (~11 Mo), et chaque commit porte la version du jeu (dernier commit : `4.10.2-LIVE.12881860`).
  - Script de maintenance `tools/build_globalini.py` :
    1. télécharge `labels.json` pour la version voulue ;
    2. écrit `global.ini` en UTF-8 avec BOM, au format `clé=valeur`, comme le jeu ;
    3. applique les surcharges du pack ;
    4. écrit l'en-tête `; game 4.10.2-LIVE.12881860`, puis le fichier `localization/english/global.ini` dans le dépôt.
  - Une commande, un commit, une release. Un workflow GitHub Actions peut lancer le script quand le `labels.json` de scunpacked change, puis ouvrir une PR.
  - **Contrôle de version.** Le numéro de build du jeu se lit dans le log (`pub_euw1b_12881860_410`, et l'en-tête du Game.log). Si le `global.ini` installé vient d'un autre build, l'overlay prévient : « textes d'une autre version, mettre à jour ou désinstaller ». Un vieux fichier fait apparaître les nouvelles clés en brut dans le jeu.
  - Pour les cas Smart Citizen et pack de traduction, le pack seul (les clés) suffit. Le fichier complet ne sert qu'en l'absence de localisation.
  - Après un patch, `patchcheck.py` vérifie que les clés du pack sont toujours appliquées et propose de les réappliquer.
  - Le widget Alertes affiche l'état du pack : « actif », « absent » ou « à réappliquer ».
- Les surcharges ne touchent que des fichiers de texte que le jeu lit pour la localisation. Elles n'agissent pas sur le process.

### Langue de l'overlay
- Interface en anglais par défaut, avec une traduction française au choix dans les réglages.
- Textes dans `ui/i18n/en.json` et `ui/i18n/fr.json`.
- Les noms du jeu (lieux, objets, marchandises) suivent le `global.ini` que lit le jeu (Smart Citizen compris), quelle que soit la langue de l'interface.

### 4b. Palette de recherche (façon Arkanis)
- Un champ de recherche est en permanence dans la barre du haut (modes Interaction et Édition) : objets, lieux, vaisseaux, marchandises. Les résultats s'affichent dans une liste sous le champ. Le raccourci (`Alt+P`) passe en mode Interaction et met le focus dans ce champ.
- Chaque résultat montre l'essentiel :
  - un objet : où l'acheter près de toi (`/buy`), avec le temps de trajet ;
  - un lieu : heure locale, services, pad maximum ;
  - un vaisseau : soute, moteur quantique, où l'acheter ou le louer ;
  - une marchandise : meilleurs prix (`/commodities`).
- Actions sur un résultat : « ajouter à la liste de courses » (`/shopping`), « définir comme départ », « voir sur la carte ».
- Données : l'API VerseTime existante. Les noms français viennent de `global.ini` (Smart Citizen) quand il est présent.

### 5. Profils et réglages
- `%APPDATA%\SC-overlay\layouts.json` : `{ profiles: { transport: { widgets: [...] }, equipe: {...} }, active, hotkeys }`.
- Raccourci pour changer de profil. Réglages globaux : raccourcis, écran, opacité, masquer hors du jeu.
- Déjà fait : les deux raccourcis se changent par variables d'environnement, `SC_OVERLAY_HOTKEY` (défaut `Alt+O`) et `SC_OVERLAY_PALETTE_KEY` (défaut `Alt+P`), par exemple `Ctrl+Shift+F9`. Une valeur invalide garde le défaut et s'affiche en avertissement. Le bouton « Back to game » montre le raccourci réel. - Déjà fait aussi : `%APPDATA%\SC-overlay\layouts.json` (`ui/js/settings.js`, `src-tauri/src/settings.rs`).
  - Profils de disposition. En mode Édition : liste, « Add » (copie de la disposition active) et « Delete » (jamais le dernier). Le premier profil reprend l'ancienne disposition du `localStorage` (`layout2`, jamais effacée).
  - Troisième raccourci, `Alt+I` par défaut (`SC_OVERLAY_PROFILE_KEY`), pour passer au profil suivant. Un message court s'affiche, même en mode Jeu.
  - Les raccourcis se règlent aussi à la main dans le bloc `hotkeys` du fichier (`toggle`, `palette`, `profile`). Ordre : fichier, variable d'environnement, défaut. Un doublon revient au défaut avec un avertissement. Ils ne se relisent qu'au démarrage.
  - Le fichier garde ses champs inconnus. Un fichier illisible est copié en `layouts.json.bak` avant toute écriture ; si la copie échoue, rien n'est écrit. Écriture par fichier temporaire puis renommage.
  - Bouton « Settings » dans la barre (`ui/js/settingspanel.js`) :
    - les trois raccourcis se saisissent en appuyant sur les touches (nom de la touche physique, donc AZERTY correct ; modificateur obligatoire sauf F1 à F12 ; AltGr refusé) et s'appliquent tout de suite, sans redémarrage ;
    - pendant la saisie les raccourcis sont désenregistrés (sinon le système prend la touche avant la page) ; ils reviennent à la fermeture, au chargement de la page et seuls au bout de 15 s ;
    - ce qui est réglé dans Settings (bloc `hotkeys` du fichier) l'emporte sur une variable d'environnement `SC_OVERLAY_*` oubliée dans la session : la variable ne sert que pour un raccourci absent du fichier ;
    - profils : ajouter (copie de l'actif), renommer, utiliser, supprimer (jamais le dernier).
  - Hors du mode Jeu, un voile sombre couvre le jeu derrière l'overlay (`dim`, 0,55 par défaut, réglable de 0 à 0,9 dans Settings, gardé dans le fichier). Un vrai flou du jeu demanderait un effet Windows (Acrylic) sur la fenêtre : à essayer en jeu avant de l'adopter, car il peut gêner la transparence et l'exclusion des captures.
  - Flou du jeu derrière l'overlay hors du mode Jeu : effet Acrylic de Windows (`set_effects`), case « Blur the game » dans Settings (actif par défaut, gardé dans le fichier). Pas encore essayé en jeu : si la transparence ou le jeu en souffre, la case le coupe et le voile sombre reste.
  - Quatrième raccourci, `Alt+U` par défaut (`SC_OVERLAY_WIDGETS_KEY`, ou « Show widgets » dans Settings). En mode Jeu il fait défiler : widgets épinglés, puis tous les widgets du profil (les masqués restent masqués), puis aucun. Le choix n'est pas gardé.
  - Reste à faire : un raccourci direct par profil, l'écran, l'opacité globale.

### 6. Paquet et mises à jour
- Installeur NSIS (bundler Tauri) avec `schauling-service.exe` en `externalBin`.
- Mise à jour par releases GitHub (plugin updater, clé de signature des mises à jour). L'exe n'est pas signé : avertissement SmartScreen comme aujourd'hui.

### 7. Retrait de l'overlay tkinter
Quand SC-overlay couvre tout ce que fait l'overlay tk (vues cargaison, route et équipe, menus, sélecteurs), retirer `overlay.py`, `picker.py` et la cible exe tk de SC-hauling.

### Plus tard (hors de ce plan) : assistant vocal façon Wingman AI
Idée gardée en mémoire, pas planifiée. Questions à la voix (« combien de temps jusqu'à Area18 ? », « où acheter un P4-AR ? »), réponses parlées, annonces (arrivée, contrat qui expire), à partir de `/ui`, de `/action` et de l'API. L'architecture service + `/action` le permettra sans tout refaire.

### Idées en réserve (non planifiées, à reprendre si l'utilisateur les choisit)
- **Organisation :** ready-check, rôles, flotte de l'équipe, planning d'opérations.
- **Renseignement :** signalements PvP partagés, zones à risque, escorte.
- **Progression :** réputation par OCR, stock partagé pour le crafting et Wikelo.
- **Événements :** minuteurs (hangar exécutif, zones contestées), contrats de groupe.
- **Alertes de jeu :** sécurité, fin de saut, pad trop petit, délai des contrats.
- **Hors jeu :** ntfy, statut Discord, reprise après crash, contrôle après patch.

## Ordre et parallélisme
- La phase 1b peut commencer dès que l'utilisateur a fourni les captures. Elle ne dépend pas de la coque.
- Les phases 1 (SC-hauling), 2 (SC-map) et 3 (coque SC-overlay, avec un faux sidecar qui sert un `/ui` figé) sont indépendantes. Elles peuvent avancer en parallèle, chacune dans sa session.
- 4c (Équipe+) a une partie SC-hauling (`shard`, « Marquer ici »), une partie Worker et site (`/meet`, `marks`, `notes`) et une partie widget. Les deux premières peuvent avancer avant la coque.
- Les phases 4 à 6 suivent la 3 et utilisent les résultats de 1 et 2. La phase 7 vient en dernier.
- Format de `/ui` : la phase 1 en écrit le schéma dans le README de SC-hauling. La phase 3 démarre avec un exemple figé de ce schéma.

## Vérification
- **SC-hauling** : `python -m unittest discover -s tests -t .` (les 87 tests existants plus les nouveaux). `python -m schauling --service --port 47900 --token x`, puis `curl` sur `/ui` (401 sans token, 200 avec), `POST /action set_ship`, et `/events` qui pousse un changement.
- **SC-map** : `npm test`. En local (`npm start`), `?embed&bg=transparent&live` sans interface et avec un fond transparent. Puis un seul `deploy:site` avec le feu vert.
- **SC-overlay** : `cargo tauri dev`.
  - Fenêtre transparente, clics qui passent à travers en mode Jeu, `Alt+O` pour l'Interaction, glisser et redimensionner puis relancer (disposition gardée).
  - Sidecar lancé puis tué à la fermeture.
  - Masquage quand une autre fenêtre passe devant le jeu.
- **En jeu, par l'utilisateur** (fenêtré sans bordure) :
  - les clics et la souris du jeu ne sont jamais bloqués en mode Jeu ;
  - l'OCR d'un contrat accepté marche avec l'overlay affiché (exclusion des captures) ;
  - la carte suit le saut quantique ;
  - le coût en i/s est mesuré avec et sans le widget Carte.
