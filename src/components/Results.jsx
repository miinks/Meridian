export default function Results({ results, onPick, onPickAirport, onWorldwide }) {
  const { items, visible } = results;
  if (!visible) return null;

  return (
    <ul className="results">
      {items.map((item, index) => {
        if (item.kind === "flight") {
          return (
            <li key={`flight-${item.id}`}>
              <button type="button" onClick={() => onPick(item.id)}>
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
              <button type="button" className="airport" onClick={() => onPickAirport(item.id)}>
                <strong>{item.code}</strong>
                <span>{item.name}</span>
              </button>
            </li>
          );
        }
        if (item.kind === "worldwide") {
          return (
            <li key="worldwide">
              <button type="button" className="worldwide" onClick={onWorldwide}>
                <strong>Scan the world for {item.query}</strong>
                <span>Uses extra OpenSky credits</span>
              </button>
            </li>
          );
        }
        return (
          <li key={`empty-${index}`}>
            <button type="button" disabled>
              {item.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
