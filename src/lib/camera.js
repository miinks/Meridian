export const FALLBACK_CAMERA = {
  center: [-73.95, 40.74],
  zoom: 7.2,
};

const STORAGE_KEY = "meridian.camera";
const LOCATE_ZOOM = 7.2;

export function readSavedCamera() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
    const { lng, lat, zoom } = parsed;
    if (![lng, lat, zoom].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (zoom < 1 || zoom > 18) return null;
    return { center: [lng, lat], zoom };
  } catch {
    return null;
  }
}

export function saveCamera(map) {
  if (!map) return;
  try {
    const center = map.getCenter();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lng: center.lng, lat: center.lat, zoom: map.getZoom() }),
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function openingCamera() {
  return readSavedCamera() || FALLBACK_CAMERA;
}

export function locateUser() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: LOCATE_ZOOM,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300_000 },
    );
  });
}
