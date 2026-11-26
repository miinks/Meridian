export function isPickableResult(item) {
  return item?.kind === "flight" || item?.kind === "airport" || item?.kind === "worldwide";
}

export function moveSearchActive(items, from, direction) {
  const indexes = [];
  for (let i = 0; i < items.length; i += 1) {
    if (isPickableResult(items[i])) indexes.push(i);
  }
  if (!indexes.length) return -1;
  const pos = indexes.indexOf(from);
  if (pos === -1) return direction > 0 ? indexes[0] : indexes[indexes.length - 1];
  return indexes[(pos + direction + indexes.length) % indexes.length];
}

export function activateSearchItem(item, { onPick, onPickAirport, onWorldwide } = {}) {
  if (!isPickableResult(item)) return false;
  if (item.kind === "flight") onPick?.(item.id);
  else if (item.kind === "airport") onPickAirport?.(item.id);
  else onWorldwide?.();
  return true;
}
