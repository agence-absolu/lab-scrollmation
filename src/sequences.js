/* ---------------------------------------------------------------------------
 * Séquences disponibles dans la démo.
 *
 * Une séquence = une liste ordonnée de variantes { src, media, type } :
 *   - src   : chemin du mp4, relatif à la page (résolu en URL absolue avant d'être passé au worker) ;
 *   - media : media query de sélection (null = toujours) — permet d'avoir plusieurs largeurs
 *             d'encodage et de ne charger que celle adaptée au viewport ;
 *   - type  : chaîne codec testée avec video.canPlayType() ; l'ordre de la liste donne la préférence.
 * La première variante dont le codec est lisible « probably » ET dont la media query correspond est retenue.
 * ------------------------------------------------------------------------- */

export const Codecs = {
  AV1:  'video/mp4; codecs="av01.0.04M.08"',
  H264: 'video/mp4; codecs="avc1.4D401E"',
};

/** Breakpoints indicatifs pour des variantes multi-largeurs (largeur d'encodage ≈ largeur de viewport). */
export const Breakpoints = {
  XXL:    '(min-width: 2560px)',
  XL:     '(min-width: 1921px)',
  Large:  '(min-width: 1281px) and (max-width: 1920.98px)',
  Medium: '(min-width: 768px) and (max-width: 1280.98px), (max-width: 767.98px) and (orientation: landscape)',
  Small:  '(min-width: 451px) and (max-width: 767.98px) and (orientation: portrait)',
  XS:     '(min-width: 0px) and (max-width: 450.98px) and (orientation: portrait)',
};

export const Sequences = {
  'pano-mountain': { layout: 'Fullscreen', videos: [
    { src: 'videos/pano-mountain/pano-1440-60.mp4', media: null, type: Codecs.H264 },   // 1440×760, 60 fps, 420 images (7 s), GOP 4 ≈ 660 Mo décodés
  ] },
  'dune': { layout: 'Fullscreen', videos: [
    { src: 'videos/dune/dune-1440-60.mp4', media: null, type: Codecs.H264 },           // 1440×810, 59,94 fps, 397 images (6,6 s), GOP 4 ≈ 660 Mo décodés
  ] },
};
