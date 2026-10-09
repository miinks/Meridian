export default function Sheet({ sheet, onClose, onToggleFollow, onPickNearby }) {
  if (!sheet) return null;

  const isAirport = sheet.kind === "airport";

  return (
    <aside className="sheet">
      <button
        type="button"
        className="close"
        aria-label={isAirport ? "Close airport details" : "Close flight details"}
        onClick={onClose}
      >
        Close
      </button>
      <p className="eyebrow">{sheet.eyebrow}</p>
      <h2>{sheet.callsign}</h2>
      {sheet.airline ? <p className="airline">{sheet.airline}</p> : null}
      <p className="icao">{sheet.icao}</p>
      <dl>
        {sheet.facts.map(([label, value]) => (
          <div
            key={label}
            className={
              label === "METAR" ? "wide metar" : label === "Runways" || label === "Route" || label === "ETA" ? "wide" : undefined
            }
          >
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {isAirport ? (
        <ul className="nearby">
          {(sheet.nearby || []).length === 0 ? (
            <li className="nearby-empty">No traffic in view yet</li>
          ) : (
            sheet.nearby.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onPickNearby(item.id)}>
                  <strong>{item.callsign}</strong>
                  <span>{item.detail}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        <button type="button" className="follow" aria-pressed={sheet.following} onClick={onToggleFollow}>
          {sheet.following ? "Following" : "Follow"}
        </button>
      )}
    </aside>
  );
}
