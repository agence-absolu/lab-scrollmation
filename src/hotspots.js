/* ---------------------------------------------------------------------------
 * Hotspots : éléments DOM interactifs qui suivent un point de la vidéo (tracking).
 *
 * Chaque séquence déclare une liste de hotspots. Un hotspot = un bouton ancré sur une trajectoire
 * { frame, x, y } (x/y normalisés dans l'image vidéo, capturés avec l'outil de pointage) ; sa position
 * est interpolée linéairement entre deux keyframes et convertie en pixels écran en inversant le
 * recadrage `object-fit: cover`. Il est visible entre sa première et sa dernière keyframe (pour le
 * garder jusqu'à la fin, terminer la trajectoire sur la dernière image), fenêtre resserrable avec
 * `from` / `to`. Un clic ouvre une modale.
 *
 * Fiche d'un hotspot :
 *   id        identifiant (= nom de la trajectoire dans l'outil de pointage)
 *   label     texte du bouton
 *   keyframes trajectoire [{ frame, x, y }] triée par frame
 *   from, to  (optionnels) fenêtre d'affichage en n° d'image, par défaut la première / dernière keyframe
 *   modal     { kind: 'info' | 'product', tag, title, subtitle, html, facts: [[clé, valeur]], cta: { label, href }, swatch }
 * ------------------------------------------------------------------------- */

import { coverRect } from './cover.js';

