const STORAGE_KEY = "meridian.hint";

export const FIRST_HINT = "Click a plane, or search an airport like JFK.";

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
