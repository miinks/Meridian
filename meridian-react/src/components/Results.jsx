export default function Results({ results, onPick, onWorldwide }) {
  const { items, visible } = results;
  if (!visible) return null;

  return (
    <ul className="results">
      {items.map((item, index) => {
        if (item.kind === "flight") {
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onPick(item.id)}>
                <strong>{item.callsign}</strong>
                <span>{item.country}</span>
              </button>
            </li>
          );
        }
        if (item.kind === "worldwide") {
          return (
            <li key="worldwide">
              <button type="button" className="worldwide" onClick={onWorldwide}>
                Search worldwide for {item.query}
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