/** Hotspots par séquence (clé de Sequences). */
export const Hotspots = {
  'pano-mountain': [
    {
      id: 'pic-du-midi',
      label: 'Pic du Midi',
      keyframes: [
        { frame: 192, x: 0.271,  y: 0.336 },
        { frame: 252, x: 0.2649, y: 0.3348 },
        { frame: 265, x: 0.2582, y: 0.3348 },
        { frame: 279, x: 0.2503, y: 0.3337 },
        { frame: 291, x: 0.2436, y: 0.3325 },
        { frame: 302, x: 0.2363, y: 0.3325 },
        { frame: 323, x: 0.2266, y: 0.3291 },
        { frame: 340, x: 0.2205, y: 0.3291 },
        { frame: 356, x: 0.2145, y: 0.3279 },
        { frame: 375, x: 0.2066, y: 0.3268 },
        { frame: 386, x: 0.2005, y: 0.3256 },
        { frame: 395, x: 0.1962, y: 0.3256 },
        { frame: 409, x: 0.1914, y: 0.3245 },
        { frame: 419, x: 0.1865, y: 0.3233 },
      ],
      modal: {
        kind: 'info',
        tag: 'Lieu',
        title: 'Pic du Midi de Bigorre',
        subtitle: '2 877 m — Hautes-Pyrénées',
        html: `
          <p>Sommet emblématique des Pyrénées françaises, le Pic du Midi de Bigorre abrite depuis 1878 l'un des
          plus anciens observatoires de haute montagne au monde. C'est là que Bernard Lyot met au point le
          coronographe en 1930, et que la NASA fait cartographier la Lune pour préparer les missions Apollo.</p>
          <p>Accessible en téléphérique depuis La Mongie, le site est aujourd'hui ouvert au public : terrasses
          panoramiques à 360°, planétarium, et nuits d'observation au cœur de la Réserve internationale de ciel
          étoilé du Pic du Midi, la première labellisée en Europe (2013).</p>`,
        facts: [['Altitude', '2 877 m'], ['Observatoire', 'fondé en 1878'], ['Accès', 'téléphérique depuis La Mongie (15 min)']],
      },
    },
    {
      id: 'hoody-orange',
      label: 'Hoody orange',
      keyframes: [
        { frame: 0, x: 0.5182, y: 0.4391 },
        { frame: 19, x: 0.5216, y: 0.438 },
        { frame: 38, x: 0.5256, y: 0.4369 },
        { frame: 53, x: 0.529, y: 0.4369 },
        { frame: 73, x: 0.533, y: 0.438 },
        { frame: 95, x: 0.5381, y: 0.4369 },
        { frame: 113, x: 0.5432, y: 0.4326 },
        { frame: 128, x: 0.5484, y: 0.4305 },
        { frame: 145, x: 0.554, y: 0.4251 },
        { frame: 164, x: 0.5609, y: 0.4197 },
        { frame: 186, x: 0.5677, y: 0.4143 },
        { frame: 201, x: 0.5757, y: 0.4089 },
        { frame: 211, x: 0.5825, y: 0.4046 },
        { frame: 220, x: 0.591, y: 0.4014 },
        { frame: 233, x: 0.603, y: 0.396 },
        { frame: 245, x: 0.6126, y: 0.3884 },
        { frame: 257, x: 0.6223, y: 0.3798 },
        { frame: 272, x: 0.6325, y: 0.3658 },
        { frame: 283, x: 0.6428, y: 0.3529 },
        { frame: 293, x: 0.6547, y: 0.3399 },
        { frame: 299, x: 0.6644, y: 0.3346 },
        { frame: 306, x: 0.6775, y: 0.3249 },
        { frame: 312, x: 0.6923, y: 0.3184 },
        { frame: 319, x: 0.7088, y: 0.3087 },
        { frame: 326, x: 0.7298, y: 0.299 },
        { frame: 334, x: 0.7531, y: 0.2936 },
        { frame: 343, x: 0.7833, y: 0.2839 },
      ],
      modal: {
        kind: 'product',
        tag: 'Focus produit',
        title: 'Hoody Trail Thermo',
        subtitle: 'Sweat à capuche technique — coloris Orange Sunset',
        swatch: 'linear-gradient(135deg, #ff9a3c, #e8641b)',
        html: `
          <p>Polaire grid légère et respirante pour les sorties trail et rando en altitude : chaleur au départ,
          évacuation de l'humidité dès que le rythme monte. Capuche ajustée compatible casque, poche kangourou
          zippée, poignets à passe-pouce.</p>
          <ul class="modal-features">
            <li>Polaire grid 180 g/m² — 92 % polyester recyclé</li>
            <li>Traitement déperlant DWR sans PFC</li>
            <li>Coupe ajustée, dos rallongé</li>
            <li>Poids : 310 g (taille M)</li>
          </ul>`,
        facts: [['Prix', '89 €'], ['Tailles', 'XS → XXL'], ['Coloris', 'Orange Sunset, Bleu Glacier, Noir']],
        cta: { label: 'Voir le produit', href: '#' },
      },
    },
  ],
  'dune': [
    {
      id: 'dune-car',
      label: 'Le 4×4',
      keyframes: [
        { frame: 0,   x: 0.0906, y: 0.1616 },
        { frame: 37,  x: 0.1007, y: 0.1571 },
        { frame: 66,  x: 0.1101, y: 0.1571 },
        { frame: 81,  x: 0.1152, y: 0.1627 },
        { frame: 93,  x: 0.1208, y: 0.1761 },
        { frame: 105, x: 0.1259, y: 0.1918 },
        { frame: 120, x: 0.1315, y: 0.2108 },
        { frame: 132, x: 0.1372, y: 0.2265 },
        { frame: 145, x: 0.1416, y: 0.2399 },
        { frame: 158, x: 0.1473, y: 0.2567 },
        { frame: 177, x: 0.1561, y: 0.2835 },
        { frame: 188, x: 0.158,  y: 0.2969 },
        { frame: 197, x: 0.1617, y: 0.3092 },
        { frame: 210, x: 0.1668, y: 0.3283 },
        { frame: 224, x: 0.1705, y: 0.3439 },
      ],
      modal: {                                          // contenu provisoire, à remplacer
        kind: 'info',
        tag: 'Véhicule',
        title: 'Expédition dans les dunes',
        subtitle: '4×4 d\'expédition — traversée du grand erg',
        html: `
          <p>Rouler sur le sable demande une préparation précise : pneus dégonflés à 1 bar pour élargir
          l'empreinte, plaques de désensablage, réserve d'eau et de carburant pour trois jours d'autonomie.
          Le convoi progresse à la fraîche, dune après dune, en lisant la lumière rasante pour deviner
          les crêtes et les cuvettes.</p>
          <p>Le passage filmé ici est une descente de barkhane : on aborde la crête perpendiculairement,
          moteur en retenue, sans jamais freiner dans la pente.</p>`,
        facts: [['Pression pneus', '1,0 bar sur sable'], ['Autonomie', '3 jours (eau, carburant)'], ['Vitesse', '20–30 km/h en dunes']],
      },
    },
    {
      id: 'backpack',
      label: 'Sac à dos',
      keyframes: [
        { frame: 0,   x: 0.633,  y: 0.4195 },
        { frame: 7,   x: 0.6367, y: 0.4109 },
        { frame: 17,  x: 0.6409, y: 0.4012 },
        { frame: 33,  x: 0.6446, y: 0.3904 },
        { frame: 45,  x: 0.6482, y: 0.3763 },
        { frame: 56,  x: 0.6513, y: 0.3655 },
        { frame: 76,  x: 0.6555, y: 0.3515 },
        { frame: 98,  x: 0.661,  y: 0.3537 },
        { frame: 112, x: 0.6634, y: 0.3623 },
        { frame: 127, x: 0.6683, y: 0.3655 },
        { frame: 145, x: 0.6744, y: 0.3688 },
        { frame: 157, x: 0.6786, y: 0.3709 },
        { frame: 170, x: 0.6792, y: 0.3774 },
        { frame: 186, x: 0.6817, y: 0.3871 },
        { frame: 204, x: 0.6853, y: 0.3936 },
        { frame: 234, x: 0.6859, y: 0.4066 },
        { frame: 251, x: 0.6835, y: 0.4174 },
        { frame: 276, x: 0.6817, y: 0.4271 },
        { frame: 305, x: 0.6798, y: 0.4325 },
        { frame: 320, x: 0.6774, y: 0.4357 },
        { frame: 339, x: 0.675,  y: 0.4379 },
        { frame: 356, x: 0.6695, y: 0.439 },
        { frame: 366, x: 0.6671, y: 0.439 },
        { frame: 375, x: 0.6622, y: 0.4357 },
        { frame: 384, x: 0.6561, y: 0.4325 },
        { frame: 392, x: 0.6501, y: 0.4314 },
        { frame: 396, x: 0.6488, y: 0.4303 },
      ],
      modal: {                                          // contenu provisoire, à remplacer
        kind: 'product',
        tag: 'Focus produit',
        title: 'Sac Désert 45 L',
        subtitle: 'Sac à dos d\'expédition — coloris Sable',
        swatch: 'linear-gradient(135deg, #e9c48a, #b8834a)',
        html: `
          <p>Conçu pour les treks en milieu aride : dos ventilé à filet tendu, portage sur les hanches
          pour garder les épaules libres, et fermeture roll-top qui tient le sable dehors. Les poches
          latérales élastiques accueillent deux gourdes de 1,5 L accessibles sans poser le sac.</p>
          <ul class="modal-features">
            <li>Toile 420D ripstop recyclée, enduction PU anti-sable</li>
            <li>Ceinture ventrale avec poches zippées</li>
            <li>Housse de pluie et sifflet intégrés</li>
            <li>Poids : 1,35 kg</li>
          </ul>`,
        facts: [['Prix', '149 €'], ['Volume', '45 L (+ 5 L roll-top)'], ['Coloris', 'Sable, Ardoise, Olive']],
        cta: { label: 'Voir le produit', href: '#' },
      },
    },
  ],
};

