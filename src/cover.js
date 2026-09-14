/** Rectangle réellement occupé par une image `videoWidth`×`videoHeight` affichée en `object-fit: cover` (centrée) dans `rect`. */
export function coverRect(rect, videoWidth, videoHeight) {
  const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
  const w = videoWidth * scale, h = videoHeight * scale;
  return { x: rect.left + (rect.width - w) / 2, y: rect.top + (rect.height - h) / 2, w, h };
}
