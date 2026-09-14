/* ---------------------------------------------------------------------------
 * Outil de pointage : capture les trajectoires des hotspots d'une séquence, clic par clic.
 *
 * Une trajectoire (nommée, ex. « pic-du-midi ») = liste de { frame, x, y } — x/y normalisés (0–1) dans
 * le repère de la VIDÉO (pas de l'écran) : on inverse le recadrage `object-fit: cover` du canvas.
 * Plusieurs trajectoires par séquence ; toutes sont affichées en overlay, celle en cours d'édition en
 * orange. Conservées dans localStorage (par séquence) et exportables en JSON prêt pour hotspots.js.
 *
 * Clavier (outil actif) : ← / → image par image, Maj + ← / → par 10 images, Retour arrière = retire le dernier point.
 * ------------------------------------------------------------------------- */

import { coverRect } from './cover.js';
import { Hotspots } from './hotspots.js';

/**
 * @param {object} o
 * @param {import('lil-gui').GUI} o.gui
 * @param {HTMLElement} o.stage            conteneur plein écran du canvas / de la <video>
 * @param {() => {sequence: string, progress: number, frameCount: number, width: number, height: number}} o.getState
 * @param {(progress: number) => void} o.goTo   déplace le scroll (immédiat) vers une position normalisée
 */
