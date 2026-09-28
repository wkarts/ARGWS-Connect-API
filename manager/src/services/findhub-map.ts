export function project(latitude: number, longitude: number, zoom: number) {
  const size = 256 * 2 ** zoom, lat = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180
  return { x: (longitude + 180) / 360 * size, y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size }
}
export function unproject(x: number, y: number, zoom: number) {
  const size = 256 * 2 ** zoom
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(size, y)) / size))) * 180 / Math.PI,
    longitude: ((x / size * 360) % 360 + 360) % 360 - 180 }
}

/** Keep the geographic point under the pointer fixed while zooming. */
export function zoomAt(center: {latitude: number; longitude: number}, oldZoom: number, requestedZoom: number,
  pointerX: number, pointerY: number, width: number, height: number) {
  const zoom = Math.max(2, Math.min(19, requestedZoom)); const ratio = 2 ** (zoom - oldZoom)
  const previous = project(center.latitude, center.longitude, oldZoom)
  return { zoom, center: unproject((previous.x + pointerX - width / 2) * ratio - pointerX + width / 2,
    (previous.y + pointerY - height / 2) * ratio - pointerY + height / 2, zoom) }
}