/** Position interpolée à l'image (fractionnaire) t, ou null hors de la fenêtre [from, to] (par défaut la trajectoire). */
export function positionAt(keyframes, t, from, to) {
  if (!keyframes.length) return null;
  const first = keyframes[0], last = keyframes[keyframes.length - 1];
  if (t < (from ?? first.frame) || t > (to ?? last.frame)) return null;
  if (t >= last.frame) return { x: last.x, y: last.y };
  if (t <= first.frame) return { x: first.x, y: first.y };
  let i = 0;
  while (keyframes[i + 1].frame < t) i++;
  const a = keyframes[i], b = keyframes[i + 1];
  const k = (t - a.frame) / (b.frame - a.frame);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/* ---------- Modale ---------- */

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Gabarit commun ; `kind: 'product'` ajoute un visuel (swatch) et un bouton d'action. */
function modalHTML(m) {
  return `
    <button type="button" class="modal-close" aria-label="Fermer">×</button>
    ${m.kind === 'product' && m.swatch ? `<div class="modal-visual" style="background:${m.swatch}"></div>` : ''}
    ${m.tag ? `<span class="modal-tag">${esc(m.tag)}</span>` : ''}
    <h2 class="modal-title" id="modal-title">${esc(m.title)}</h2>
    ${m.subtitle ? `<p class="modal-subtitle">${esc(m.subtitle)}</p>` : ''}
    <div class="modal-body">${m.html ?? ''}</div>
    ${m.facts?.length ? `<dl class="modal-facts">${m.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${m.cta ? `<a class="modal-cta" href="${esc(m.cta.href)}">${esc(m.cta.label)}</a>` : ''}`;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.stage
 * @param {() => {sequence: string, progress: number, frameCount: number, width: number, height: number}} o.getState
 * @param {(open: boolean) => void} [o.onModal]   appelé à l'ouverture / fermeture de la modale (ex. : figer le scroll)
 */
export function initHotspots({ stage, getState, onModal = () => {} }) {
  const layer = document.createElement('div'); layer.id = 'hotspots'; stage.append(layer);
  const modal = document.getElementById('modal');
  const card = modal.querySelector('.modal-card');
  let items = [];                                     // [{ hotspot, el }] de la séquence courante

  function open(h) {
    card.innerHTML = modalHTML(h.modal);
    card.className = `modal-card modal-${h.modal.kind ?? 'info'}`;
    card.querySelector('.modal-close').addEventListener('click', () => modal.close());
    modal.showModal();
    onModal(true);
  }
  modal.addEventListener('close', () => onModal(false));
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });   // clic sur l'overlay (::backdrop = le dialog lui-même)

  /* ---------- Suivi ---------- */

  function build() {
    const { sequence } = getState();
    items = (Hotspots[sequence] ?? []).map(hotspot => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'hotspot'; el.dataset.id = hotspot.id;
      el.innerHTML = `<span class="hotspot-dot"></span><span class="hotspot-label">${esc(hotspot.label)}</span>`;
      el.addEventListener('click', () => open(hotspot));
      return { hotspot, el };
    });
    layer.replaceChildren(...items.map(i => i.el));
  }

  function render() {
    if (!items.length) return;
    const { progress, frameCount, width, height } = getState();
    const ready = frameCount > 0 && width > 0;
    const r = ready && coverRect(stage.getBoundingClientRect(), width, height);
    const t = progress * (frameCount - 1);              // image fractionnaire : interpolation fluide entre deux images
    for (const { hotspot, el } of items) {
      const p = ready ? positionAt(hotspot.keyframes, t, hotspot.from, hotspot.to) : null;
      el.classList.toggle('visible', !!p);             // fondu CSS plutôt que display:none
      if (p) el.style.transform = `translate(${(r.x + p.x * r.w).toFixed(1)}px, ${(r.y + p.y * r.h).toFixed(1)}px)`;
    }
  }
  (function loop() { render(); requestAnimationFrame(loop); })();   // le scroll (lissé par Lenis) bouge à chaque frame

  build();
  return { onSequenceChange: build };
}
