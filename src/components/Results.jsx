import { useEffect } from "react";

export default function Results({ results, activeIndex, onPick, onPickAirport, onWorldwide }) {
  const { items, visible } = results;

  useEffect(() => {
    if (!visible || activeIndex < 0) return undefined;
    document.getElementById(`search-result-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    return undefined;
  }, [visible, activeIndex]);

  if (!visible) return null;

  return (
    <ul className="results" id="search-results" role="listbox">
      {items.map((item, index) => {
        const selected = index === activeIndex;
        const optionId = `search-result-${index}`;
        if (item.kind === "flight") {
          return (
            <li key={`flight-${item.id}`}>
              <button
                type="button"
                id={optionId}
                role="option"
                aria-selected={selected}
                className={selected ? "active" : undefined}
                onClick={() => onPick(item.id)}
              >
                <strong>{item.callsign}</strong>
                <span>
                  {item.airline || item.country}
                  {item.fromWorld ? " · world" : ""}
                </span>
              </button>
            </li>
          );
        }
        if (item.kind === "airport") {
          return (
            <li key={`airport-${item.id}`}>
              <button
                type="button"
                id={optionId}
                role="option"
                aria-selected={selected}
                className={selected ? "active airport" : "airport"}
                onClick={() => onPickAirport(item.id)}
              >
                <strong>{item.code}</strong>
                <span>{item.name}</span>
              </button>
            </li>
          );
        }
        if (item.kind === "worldwide") {
          return (
            <li key="worldwide">
              <button
                type="button"
                id={optionId}
                role="option"
                aria-selected={selected}
                className={selected ? "active worldwide" : "worldwide"}
                onClick={onWorldwide}
              >
                <strong>Scan the world for {item.query}</strong>
                <span>Uses extra OpenSky credits</span>
              </button>
            </li>
          );
        }
        return (
          <li key={`empty-${index}`}>
            <button type="button" id={optionId} disabled>
              {item.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