export function initPointage({ gui, stage, getState, goTo }) {
  const layer = document.createElement('div'); layer.id = 'markers'; stage.append(layer);
  const storageKey = () => `scrollmation-pointage-${getState().sequence}`;

  const st = { enabled: false, name: '', newName: '', count: '0 point', last: '-' };
  let tracks = {};                                    // { nom: [{ frame, x, y }] } de la séquence courante, triés par frame
  let raf = 0;
  const points = () => (tracks[st.name] ??= []);      // trajectoire en cours d'édition

  /** Ids connus pour la séquence : hotspots déclarés dans hotspots.js + trajectoires déjà pointées (localStorage). */
  const knownIds = () => [...new Set([...(Hotspots[getState().sequence] ?? []).map(h => h.id), ...Object.keys(tracks).filter(n => tracks[n].length), st.name].filter(Boolean))];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey()) || '{}');
      tracks = Array.isArray(raw) ? { [st.name || 'sans-nom']: raw } : raw;   // ancien format : une seule trajectoire anonyme
    } catch { tracks = {}; }
    if (!tracks[st.name]?.length) st.name = knownIds()[0] ?? 'sans-nom';   // par défaut : premier id de la séquence
    refreshPick(); update();
  }
  const save = () => { try { localStorage.setItem(storageKey(), JSON.stringify(tracks)); } catch {} };
  const currentFrame = () => { const { progress, frameCount } = getState(); return Math.floor((frameCount - 1) * progress); };   // même formule que le worker

  /** JSON lisible, une keyframe par ligne : à coller dans Hotspots[sequence] (hotspots.js). */
  function toJSON() {
    const names = Object.keys(tracks).filter(n => tracks[n].length);
    const block = n => `  { "id": "${n}", "keyframes": [\n${tracks[n].map(p => `    { "frame": ${p.frame}, "x": ${p.x}, "y": ${p.y} }`).join(',\n')}\n  ] }`;
    return `{ "sequence": "${getState().sequence}", "hotspots": [\n${names.map(block).join(',\n')}\n] }`;
  }
  function update() {
    const pts = points();
    const others = Object.keys(tracks).filter(n => n !== st.name && tracks[n].length);
    st.count = `${pts.length} point${pts.length > 1 ? 's' : ''}` + (others.length ? ` (+ ${others.join(', ')})` : '');
    const p = pts[pts.length - 1];
    st.last = p ? `image ${p.frame} → x ${p.x.toFixed(3)}, y ${p.y.toFixed(3)}` : '-';
    render();
  }

  /* ---------- Capture ---------- */

  function onClick(e) {
    if (!st.enabled || e.target.closest('.hotspot')) return;   // un clic sur un hotspot ouvre sa modale, ce n'est pas un pointage
    const { frameCount, width, height } = getState();
    if (!frameCount || !width) return;                  // séquence pas encore prête
    const r = coverRect(stage.getBoundingClientRect(), width, height);
    const x = Math.min(1, Math.max(0, (e.clientX - r.x) / r.w));
    const y = Math.min(1, Math.max(0, (e.clientY - r.y) / r.h));
    const frame = currentFrame();
    const pts = points().filter(p => p.frame !== frame);      // un seul point par image : le dernier clic remplace
    pts.push({ frame, x: +x.toFixed(4), y: +y.toFixed(4) });
    tracks[st.name] = pts.sort((a, b) => a.frame - b.frame);
    save(); update();
    console.log(`[pointage] ${st.name} — image ${frame} → x ${x.toFixed(4)}, y ${y.toFixed(4)} (${pts.length} points)`);
  }

  function onKey(e) {
    if (!st.enabled || e.target?.matches?.('input:not([type=checkbox]), select, textarea')) return;   // ne pas voler les flèches aux champs
    const { frameCount } = getState();
    if (!frameCount) return;
    const step = (e.shiftKey ? 10 : 1) / (frameCount - 1);
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.min(1, getState().progress + step)); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(Math.max(0, getState().progress - step)); }
    if (e.key === 'Backspace')  { e.preventDefault(); points().pop(); save(); update(); }
  }

  /* ---------- Overlay ---------- */

  function render() {
    const { frameCount, width, height } = getState();
    if (!st.enabled || !width) { layer.replaceChildren(); return; }
    const r = coverRect(stage.getBoundingClientRect(), width, height);
    const cur = currentFrame();
    const px = p => `${r.x + p.x * r.w} ${r.y + p.y * r.h}`;
    const nodes = [];
    for (const [name, pts] of Object.entries(tracks)) {
      const active = name === st.name;
      if (pts.length > 1) {                             // trace de la trajectoire (segments entre points consécutifs)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${px(p)}`).join(' '));
        if (!active) path.classList.add('other');
        svg.append(path); nodes.push(svg);
      }
      for (const p of pts) {
        const m = document.createElement('div');
        m.className = 'marker' + (active ? (p.frame === cur ? ' current' : '') : ' other');
        m.style.left = `${r.x + p.x * r.w}px`; m.style.top = `${r.y + p.y * r.h}px`;
        nodes.push(m);
      }
    }
    layer.replaceChildren(...nodes);
    layer.dataset.frame = `${st.name} — image ${cur} / ${Math.max(0, frameCount - 1)} — ${points().length} pt`;
  }
  const loop = () => { render(); raf = requestAnimationFrame(loop); };   // le scroll fait défiler les images : on suit

  function setEnabled(v) {
    st.enabled = v;
    stage.classList.toggle('pointage', v);
    cancelAnimationFrame(raf);
    if (v) { load(); loop(); } else render();
  }

  /* ---------- Panneau ---------- */

  const folder = gui.addFolder('Pointage (trajectoires)').close();
  folder.add(st, 'enabled').name('actif — clic = point, ← → = image').onChange(setEnabled);
  // Select des ids connus (hotspots déclarés + trajectoires pointées) ; lil-gui recrée le contrôleur à chaque options()
  const onPick = v => { st.name = v; update(); };
  let pickCtrl = folder.add(st, 'name', knownIds()).name('trajectoire').onChange(onPick);
  function refreshPick() { pickCtrl = pickCtrl.options(knownIds()).onChange(onPick); }
  const newCtrl = folder.add(st, 'newName').name('nouvelle trajectoire (id)').onFinishChange(v => {
    const id = v.trim(); st.newName = ''; newCtrl.updateDisplay();
    if (!id) return;
    st.name = id; tracks[id] ??= [];
    refreshPick(); update();
  });
  folder.add(st, 'count').name('points').listen().disable();
  folder.add(st, 'last').name('dernier').listen().disable();
  folder.add({ copy: async () => {
    const json = toJSON();
    console.log('[pointage] JSON :\n' + json);
    try { await navigator.clipboard.writeText(json); st.count = `${points().length} — copié ✔`; }
    catch { st.count = `${points().length} — voir la console`; }
  } }, 'copy').name('copier le JSON (toutes) 📋');
  folder.add({ undo: () => { points().pop(); save(); update(); } }, 'undo').name('retirer le dernier ⌫');
  folder.add({ clear: () => { tracks[st.name] = []; save(); update(); } }, 'clear').name('effacer cette trajectoire');

  stage.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  load();                                             // ids et points de la séquence initiale (overlay seulement une fois actif)

  return { onSequenceChange: load };
}
