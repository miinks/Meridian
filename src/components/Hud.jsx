import { useEffect, useRef, useState } from "react";
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
  locationNote,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const extrasOn = paused || !airborneOnly;

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointerDown = (event) => {
      if (!moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moreOpen]);

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
          <div className="more" ref={moreRef}>
            <button
              type="button"
              className="chip"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              aria-pressed={extrasOn}
              aria-label={extrasOn ? "More map options, some are on" : "More map options"}
              onClick={() => setMoreOpen((open) => !open)}
            >
              More
            </button>
            {moreOpen ? (
              <div className="more-menu">
                <button type="button" className="chip" aria-pressed={paused} onClick={onTogglePause}>
                  {paused ? "Resume updates" : "Pause updates"}
                </button>
                <button type="button" className="chip" aria-pressed={airborneOnly} onClick={onToggleAirborne}>
                  Hide ground
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="chip" onClick={onLocate} aria-label="Show traffic near you">
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
      {locationNote || hint ? (
        <p className="first-hint" role="status">
          {locationNote || FIRST_HINT}
        </p>
      ) : null}
    </header>
  );
}
