export default function Sheet({ sheet, onClose, onToggleFollow }) {
  if (!sheet) return null;

  return (
    <aside className="sheet">
      <button type="button" className="close" aria-label="Close flight details" onClick={onClose}>
        Close
      </button>
      <p className="eyebrow">{sheet.eyebrow}</p>
      <h2>{sheet.callsign}</h2>
      <p className="icao">{sheet.icao}</p>
      <dl>
        {sheet.facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="follow" aria-pressed={sheet.following} onClick={onToggleFollow}>
        {sheet.following ? "Following" : "Follow"}
      </button>
    </aside>
  );
}
