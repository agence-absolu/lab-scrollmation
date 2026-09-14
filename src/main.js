/* Démo Scrollmation : scroll (lissé par Lenis) → Scrollmation, panneau de contrôle lil-gui alimenté par le worker. */

import './style.css';
import 'lenis/dist/lenis.css';
import GUI from 'lil-gui';
import Lenis from 'lenis';
import { Scrollmation, hasWebCodecs } from './scrollmation.js';
import { Sequences, Codecs } from './sequences.js';
import { initPointage } from './pointage.js';
import { initHotspots } from './hotspots.js';

const bar = document.getElementById('bar');
/* Menu : marque la page courante */
document.querySelector(`#menu a[data-sequence="${document.body.dataset.sequence}"]`)?.classList.add('active');

/* ---------- Loader ---------- */

const loader = document.getElementById('loader');
const loaderLabel = loader.querySelector('.label');
const loaderBar = loader.querySelector('.pbar i');
function showLoader(text, ratio = 0, error = false) {
  loaderLabel.textContent = text;
  loaderBar.style.width = `${Math.round(ratio * 100)}%`;
  loader.classList.toggle('error', error);
  loader.classList.add('visible');
}
const hideLoader = () => loader.classList.remove('visible');

/* Sources forçables pour une séquence : 'auto' + chaque variante déclarée dans sequences.js */
function sourcesOf(key) {
  const out = { 'auto (media query + codec)': '' };
  for (const { src, type } of Sequences[key].videos) {
    out[`${type === Codecs.AV1 ? 'AV1' : 'H.264'} ${src.split('/').pop()}`] = src;
  }
  return out;
}

/* État observé par lil-gui (les contrôleurs en .listen() se rafraîchissent tout seuls) */
const ui = {
  // commandes
  sequence: document.body.dataset.sequence || 'pano-mountain',   // séquence de la page (<body data-sequence>) ; voir sequences.js
  renderType: hasWebCodecs ? 'video-decoder' : 'html5-video',
  source: '',
  progress: 0,
  fullscreen: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  // lecture seule
  viewport: '',
  layout: '',
  worker: '',
  src: '',
  codec: '',
  duration: '',
  frame: '',
  memory: '',
  status: 'init',
  cache: '',
};
let sm = null;
let lastInfo = null;                                    // dernier getInfo() du worker (frameCount, résolution…)

/* ---------- Scrollmation ---------- */

/* Les (re)démarrages sont sérialisés : deux boot() concurrents créeraient deux instances dont une jamais
   disposée (frames jamais fermées dans le worker). */
let booting = Promise.resolve();
let generation = 0;
function boot() { return booting = booting.then(doBoot); }

async function doBoot() {
  const gen = ++generation;
  await sm?.dispose(); sm = null; lastInfo = null;      // ferme frames, démuxeur, canvas et ports comlink de la scène précédente
  ui.frame = ''; ui.memory = ''; ui.codec = ''; ui.duration = ''; ui.src = '';
  // Un canvas ne peut être transféré qu'une fois : on en recrée un neuf à chaque (re)démarrage
  const canvas = document.createElement('canvas'); canvas.id = 'canvas';
  document.getElementById('canvas').replaceWith(canvas);
  ui.status = 'démarrage…'; ui.cache = ''; showLoader('chargement…');
  ui.layout = `${Sequences[ui.sequence].layout} (${Sequences[ui.sequence].videos.length} variante${Sequences[ui.sequence].videos.length > 1 ? 's' : ''})`;

  sm = await new Scrollmation({
    key: ui.sequence,
    canvas,
    video: document.getElementById('video'),
    renderType: ui.renderType,
    onEvent: ev => {                                    // événements émis par le worker (via Comlink.proxy)
      if (gen !== generation) return;                   // événement en vol d'une scène déjà remplacée
      ui.renderType = ev.renderType;
      ui.worker = ev.renderType === 'video-decoder' ? 'oui (OffscreenCanvas + comlink)' : 'non';
      if (ev.type === 'start')    { ui.status = 'chargement…'; showLoader('chargement…'); }   // aussi émis par updateSrc()
      if (ev.type === 'cache')    ui.cache = ev.hit ? 'hit' : 'miss → réseau';
      if (ev.type === 'ready')    { ui.status = `${ev.codec} ${ev.width}×${ev.height} — décodage…`; showLoader(`décodage… 0 / ${ev.frames}`); }
      if (ev.type === 'complete') { ui.status = ev.duration ? `video prêt — ${ev.duration.toFixed(2)} s en ${ev.ms.toFixed(0)} ms`
                                                            : `prêt — ${ev.frames} images en ${ev.ms.toFixed(0)} ms`; hideLoader(); }
      if (ev.type === 'error')    { ui.status = 'erreur : ' + ev.message; showLoader('erreur : ' + ev.message, 0, true); }
      refresh();
    },
  }).init();
  if (ui.source) sm.setSource(ui.source);
  sm.progress(ui.progress);                             // position de scroll courante (pas d'événement scroll si la page n'a pas bougé)
  refresh();
}

