# Scrollmation

Vidéo pilotée par le scroll, sans saccade : la séquence est **décodée une seule fois** dans un
Web Worker (WebCodecs), chaque image est conservée en mémoire, et le scroll ne fait qu'indexer
ce tableau d'images sur un `OffscreenCanvas`. Aucun seek, aucun décodage pendant le scroll.

Démo du lab Absolu, publiée sur **https://lab.agence-absolu.com/scrollmation/**.

## Fonctionnement

```
main thread                                     worker (src/worker.js)
──────────────────────────────────              ────────────────────────────────────────
src/main.js      lil-gui, Lenis (smooth scroll)  class RemoteScrollmation
src/sequences.js variantes {src, media, type}      fetchThrough()  Cache API → fetch
src/scrollmation.js                                loadVideo()     flux → mp4box → VideoDecoder
  pickSource()  canPlayType + matchMedia           frames[]        VideoFrame clonées (toutes)
  new Worker() ─────────── Comlink.wrap ──▶        canvasCtx       OffscreenCanvas 2d
  canvas.transferControlToOffscreen() ─transfer─▶
  progress(p) ──────── message (1 nombre) ─▶       progress(p)     rAF → drawImage(frames[i])
  onEvent ◀──────── Comlink.proxy(callback) ──     emit()          start/cache/ready/complete/frame/error
  HtmlVideoScrollmation (repli <video>.currentTime)
```

- **Décodage** : `fetch` en flux (réponse mise en Cache API) → démuxage mp4box → `VideoDecoder`
  (`prefer-software`) → chaque `VideoFrame` est clonée et gardée ; l'original est rendu au décodeur.
- **Rendu** : `progress ∈ [0,1]` → `i = floor((N-1) × progress)` → `drawImage(frames[i])`, dans le
  worker, sur le canvas transféré. Le main thread n'envoie qu'un nombre.
- **Repli** : sans WebCodecs (ou sur Apple mobile), `<video>.currentTime = durée × progress`.
- **Sources** : chaque séquence peut déclarer plusieurs variantes (largeur, codec) avec une media
  query ; la première lisible (`canPlayType`) et correspondante (`matchMedia`) est chargée.
- **Coût** : la mémoire est proportionnelle à la durée — ~1,6 Mo par image en 1440 (I420), soit
  ~660 Mo pour 7 s à 60 fps. La technique se prête aux plans courts (1 à 10 s).

Le panneau lil-gui montre l'état du worker (codec, résolution, durée, cadence native, image
courante, mémoire, Cache API) ; la console trace chaque étape (`[worker +Nms]`).

## Ajouter une vidéo

1. Encoder en H.264 (ou AV1), `moov` en tête, sans audio, GOP court si le repli `<video>` compte :
   ```bash
   ffmpeg -i source.mp4 -vf "scale=1440:-2" -c:v libx264 -profile:v high -g 4 -crf 18 \
     -pix_fmt yuv420p -an -movflags +faststart public/videos/ma-video/ma-video-1440.mp4
   ```
2. Déclarer la séquence dans `src/sequences.js` :
   ```js
   'ma-video': { layout: 'Fullscreen', videos: [
     { src: 'videos/ma-video/ma-video-1440.mp4', media: null, type: Codecs.H264 },
   ] },
   ```

## Développement

```bash
npm install
npm run dev       # http://localhost:5173/scrollmation/
npm run build     # compile dans dist/
npm run preview   # prévisualise dist/ sur le même sous-chemin
```

Le site est servi depuis un sous-répertoire du lab : `vite.config.js` déduit la
base des chemins du nom npm (`scrollmation`). `BASE_PATH=/ npm run build` pour une
racine de domaine.

## Publication

`.github/workflows/deploy.yml` compile et envoie `dist/` par rsync sur SSH dans
`lab.agence-absolu.com/lab-projects/scrollmation/` à chaque push sur `main` — ou à
la demande, onglet Actions. Le hub sert ce dossier sur `/scrollmation/` sans
aucune configuration de son côté.

### 1. Le dépôt

```bash
gh repo create agence-absolu/lab-scrollmation --public --source=. --push
```

**Public, obligatoirement** : les secrets SSH sont définis au niveau de
l'organisation `agence-absolu`, et GitHub ne les partage qu'avec les dépôts
publics (limite du plan gratuit). Un dépôt privé verrait son workflow échouer
faute de secrets.

### 2. Les secrets

Rien à créer dans le dépôt : le workflow lit ceux de l'organisation
(Settings de l'organisation › Secrets and variables › Actions).

| Secret | Contenu |
| --- | --- |
| `LAB_SSH_HOST` | hôte SSH Infomaniak (`…ssh.hosting-ik.com`) |
| `LAB_SSH_USER` | compte SSH |
| `LAB_SSH_PASSWORD` | mot de passe |
| `LAB_SSH_KNOWN_HOSTS` | facultatif — sortie de `ssh-keyscan <hôte>`, pour épingler l'empreinte du serveur |

Sans le dernier, le workflow relève l'empreinte du serveur au premier contact
et la croit sur parole. Un secret de dépôt du même nom, s'il en existe un,
prime sur celui de l'organisation.

Pourquoi un mot de passe et pas une clé : chez Infomaniak, l'authentification
par clé n'est pas disponible sur un site Node.js et le port FTP est filtré.

### 3. Pousser

Premier push sur `main` : le workflow compile, envoie, et la démo apparaît sur
la page d'accueil du lab.

## Règles du hub

- le slug (`"name"` de `package.json`) est en minuscules : lettres, chiffres,
  tirets ;
- `index.html` est revalidé à chaque visite, le reste est mis en cache un an —
  les bundles portent une empreinte dans leur nom (Vite le fait) ;
- une URL sans extension qui ne correspond à aucun fichier retombe sur
  `index.html` (routage côté client).
