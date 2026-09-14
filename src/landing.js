/* ---------------------------------------------------------------------------
 * Landing : enchaînement de séquences vidéo entrecoupées de contenu.
 *
 *  - une « scène » = un bloc fixe plein écran (.video-stage, canvas + hotspots) et sa piste de scroll
 *    (.video-track, vide, dans le flux). La piste fait --track de haut : le premier écran sert au fondu
 *    entrant, le dernier au fondu sortant, et la séquence se lit de l'apparition à la disparition ;
 *  - les sections de contenu (z-index supérieur, fond opaque) scrollent par-dessus les scènes ;
 *  - chaque scène décode sa vidéo quand sa piste approche et libère la mémoire quand on s'en éloigne ;
 *  - GSAP ScrollTrigger pilote fondu, lecture et apparitions ; Lenis lisse le scroll.
 * ------------------------------------------------------------------------- */

import './landing.css';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { Scrollmation, warmCache } from './scrollmation.js';
import { initHotspots } from './hotspots.js';

// On repart toujours du haut : loader puis première scène. À poser AVANT l'enregistrement du plugin :
// ScrollTrigger mémorise la valeur de scrollRestoration à ce moment-là et la rétablit à chaque refresh().
history.scrollRestoration = 'manual';
scrollTo(0, 0);
gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.clearScrollMemory('manual');

/* ---------- Lenis ↔ ScrollTrigger ---------- */

const lenis = new Lenis({ lerp: 0.1 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(t => lenis.raf(t * 1000));              // un seul rAF : celui de GSAP
gsap.ticker.lagSmoothing(0);
lenis.stop();                                           // pas de scroll tant que le loader est là

/* Ancres du header : via Lenis pour garder le lissage */
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const target = document.querySelector(a.getAttribute('href'));
  if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: 0 }); }
}));

/* Modale des hotspots : scroll figé pendant l'ouverture */
const onModal = open => {
  document.documentElement.classList.toggle('modal-open', open);
  open ? lenis.stop() : lenis.start();
};

/* ---------- Scène vidéo ---------- */

const clamp01 = v => Math.min(1, Math.max(0, v));

class VideoScene {
  constructor(stage) {
    this.stage = stage;
    this.key = stage.dataset.sequence;
    this.canvas = stage.querySelector('canvas');
    this.video = stage.querySelector('video');
    this.track = document.querySelector(`.video-track[data-stage="${stage.id}"]`);
    this.caption = stage.querySelector('.stage-caption');
    this.loaderBar = stage.querySelector('.stage-loader i');
    this.sm = null; this.info = null; this.progress = 0; this.token = null;
    // data-one-way : la séquence ne se lit que vers l'avant. En remontant, l'image reste figée sur la dernière
    // affichée ; si on remonte jusqu'à sortir de la scène (invisible), elle est remise à 0 et rejouée à la descente.
    // Seule l'image est verrouillée : zoom, titre et fondus continuent de suivre le scroll (il se passe toujours quelque chose).
    this.oneWay = stage.hasAttribute('data-one-way');
    this.reached = 0;                                   // progress maximal atteint depuis la dernière apparition (one-way)
    // data-zoom : échelle de l'image à progress 0 (ex. 1.2), ramenée à 1 à progress 1. Suit le scroll brut, pas le
    // progress effectif : en one-way, l'image est figée en remontant mais le zoom continue de bouger
    this.zoom = +stage.dataset.zoom || 1;
    this.scale = this.zoom;
    this.onEvent = () => {};                            // écouté par le loader de page pour la première scène
    initHotspots({
      stage, onModal,
      getState: () => ({ sequence: this.key, progress: this.progress, scale: this.scale, frameCount: this.info?.frameCount ?? 0, width: this.info?.width ?? 0, height: this.info?.height ?? 0 }),
    });
    this.triggers();
  }

