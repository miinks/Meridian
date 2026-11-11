const STORAGE_KEY = "meridian.hint";
const FOLLOW_STORAGE_KEY = "meridian.follow-hint";

export const EMPTY_HINT = "Zoom in, or tap Near me, to see flights.";
export const CLICK_HINT = "Click a plane.";
export const FOLLOW_HINT = "Follow keeps the map on this flight.";

export function hintWasDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberHintDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function followHintWasDismissed() {
  try {
    return localStorage.getItem(FOLLOW_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberFollowHintDismissed() {
  try {
    localStorage.setItem(FOLLOW_STORAGE_KEY, "1");
  } catch {
    // Ignore quota / private-mode failures.
  }
}
