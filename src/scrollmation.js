/* ---------------------------------------------------------------------------
 * Scrollmation — contrôleur main thread.
 *
 *  - choisit le mode de rendu : 'video-decoder' (worker + WebCodecs + OffscreenCanvas)
 *    ou 'html5-video' (repli <video>.currentTime) ;
 *  - choisit la variante de source selon les media queries et le codec (canPlayType) ;
 *  - crée UN worker partagé, l'enrobe avec comlink, lui transfère le canvas ;
 *  - relaie progress(p) au worker (un simple nombre traverse la frontière).
 *
 * Le décodage vit dans worker.js ; ce fichier ne touche jamais à mp4box ni à VideoDecoder.
 * ------------------------------------------------------------------------- */

import * as Comlink from 'comlink';
import { Sequences } from './sequences.js';

export const hasWebCodecs = typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function';
const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- Worker partagé (un seul pour toute la page) ---------- */

let sharedWorker = null;
let RemoteScrollmation = null;

function getRemoteClass() {
  if (!RemoteScrollmation) {
    sharedWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });   // bundlé par Vite
    RemoteScrollmation = Comlink.wrap(sharedWorker);   // la classe exposée devient un constructeur distant
  }
  return RemoteScrollmation;
}

/** Les URL relatives du worker se résolvent contre le script du worker : on absolutise ici, côté page. */
const absolute = src => new URL(src, document.baseURI).href;

/* ---------- Repli <video>.currentTime ---------- */

class HtmlVideoScrollmation {
  constructor({ id, video, videoSrc, preload }, onEvent) {
    this.id = id; this.video = video; this.videoSrc = videoSrc; this.onEvent = onEvent;
    this.lastProgress = 0; this.enabled = false; this.preload = preload;
    this.abortController = null;          // fetch en cours
    this.objectUrl = '';                  // blob: courant, révoqué au remplacement / dispose
    if (preload) this.loadVideo();
  }
  async loadVideo() {
    const t0 = performance.now();
    this.abortController?.abort('reload');
    const ac = this.abortController = new AbortController();
    this.onEvent({ id: this.id, type: 'start', src: this.videoSrc });
    // Desktop : on télécharge tout en Blob pour que les seeks soient locaux et instantanés
    let blob;
    try { blob = await (await fetch(this.videoSrc, { signal: ac.signal })).blob(); }
    catch (e) { if (!ac.signal.aborted) this.onEvent({ id: this.id, type: 'error', message: e.message }); return; }   // abort = pas une erreur
    if (ac.signal.aborted) return;
    this.releaseMedia();                  // l'ancien blob: est révoqué seulement une fois le nouveau prêt
    this.objectUrl = URL.createObjectURL(blob);
    this.video.src = this.objectUrl;
    this.video.onloadedmetadata = () => {
      this.video.onloadedmetadata = null;
      this.progress(this.lastProgress);
      this.onEvent({ id: this.id, type: 'complete', frames: this.frameCount(), ms: performance.now() - t0, duration: this.video.duration });
    };
    this.video.pause(); this.video.load();
  }
  frameCount() { return Math.round((this.video.duration || 0) * 30); }   // approximation : un <video> n'expose pas sa cadence
  progress(p) {
    this.lastProgress = Math.min(1, Math.max(0, p));
    if (!(this.video.duration > 0)) return;
    requestAnimationFrame(() => {
      if (!(this.video.duration > 0)) return;           // src retiré entre-temps (dispose)
      this.video.currentTime = this.video.duration * this.lastProgress;
      this.onEvent({ id: this.id, type: 'frame', index: Math.min(this.frameCount() - 1, Math.round(this.video.currentTime * 30)), progress: this.lastProgress });
    });
  }
  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  updateSrc(src) { if (src !== this.videoSrc) { this.videoSrc = src; this.loadVideo(); } }
  getInfo() { return { id: this.id, src: this.videoSrc, complete: this.video.duration > 0, frameCount: this.frameCount(), decoded: this.video.duration > 0 ? this.frameCount() : 0, frameIndex: Math.min(this.frameCount() - 1, Math.round(this.video.currentTime * 30)), progress: this.lastProgress, duration: this.video.duration || 0, fps: 0, codec: '', width: this.video.videoWidth, height: this.video.videoHeight, memoryBytes: 0, liveFrames: 0, liveLoads: 0 }; }
  /** Révoque le blob: courant : tant qu'il existe, le Blob (le mp4 entier) reste en mémoire. */
  releaseMedia() {
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = ''; }
  }
  dispose() {
    this.abortController?.abort('dispose');
    this.video.onloadedmetadata = null;
    this.releaseMedia();
    // removeAttribute ne suffit pas : c'est load() sans src qui fait relâcher la ressource média décodée
    this.video.removeAttribute('src'); this.video.load();
  }
}

/* ---------- Contrôleur ---------- */