  /** Décode la séquence (idempotent). Un canvas ne se transfère qu'une fois : on en recrée un à chaque chargement. */
  async load() {
    if (this.token) return;
    const token = this.token = {};
    const canvas = document.createElement('canvas'); this.canvas.replaceWith(canvas); this.canvas = canvas;
    this.stage.classList.add('loading');
    const sm = await new Scrollmation({ key: this.key, canvas, video: this.video, onEvent: ev => {
      if (this.token !== token) return;
      if (ev.type === 'complete') this.stage.classList.remove('loading');
      if (ev.type === 'error') console.error(`[landing] ${this.key} :`, ev.message);
      this.onEvent(ev);
    } }).init();
    if (this.token !== token) return sm.dispose();      // déchargée entre-temps
    this.sm = sm;
    sm.progress(this.progress);
    // Suivi du décodage (barre de la scène, loader de page, dimensions pour les hotspots) jusqu'à complete
    while (this.token === token) {
      this.info = await sm.getInfo();
      if (!this.info) break;
      this.loaderBar.style.width = `${this.info.frameCount ? 100 * this.info.decoded / this.info.frameCount : 0}%`;
      if (this.info.complete) break;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /** Libère frames, démuxeur et canvas de la scène (retour possible : load() redécode, ~0,5 s en matériel). */
  async unload() {
    const sm = this.sm;
    this.sm = null; this.token = null; this.info = null;
    this.stage.classList.remove('loading');
    await sm?.dispose();
  }

  /** Progress effectivement affiché : identique au scroll, sauf en one-way où il ne peut que croître. */
  effective(p) {
    if (!this.oneWay) return p;
    if (p > this.reached) this.reached = p;
    return this.reached;
  }
  setProgress(p) {
    this.progress = this.effective(p);
    this.sm?.progress(this.progress);
    if (this.zoom !== 1) {                              // zoom le long de la timeline (canvas ou <video> de repli)
      this.scale = this.zoom + (1 - this.zoom) * p;     // p = scroll brut (voir constructeur)
      const t = `scale(${this.scale.toFixed(4)})`;
      this.canvas.style.transform = t; this.video.style.transform = t;
    }
  }
  /** One-way : retour invisible au début (la scène est masquée quand on l'appelle). */
  rewind() { if (this.oneWay) { this.reached = 0; this.progress = 0; this.sm?.progress(0); } }

  triggers() {
    const { track, stage, caption } = this;
    // 1. Zone d'activation : décodage deux écrans avant la piste (marge pour un scroll rapide), libération un écran après
    //    (en remontant, la scène se recharge un écran avant : plus rare, et le décodage matériel est court)
    ScrollTrigger.create({
      trigger: track, start: 'top bottom+=200%', end: 'bottom top-=100%',
      onToggle: self => self.isActive ? this.load() : this.unload(),
    });
    // 2. Visibilité et fondu : de l'entrée de la piste (bas de l'écran) à sa sortie (haut de l'écran)
    const fade = self => {
      const p = self.progress;                          // 0 → 1 sur (piste + un écran) ; 1er écran = fondu entrant, dernier = sortant
      const screen = innerHeight / (track.offsetHeight + innerHeight);
      stage.style.opacity = clamp01(Math.min(p / screen, (1 - p) / screen));
      stage.style.visibility = self.isActive ? 'visible' : 'hidden';
    };
    ScrollTrigger.create({
      trigger: track, start: 'top bottom', end: 'bottom top', onUpdate: fade, onToggle: fade, onRefresh: fade,
      onLeaveBack: () => this.rewind(),                 // remonté au-dessus de la scène : elle repartira du début
    });
    // 3. Lecture : la séquence se joue dès que la scène apparaît et jusqu'à sa disparition (fondus compris),
    //    pour ne jamais montrer une vidéo à l'arrêt. Une piste en haut de page n'a pas de fondu entrant : on part du haut.
    // Le verrou one-way ne concerne que l'image vidéo (et ses hotspots) : titre, zoom, fondus suivent le scroll brut
    const play = self => {
      this.setProgress(self.progress);
      const p = self.progress;
      if (caption) { const k = clamp01((p - .25) / .3); caption.style.opacity = 1 - k; caption.style.transform = `translateY(${-40 * k}px)`; }
    };
    ScrollTrigger.create({
      trigger: track, start: () => track.offsetTop <= innerHeight ? 'top top' : 'top bottom', end: 'bottom top',
      onUpdate: play, onRefresh: play,
    });
  }
}

const scenes = [...document.querySelectorAll('.video-stage')].map(el => new VideoScene(el));

/* ---------- Loader de page : attend la première scène ---------- */

const pageLoader = document.getElementById('page-loader');
const arc = pageLoader.querySelector('.pl-arc');
const percent = pageLoader.querySelector('.pl-percent');
const label = pageLoader.querySelector('.pl-label');
const first = scenes[0];
let done = false;

first.onEvent = ev => {
  if (ev.type === 'cache') label.textContent = ev.hit ? 'décodage…' : 'téléchargement…';
  if (ev.type === 'ready') label.textContent = 'décodage…';
  if (ev.type === 'error') label.textContent = 'erreur : ' + ev.message;
  if (ev.type === 'complete') finish();
};
(function tickLoader() {
  if (done) return;
  const i = first.info;
  const ratio = i?.frameCount ? i.decoded / i.frameCount : 0;
  arc.style.strokeDashoffset = 289 * (1 - ratio);
  percent.textContent = Math.round(ratio * 100);
  requestAnimationFrame(tickLoader);
})();
function finish() {
  if (done) return; done = true;
  warmCache(scenes.slice(1).map(s => s.key), first.video);   // les mp4 suivants en Cache API dès maintenant, hors chemin critique
  arc.style.strokeDashoffset = 0; percent.textContent = '100';
  gsap.timeline({ onComplete: () => { pageLoader.hidden = true; lenis.start(); ScrollTrigger.refresh(); } })
    .to('.pl-inner', { opacity: 0, y: -16, duration: .4, ease: 'power2.in', delay: .2 })
    .to(pageLoader, { opacity: 0, duration: .7, ease: 'power2.inOut' }, '-=.1')
    .from(first.caption.children, { opacity: 0, y: 24, duration: .9, stagger: .12, ease: 'power3.out' }, '-=.4');
}
first.load();                                           // la scène 1 est active dès le haut de page (onToggle la relance sans effet)

/* ---------- Apparition des contenus ---------- */

gsap.utils.toArray('.reveal').forEach((el, i) => {
  gsap.to(el, { opacity: 1, y: 0, duration: .9, ease: 'power3.out', delay: (i % 3) * .08,
    scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
});
