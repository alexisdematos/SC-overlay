# Phase 6: paquet et mises a jour

## Etat verifie
- `tauri.conf.json`: `bundle.active=false`, pas d'externalBin, pas d'updater, version 0.1.0.
- `sidecar.rs:12,102-108`: en paquet, cherche `schauling-service.exe` a cote de l'exe de l'overlay. Hook dev: `SC_SERVICE_EXE`.
- SC-hauling: `build.py` produit `dist\schauling-service.exe` (PyInstaller onefile, console). Pas dans le zip.
- Depots GitHub: SC-hauling et SC-map ont un remote `alexisdematos/...`. SC-overlay n'a aucun remote.
- CSP: `frame-src` contient `http://127.0.0.1:8093` (dev).

## Etapes
1. Installeur NSIS (Tauri bundler), `bundle.active=true`, `targets=["nsis"]`, install par utilisateur (pas d'admin).
2. Service en `externalBin`: `src-tauri/binaries/schauling-service-x86_64-pc-windows-msvc.exe` (copie de `SC-hauling\dist`). Tauri retire le suffixe a l'install: `sidecar.rs` marche sans changement. Script `scripts/prepare-sidecar.ps1` qui reconstruit et copie.
3. CSP: sortir `127.0.0.1:8093` de `csp` (release), le mettre dans `devCsp` si la cle existe (a verifier dans le schema Tauri 2 avant).
4. Updater: `tauri-plugin-updater` (version a lire dans le registre, pas devinee), cle de signature (`tauri signer generate`), `pubkey` dans la conf, `endpoints` vers `latest.json` des releases GitHub, permission `updater:default`, `bundle.createUpdaterArtifacts`.
5. UI: bouton "Verifier les mises a jour" dans les reglages + verification au demarrage (une fois, silencieuse). Jamais d'installation sans clic. Affiche version courante, nouvelle version, notes.
6. Version unique: `tauri.conf.json` = `Cargo.toml`; test qui les compare.
7. Procedure de release documentee dans PLAN: build service, build Tauri signe, `latest.json`, upload release (manuel au debut).

## Risques et choix
- Cle privee: reste chez l'utilisateur (variable d'env ou fichier hors depot), jamais dans le chat ni le depot. Perdue = plus de mise a jour possible pour les installs existantes.
- Pas de signature de code Windows: SmartScreen avertit (comme aujourd'hui pour SC-hauling.exe).
- Le service Python voyage dans l'installeur: une MAJ overlay met aussi le service a jour. Pendant la MAJ, l'app doit couper le service (`kill`) avant l'installeur NSIS (fichier verrouille).
- Premiere installation sur une machine avec ancien dev build: `%APPDATA%\SC-overlay\layouts.json` conserve (hors dossier d'install).
- Depot SC-overlay a creer sur GitHub (public ou prive: un depot prive empeche l'updater de lire les releases sans jeton).

## Corrections apres revue (verifie ou a verifier)
- Donnees du service: `%APPDATA%\SC-hauling` (config.py:40-42), pas a cote de l'exe. Une MAJ NSIS ne les touche pas. Verifie.
- Le service a son propre auto-update qui remplace l'exe (`updater.py:91-96`, `.new/.old`). En sidecar installe il entrerait en conflit avec NSIS: le desactiver quand lance avec `--service` (a lire dans `updater.py`/`__main__.py` avant de coder), l'overlay devient le seul canal de MAJ.
- Console: `sidecar.rs:112-114,137` passe deja `CREATE_NO_WINDOW`. Rien a changer.
- Arret du service avant MAJ: PyInstaller onefile = 2 processus. Tuer l'arbre (`taskkill /T /F /PID`, ou Job Object) juste avant `download_and_install`, puis relancer le service si le telechargement ou l'installation echoue. A verifier dans la doc du plugin: l'installeur NSIS ferme-t-il aussi le sidecar? Dans le doute, l'arbre est tue par l'overlay.
- CSP release: `connect-src` garde `127.0.0.1:*` (service) et le Worker; `frame-src` garde l'origine du site de carte en prod (`versetime.ofs.workers.dev`). Seul 8093 part (vers `devCsp`, cle a confirmer dans le schema local). Test: lancer l'exe installe et verifier la console, pas seulement la dev.
- Cle: variables `TAURI_SIGNING_PRIVATE_KEY` et `..._PASSWORD` (noms a confirmer dans la doc du plugin), mot de passe obligatoire, sauvegarde hors machine, creation d'un `.gitignore` (cle, `target/`, `binaries/`, `node_modules`) AVANT tout premier commit.
- Depot public (choix a faire): `endpoints` = `https://github.com/<user>/SC-overlay/releases/latest/download/latest.json`; `latest` ignore les pre-releases.
- Verif au demarrage: sans reseau ou signature invalide, log seulement, aucune popup. Installation uniquement sur clic.
- Risque antivirus: un exe PyInstaller onefile peut declencher des faux positifs. Garder le sha256 publie; envisager `--onedir` plus tard.

## Fait (etape installeur)
- NSIS currentUser, externalBin, devCsp, .gitignore, scripts/prepare-sidecar.ps1. Build: `powershell -File scriptsprepare-sidecar.ps1` puis `npx @tauri-apps/cli@2 build` dans src-tauri. Installeur de 12.8 Mo.
- Service: mode --service coupe deja ses MAJ (service.py:318). Rien a changer.
- Reste: updater (attend depot + cle), arret de l arbre, bouton reglages.

## Hors perimetre
- Publication, push, creation de depot: seulement sur go explicite.
- Phase 7 (retrait overlay tk), 4c.
