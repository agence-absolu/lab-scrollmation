/* ---------------------------------------------------------------------------
 * Worker de décodage Scrollmation.
 *
 * Tourne dans un thread séparé : aucun accès au DOM. Il reçoit un OffscreenCanvas
 * (transféré, pas copié) et en devient l'unique dessinateur.
 *
 * Pipeline : fetch (Cache API) → flux → mp4box (démux) → VideoDecoder (WebCodecs)
 *            → toutes les VideoFrame gardées en mémoire → drawImage(frames[i]) sur progress(p).
 *
 * Exposé au main thread via comlink : `new Remote(...)`, `.progress()`, `.updateSrc()`…
 * ------------------------------------------------------------------------- */

import * as Comlink from 'comlink';
import { createFile, DataStream } from 'mp4box';

const T0 = performance.now();
/** Trace horodatée (ms depuis le démarrage du worker) — filtrer la console sur « [worker] ». */
const trace = (...args) => console.log(`[worker +${(performance.now() - T0).toFixed(0)}ms]`, ...args);

trace('démarrage — thread séparé, pas de DOM :', typeof document === 'undefined' ? 'document indéfini ✔' : '?');
trace('libs : createFile', typeof createFile, '/ DataStream', typeof DataStream, '/ VideoDecoder', typeof VideoDecoder);

/** Compteurs globaux au worker (toutes instances) : permettent de vérifier qu'une scène remplacée ne retient plus rien. */
const live = { frames: 0, loads: 0 };

/** Adaptateur WritableStream → mp4box : chaque morceau reçu est poussé avec sa position dans le fichier. */
class Mp4Sink {
  constructor(file, onClose) { this.file = file; this.onClose = onClose; this.offset = 0; }
  write(chunk) {
    const buf = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buf).set(chunk);
    buf.fileStart = this.offset;          // exigé par mp4box pour reconstituer le fichier
    this.offset += buf.byteLength;
    this.file.appendBuffer(buf);
  }
  close() { this.file.flush(); this.onClose(); }
}

class RemoteScrollmation {
  /**
   * @param {object} init          { canvas: OffscreenCanvas, id, videoSrc (URL absolue), cacheKey, quiet }
   * @param {boolean} preload      démarrer le chargement immédiatement
   * @param {Function} onEvent     callback main thread (Comlink.proxy) : ({type, ...}) => void
   */
  constructor({ canvas, id, videoSrc, cacheKey, quiet = true }, preload, onEvent) {
    this.id = id;
    this.videoSrc = videoSrc;
    this.cacheKey = cacheKey;
    this.quiet = quiet;
    this.preload = preload;
    this.onEvent = onEvent;
    this.canvasCtx = canvas.getContext('2d');
    this.log('constructeur — OffscreenCanvas reçu par transfert :', canvas instanceof OffscreenCanvas, '| src :', videoSrc, '| preload :', preload);
    this.enabled = false;
    this.loading = false;
    this.complete = false;
    this.frames = [];
    this.decoded = 0;                     // images déjà décodées (progression du chargement)
    this.duration = 0;                    // secondes
    this.fps = 0;                         // images par seconde natives de la source
    this.codec = '';                      // chaîne codec de la piste (ex. avc1.640028)
    this.width = 0; this.height = 0;      // résolution codée
    this.lastProgress = 0;
    this.lastDrawn = -1;
    this.version = 0;                     // incrémenté à chaque reset : invalide les callbacks en vol
    this.load = null;                     // { mp4, decoder, trackId, nbSamples } du chargement en cours (libéré par releaseLoad)
    this.abortController = new AbortController();
    this.t0 = 0;
    if (this.preload) this.loadVideo();
  }

  /* ---------- Réseau : Cache API devant fetch ---------- */