/* ---------- Scroll → progress ---------- */

/* progress ∈ [0,1] = position de scroll normalisée sur la hauteur de #track.
   Lenis interpole le scroll natif (scrollTop) image par image : l'événement scroll du window reste donc
   la source unique de vérité, avec ou sans smooth scroll. */
const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
function readScroll() {
  ui.progress = Math.min(1, Math.max(0, scrollY / maxScroll()));
  bar.style.width = (ui.progress * 100) + '%';
  sm?.progress(ui.progress);
}
window.addEventListener('scroll', readScroll, { passive: true });
readScroll();                                           // position restaurée par le navigateur au rechargement : pas d'événement scroll

/* Lenis : smooth scroll. lerp = part du chemin parcourue à chaque frame (0.1 ≈ 60 fps → ~0,5 s pour s'arrêter). */
const smooth = { enabled: true, lerp: 0.1, wheelMultiplier: 1 };
let lenis = null;
function startLenis() {
  lenis?.destroy(); lenis = null;
  if (!smooth.enabled) return;
  lenis = new Lenis({ lerp: smooth.lerp, wheelMultiplier: smooth.wheelMultiplier, autoRaf: true });
}
/* Déplacement programmatique (slider) : via Lenis quand il est actif, sinon scroll natif */
const goTo = (y, immediate = false) => lenis ? lenis.scrollTo(y, { immediate }) : scrollTo(0, y);
startLenis();

let pending = false;
async function refresh() {
  if (pending || !sm) return; pending = true;
  let i;
  // Aller-retour comlink (async), borné : une réponse perdue (port fermé pendant un redémarrage) ne doit pas
  // laisser `pending` levé, sinon plus aucun rafraîchissement
  try { i = await Promise.race([sm.getInfo(), new Promise(r => setTimeout(r, 1000, null))]); }
  finally { pending = false; }
  if (!i || !sm) return;
  lastInfo = i;
  ui.src = i.src ? i.src.replace(document.baseURI, '') : '-';
  ui.viewport = `${innerWidth}×${innerHeight} ${innerWidth >= innerHeight ? 'paysage' : 'portrait'} → ${sm.matchedBreakpoint()}`;
  ui.codec = i.width ? `${i.codec || 'inconnu (<video>)'} — ${i.width}×${i.height}` : '-';
  ui.duration = i.duration ? `${i.duration.toFixed(2)} s — ${i.fps ? i.fps.toFixed(2) + ' img/s natives' : 'fps inconnu (<video>)'}` : '-';
  ui.frame = `${i.frameIndex} / ${Math.max(0, i.frameCount - 1)}`;
  // Progression du décodage. L'événement complete et cette réponse arrivent par deux ports différents :
  // on re-cache ici aussi, au cas où une réponse partie avant la fin arriverait après l'événement.
  if (i.complete) hideLoader();
  else if (i.frameCount && !loader.classList.contains('error')) showLoader(`décodage… ${i.decoded} / ${i.frameCount}`, i.decoded / i.frameCount);
  // liveFrames / liveLoads : compteurs globaux du worker → doivent retomber à ceux de la scène courante après un changement
  ui.memory = `${(i.memoryBytes / 1048576).toFixed(0)} Mo de VideoFrame — worker : ${i.liveFrames} frames, ${i.liveLoads} démux`;
}

