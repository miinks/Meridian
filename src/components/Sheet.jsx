import { useEffect, useRef, useState } from "react";
import { FOLLOW_HINT } from "../lib/hint.js";

function flightShareUrl(icao) {
  const url = new URL(location.href);
  url.searchParams.set("icao", icao.toLowerCase());
  return url.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(input);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function Sheet({ sheet, onClose, onToggleFollow, onPickNearby, followHint }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  const icao = sheet?.icao || "";

  useEffect(() => {
    setCopied(false);
    return () => clearTimeout(copiedTimer.current);
  }, [icao]);

  if (!sheet) return null;

  const isAirport = sheet.kind === "airport";

  const handleCopy = async () => {
    if (!icao) return;
    const ok = await copyText(flightShareUrl(icao));
    if (!ok) return;
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };

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
              label === "METAR"
                ? "wide metar"
                : label === "Runways" || label === "Typical route" || label === "ETA"
                  ? "wide"
                  : undefined
            }
          >
            <dt>{label}</dt>
            <dd data-wx={label === "Weather" ? value : undefined}>{value}</dd>
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
        <>
          <div className="sheet-actions">
            <button type="button" className="follow" aria-pressed={sheet.following} onClick={onToggleFollow}>
              {sheet.following ? "Following" : "Follow"}
            </button>
            <button
              type="button"
              className="copy-link"
              onClick={handleCopy}
              disabled={!icao}
              aria-label="Copy link to this flight"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {followHint ? (
            <p className="follow-hint" role="status">
              {FOLLOW_HINT}
            </p>
          ) : null}
        </>
      )}
    </aside>
  );
}