  async fetchThrough(url, init) {
    if (!this.cacheKey) return fetch(url, init);
    const cache = await self.caches?.open(this.cacheKey);
    const hit = await cache?.match(url);
    if (hit) { this.log('Cache API : hit →', url); this.emit({ type: 'cache', hit: true }); return hit; }
    this.log('Cache API : miss → fetch réseau', url);
    const res = await fetch(url, init);
    if (res.ok) cache?.put(url, res.clone());
    this.emit({ type: 'cache', hit: false });
    return res;
  }

  /* ---------- Chargement + décodage ---------- */

  async loadVideo() {
    const version = ++this.version;
    const stale = () => version !== this.version || this.abortController.signal.aborted;
    if (this.complete) return this.emit({ type: 'complete', cached: true });

    this.t0 = performance.now();
    this.loading = true;
    this.log(`loadVideo() version ${version} — début`);
    this.emit({ type: 'start', src: this.videoSrc });

    let received = 0;
    const mp4 = createFile();

    const decoder = new VideoDecoder({
      error: e => this.emit({ type: 'error', message: e.message }),
      output: frame => {
        if (stale()) { frame.close(); return; }
        // Le clone appartient au tableau ; l'original est rendu au décodeur.
        this.frames[received] = frame.clone(); live.frames++;
        frame.close();
        this.decoded = received + 1;
        if (received === 0) { const f0 = this.frames[0]; this.log(`première VideoFrame : ${f0.displayWidth}×${f0.displayHeight} ${f0.format}, ${(f0.allocationSize() / 1048576).toFixed(1)} Mo — file d'attente décodeur : ${decoder.decodeQueueSize}`); }
        else if (received % 30 === 0) this.log(`image ${received}/${this.frames.length - 1} décodée`);
        if (received === 0) this.progress(this.lastProgress);          // première image : on remplace le poster
        else if (this.lastProgress && received === this.frameIndex()) this.progress(this.lastProgress);
        if (received === this.frames.length - 1) {                     // dernière image
          this.complete = true; this.loading = false;
          this.releaseLoad();                                          // démuxeur + décodeur : plus rien à en tirer
          const mb = this.frames.reduce((a, f) => a + f.allocationSize(), 0) / 1048576;
          this.log(`décodage terminé : ${this.frames.length} images en ${(performance.now() - this.t0).toFixed(0)} ms, ${mb.toFixed(0)} Mo conservés en mémoire`);
          this.emit({ type: 'complete', frames: this.frames.length, ms: performance.now() - this.t0 });
        }
        received++;
      },
    });

    mp4.onReady = info => {
      if (stale()) return;
      const track = info.videoTracks?.[0];
      if (!track) return this.emit({ type: 'error', message: 'piste vidéo absente' });
      this.log(`mp4box onReady : piste ${track.codec} ${track.video.width}×${track.video.height}, ${track.nb_samples} samples, timescale ${track.timescale}, durée ${(track.duration / track.timescale).toFixed(2)} s`);
      this.frames = new Array(track.nb_samples);
      this.codec = track.codec; this.width = track.video.width; this.height = track.video.height;
      this.duration = track.duration / track.timescale;                 // secondes (piste entière)
      this.fps = track.nb_samples / this.duration;                      // affiné dès le premier sample (durée exacte d'une image)
      // Description codec (avcC / av1C / hvcC / vpcC) sérialisée sans l'en-tête de box
      const entries = mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries;
      const box = entries.map(e => e.avcC || e.hvcC || e.vpcC || e.av1C).find(Boolean);
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      const config = {
        codec: track.codec.startsWith('vp08') ? 'vp8' : track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description: new Uint8Array(stream.buffer, 8),
        optimizeForLatency: false,
        hardwareAcceleration: 'prefer-software',
      };
      this.log('VideoDecoder.configure', { ...config, description: `${config.description.byteLength} octets (${box.type})` });
      try { decoder.configure(config); }
      catch (e) { return this.emit({ type: 'error', message: e.message }); }
      if (this.load) { this.load.trackId = track.id; this.load.nbSamples = track.nb_samples; }
      this.emit({ type: 'ready', codec: track.codec, width: track.video.width, height: track.video.height, frames: track.nb_samples, duration: this.duration, fps: this.fps });
      mp4.setExtractionOptions(track.id);
      mp4.start();
    };

    mp4.onSamples = async (_id, _user, samples) => {
      if (stale()) return;
      const keys = samples.filter(s => s.is_sync).length;
      if (samples[0]?.duration) this.fps = samples[0].timescale / samples[0].duration;   // ex. 15360 / 512 = 30 img/s
      this.log(`mp4box onSamples : ${samples.length} samples (${keys} keyframes) → EncodedVideoChunk → decode()`);
      for (const s of samples) {
        try {
          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: 1e6 * s.cts / s.timescale,
            duration: 1e6 * s.duration / s.timescale,
            data: s.data,
          }));
        } catch (e) { this.log('décodeur fermé', e); return; }
      }
      // EncodedVideoChunk copie les octets : mp4box peut libérer les siens (sample.data) dès maintenant
      mp4.releaseUsedSamples(_id, samples[samples.length - 1].number + 1);
      try { await decoder.flush(); } catch {}
    };

    mp4.onError = e => this.emit({ type: 'error', message: 'démux : ' + e });

    this.load = { mp4, decoder, trackId: 0, nbSamples: 0 }; live.loads++;   // trackId / nbSamples renseignés dans onReady
    this.abortController.signal.onabort = () => {
      this.loading = false;
      this.log('abort :', this.abortController.signal.reason, '— arrêt du démuxeur et fermeture du décodeur');
      this.releaseLoad();
    };

    // Un abort (reset / disable) rejette fetch et pipeTo avec la raison passée à abort() : ce n'est pas une erreur
    try {
      const res = await this.fetchThrough(this.videoSrc, {
        signal: this.abortController.signal,
        headers: { 'accept-encoding': 'identity;q=0' },   // pas de gzip : on veut les octets bruts en flux
      });
      if (!res.ok) return this.emit({ type: 'error', message: `HTTP ${res.status}` });
      this.log(`réponse HTTP ${res.status}, ${res.headers.get('content-length') ?? '?'} octets — lecture en flux vers mp4box`);
      await res.body.pipeTo(new WritableStream(new Mp4Sink(mp4, () => { this.log('flux terminé → mp4box.flush() + decoder.flush()'); decoder.flush().catch(() => {}); }), { highWaterMark: 2 }));
    } catch (e) {
      if (!stale()) this.emit({ type: 'error', message: e.message ?? String(e) });
    }
  }

  /* ---------- Rendu ---------- */

  frameIndex() { return Math.floor((this.frames.length - 1) * this.lastProgress); }

  progress(p) {
    this.lastProgress = Math.min(1, Math.max(0, p));
    if (!this.frames[this.frameIndex()] || !this.canvasCtx) return;
    requestAnimationFrame(() => {                       // rAF existe aussi dans un worker
      // Relu ici : entre l'appel et le rAF, un updateSrc()/dispose() a pu fermer la frame (drawImage lèverait)
      const f = this.frames[this.frameIndex()];
      if (!f || !this.canvasCtx) return;
      const c = this.canvasCtx.canvas;
      if (c.width !== f.displayWidth || c.height !== f.displayHeight) { c.width = f.displayWidth; c.height = f.displayHeight; }
      this.canvasCtx.clearRect(0, 0, c.width, c.height);
      this.canvasCtx.drawImage(f, 0, 0, c.width, c.height);
      const i = this.frameIndex();
      if (i !== this.lastDrawn) { this.log(`progress ${this.lastProgress.toFixed(3)} → drawImage(frames[${i}])`); this.lastDrawn = i; }
      this.emit({ type: 'frame', index: i, progress: this.lastProgress });
    });
  }

  /* ---------- Cycle de vie ---------- */

  reset() { this.log('reset()'); this.version++; this.abortController.abort('reset'); this.abortController = new AbortController(); }
  enable() {
    this.log('enable()', this.loading ? '— chargement déjà en cours, on le laisse finir' : '');
    if (this.enabled) return;
    this.enabled = true;
    if (this.preload && !this.complete && !this.loading) { this.reset(); this.loadVideo(); }
  }
  disable() { this.log('disable()'); if (this.enabled) { this.enabled = false; this.version++; this.abortController.abort('disable'); } }
  updateSrc(src) {
    if (src === this.videoSrc) return;
    this.log('updateSrc() :', this.videoSrc, '→', src, '— libération des frames et rechargement');
    this.videoSrc = src;
    this.reset();                         // d'abord couper le chargement en vol (plus aucune frame ne sortira du décodeur)…
    this.disposeFrames();                 // …puis fermer celles déjà en mémoire
    this.complete = false; this.lastDrawn = -1; this.decoded = 0;
    this.duration = 0; this.fps = 0; this.codec = ''; this.width = 0; this.height = 0;
    if (this.preload) this.loadVideo();
  }
  /**
   * Libère ce que le pipeline de chargement retient hors des VideoFrame : mp4box garde en mémoire
   * les buffers reçus et une copie des samples (≈ 2× le fichier encodé) tant que l'objet est référencé.
   */
  releaseLoad() {
    const l = this.load;
    if (!l) return;
    this.load = null; live.loads--;
    const { mp4, decoder, trackId, nbSamples } = l;
    mp4.onSamples = null; mp4.onReady = null; mp4.onError = null;
    try { mp4.stop(); } catch {}
    if (trackId) { try { mp4.releaseUsedSamples(trackId, nbSamples); } catch {} }
    try { decoder.close(); } catch {}
    this.abortController.signal.onabort = null;        // la fermeture référençait mp4 et decoder
    this.log('releaseLoad() : démuxeur arrêté, samples libérés, décodeur fermé');
  }
  disposeFrames() {
    const n = this.frames.filter(Boolean).length;
    if (n) this.log(`disposeFrames() : ${n} VideoFrame fermées`);
    this.frames.forEach(f => { if (f) { f.close(); live.frames--; } }); this.frames = [];
  }
  /** Fin de vie : plus aucune ressource retenue côté worker (frames, démuxeur, canvas, callback main thread). */
  dispose() {
    this.log('dispose()');
    this.disable();                       // abort → releaseLoad()
    this.releaseLoad();                   // au cas où le chargement était terminé (onabort déjà détaché)
    this.disposeFrames();
    if (this.canvasCtx) {                 // libère le backing store de l'OffscreenCanvas (le main thread en recrée un neuf)
      const c = this.canvasCtx.canvas;
      c.width = 0; c.height = 0;
      this.canvasCtx = null;
    }
    this.onEvent?.[Comlink.releaseProxy]?.();          // ferme le MessagePort du callback (sinon le main thread garde la closure)
    this.onEvent = null;
  }

  /* ---------- Diagnostic ---------- */

  getInfo() {
    return {
      id: this.id, src: this.videoSrc, complete: this.complete,
      frameCount: this.frames.length, decoded: this.decoded, frameIndex: this.frameIndex(), progress: this.lastProgress,
      duration: this.duration, fps: this.fps, codec: this.codec, width: this.width, height: this.height,
      memoryBytes: this.frames.reduce((a, f) => a + (f ? f.allocationSize() : 0), 0),
      liveFrames: live.frames, liveLoads: live.loads,   // toutes instances du worker confondues
    };
  }
  emit(ev) { this.onEvent?.({ id: this.id, ...ev }); }
  log(...args) { if (!this.quiet) trace(`[${this.id}]`, ...args); }
}

Comlink.expose(RemoteScrollmation);
trace('RemoteScrollmation exposée via Comlink — en attente du main thread');