/* ---------- Panneau lil-gui ---------- */

const gui = new GUI({ title: 'Scrollmation', width: 340 }).close();   // replié par défaut, la barre de titre reste cliquable

const ctrl = gui.addFolder('Commandes');
ctrl.add(ui, 'sequence', Object.keys(Sequences)).name('séquence').onChange(key => {
  ui.source = '';
  // lil-gui : options() détruit le contrôleur et en renvoie un nouveau → on le remplace et on rebranche onChange
  srcCtrl = srcCtrl.options(sourcesOf(key)).onChange(onSourceChange);
  boot().then(() => { pointage.onSequenceChange(); hotspots.onSequenceChange(); });
});
ctrl.add(ui, 'renderType', ['video-decoder', 'html5-video']).name('rendu').onChange(boot);
const onSourceChange = v => v ? sm.setSource(v) : boot();
let srcCtrl = ctrl.add(ui, 'source', sourcesOf(ui.sequence)).name('source').onChange(onSourceChange);
ctrl.add(ui, 'progress', 0, 1, 0.001).name('progress').listen()
    .onChange(p => goTo(p * maxScroll()));             // le slider pilote le scroll, et inversement
ctrl.add(ui, 'fullscreen').name('plein écran ⛶');

const lenisFolder = gui.addFolder('Lenis (smooth scroll)');
lenisFolder.add(smooth, 'enabled').name('actif').onChange(startLenis);
lenisFolder.add(smooth, 'lerp', 0.02, 0.5, 0.01).name('lerp (inertie)').onChange(v => { if (lenis) lenis.options.lerp = v; });
lenisFolder.add(smooth, 'wheelMultiplier', 0.25, 3, 0.05).name('vitesse molette').onChange(v => { if (lenis) lenis.options.wheelMultiplier = v; });

const state = gui.addFolder('État (worker)');
state.add(ui, 'viewport').name('viewport').listen().disable();
state.add(ui, 'layout').name('gabarit').listen().disable();
state.add(ui, 'worker').name('worker').listen().disable();
state.add(ui, 'src').name('fichier').listen().disable();
state.add(ui, 'codec').name('codec / résolution').listen().disable();
state.add(ui, 'duration').name('durée / fps').listen().disable();
state.add(ui, 'frame').name('image').listen().disable();
state.add(ui, 'memory').name('mémoire').listen().disable();
state.add(ui, 'status').name('état').listen().disable();
state.add(ui, 'cache').name('Cache API').listen().disable();

/* ---------- Hotspots + outil de pointage ---------- */

const stage = document.getElementById('stage');
/* État partagé : progress courant et dimensions de la séquence (pour convertir repère vidéo → écran) */
const getState = () => ({ sequence: ui.sequence, progress: ui.progress, frameCount: lastInfo?.frameCount ?? 0, width: lastInfo?.width ?? 0, height: lastInfo?.height ?? 0 });

/* Boutons trackés sur la vidéo + modale (voir hotspots.js) */
const hotspots = initHotspots({
  stage, getState,
  onModal: open => {                                    // modale ouverte : on fige le scroll (Lenis et natif)
    document.documentElement.classList.toggle('modal-open', open);
    open ? lenis?.stop() : lenis?.start();
  },
});

/* Outil de pointage : capture d'une trajectoire dans le repère vidéo (voir pointage.js) */
const pointage = initPointage({
  gui, stage, getState,
  goTo: p => { goTo(p * maxScroll(), true); readScroll(); },   // immédiat : on resynchronise sans attendre l'événement scroll
});

setInterval(refresh, 250);                            // rafraîchit image / mémoire pendant le scroll
boot();