export class Scrollmation {
  /**
   * @param {object} o
   * @param {string} o.key                  clé dans Sequences
   * @param {HTMLCanvasElement} o.canvas    canvas visible (sera transféré au worker)
   * @param {HTMLVideoElement} o.video      <video> du mode de repli
   * @param {'video-decoder'|'html5-video'} [o.renderType]  forcé ; sinon décidé automatiquement
   * @param {(ev: object) => void} [o.onEvent]
   */
  constructor({ key, canvas, video, renderType, onEvent = () => {} }) {
    this.key = key; this.canvas = canvas; this.video = video; this.onEvent = onEvent;
    this.renderType = renderType ?? (hasWebCodecs && !isAppleMobile ? 'video-decoder' : 'html5-video');
    this.remote = null;
    this.cacheKey = 'scrollmation-v1';
    this.mediaQueries = [];
  }

  /** Première variante dont le codec est lisible « probably » ET dont la media query correspond. */
  pickSource() {
    const playable = Sequences[this.key].videos.filter(({ type }) => this.video.canPlayType(type) === 'probably');
    let found = playable.find(({ media }) => !media || matchMedia(media).matches);
    let how = this.matchedBreakpoint();
    if (!found && playable.length) {
      // Aucune media query ne correspond (trou entre deux breakpoints) : largeur d'encodage la plus proche du viewport
      const width = src => +(src.match(/(\d+)\D*\.mp4$/)?.[1] ?? 0);
      const codec = playable[0].type;
      found = playable.filter(v => v.type === codec).sort((a, b) => Math.abs(width(a.src) - innerWidth) - Math.abs(width(b.src) - innerWidth))[0];
      how = 'aucun breakpoint → repli largeur la plus proche';
    }
    console.log(`[scrollmation] ${this.key} : viewport ${innerWidth}×${innerHeight} → ${how} → ${found?.src ?? 'AUCUNE SOURCE'}`);
    return found ? absolute(found.src) : '';
  }

  /** Media query courante parmi celles déclarées par la séquence (diagnostic). */
  matchedBreakpoint() {
    const v = Sequences[this.key].videos.find(({ media }) => media && matchMedia(media).matches);
    if (v) return v.media;
    return Sequences[this.key].videos.some(({ media }) => media) ? 'aucun breakpoint' : 'variante unique';
  }

  async init() {
    const videoSrc = this.pickSource();
    const onEvent = Comlink.proxy(ev => this.onEvent({ renderType: this.renderType, ...ev }));  // le worker rappelle le main thread

    if (this.renderType === 'video-decoder') {
      const Remote = getRemoteClass();
      const offscreen = this.canvas.transferControlToOffscreen();      // après ça, le main thread ne peut plus dessiner
      this.remote = await new Remote(
        Comlink.transfer({ canvas: offscreen, id: this.key, videoSrc, cacheKey: this.cacheKey, quiet: false }, [offscreen]),   // quiet: true pour couper les logs du worker
        true,        // preload
        onEvent,
      );
      this.canvas.hidden = false; this.video.hidden = true;
    } else {
      this.remote = new HtmlVideoScrollmation({ id: this.key, video: this.video, videoSrc, preload: true }, onEvent);
      this.canvas.hidden = true; this.video.hidden = false;
    }
    await this.remote.enable();

    // Changement de media query (rotation, redimensionnement) → nouvelle variante → nouveau décodage
    const onChange = () => { const s = this.pickSource(); if (s) this.remote.updateSrc(s); };
    for (const { media } of Sequences[this.key].videos) {
      if (!media) continue;
      const mq = matchMedia(media); mq.addEventListener('change', onChange); this.mediaQueries.push([mq, onChange]);
    }
    return this;
  }

  /** progress ∈ [0,1] — c'est tout ce qui traverse la frontière main thread → worker. */
  progress(p) { this.remote?.progress(p); }

  /** Force une variante précise, en court-circuitant la sélection automatique. */
  setSource(src) { this.remote?.updateSrc(absolute(src)); }

  getInfo() { return this.remote ? this.remote.getInfo() : Promise.resolve(null); }

  /**
   * Libère tout ce que cette instance retient : frames et pipeline côté worker (remote.dispose),
   * MessagePort comlink de l'instance distante, media queries, callback d'événements.
   */
  async dispose() {
    for (const [mq, fn] of this.mediaQueries) mq.removeEventListener('change', fn);
    this.mediaQueries = [];
    // On décroche le proxy avant d'attendre : un getInfo() parti pendant le dispose distant n'aurait jamais
    // de réponse (port fermé par releaseProxy) et bloquerait l'appelant.
    const remote = this.remote; this.remote = null;
    await remote?.dispose?.();
    remote?.[Comlink.releaseProxy]?.();                 // libère l'instance RemoteScrollmation dans le worker
    this.onEvent = () => {};                            // un événement en vol ne doit plus toucher l'appelant
  }
}
