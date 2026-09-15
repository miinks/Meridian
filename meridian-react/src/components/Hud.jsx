import Results from "./Results.jsx";

export default function Hud({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  results,
  onPickResult,
  onWorldwide,
  paused,
  airborneOnly,
  onTogglePause,
  onToggleAirborne,
  status,
}) {
  return (
    <header className="hud">
      <div className="brand">
        <p className="wordmark">Meridian</p>
        <p className="tag">Track a quieter sky</p>
      </div>

      <label className="search">
        <span className="search-label">Find a flight</span>
        <input
          id="search"
          placeholder="Callsign or ICAO"
          autoComplete="off"
          spellCheck="false"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onSearchSubmit();
          }}
        />
        <Results results={results} onPick={onPickResult} onWorldwide={onWorldwide} />
      </label>

      <div className="end">
        <div className="chips">
          <button type="button" className="chip" aria-pressed={paused} onClick={onTogglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="chip" aria-pressed={airborneOnly} onClick={onToggleAirborne}>
            Airborne
          </button>
        </div>
        <div className="status" data-state={status.kind}>
          <span className="pulse" />
          <div>
            <p className="status-label">{status.label}</p>
            <p className="status-meta">{status.meta}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
