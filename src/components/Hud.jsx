import Results from "./Results.jsx";
import { FIRST_HINT } from "../lib/hint.js";

export default function Hud({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  results,
  onPickResult,
  onPickAirport,
  onWorldwide,
  paused,
  airborneOnly,
  onTogglePause,
  onToggleAirborne,
  onLocate,
  status,
  hint,
}) {
  return (
    <header className="hud">
      <div className="brand">
        <p className="wordmark">Meridian</p>
        <p className="tag">Track a quieter sky</p>
      </div>

      <label className="search">
        <span className="search-label">Find a flight or airport</span>
        <input
          id="search"
          placeholder="Try JFK or UAL123"
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
        <Results
          results={results}
          onPick={onPickResult}
          onPickAirport={onPickAirport}
          onWorldwide={onWorldwide}
        />
      </label>

      <div className="end">
        <div className="chips">
          <button type="button" className="chip" aria-pressed={paused} onClick={onTogglePause}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="chip" aria-pressed={airborneOnly} onClick={onToggleAirborne}>
            In the air
          </button>
          <button type="button" className="chip" onClick={onLocate}>
            Near me
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
      {hint ? (
        <p className="first-hint" role="status">
          {FIRST_HINT}
        </p>
      ) : null}
    </header>
  );
}
