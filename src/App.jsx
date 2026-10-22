import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  LOCATION_ASK,
  LOCATION_OFF,
  locateUser,
  locationPermission,
  openingCamera,
  readSavedCamera,
  saveCamera,
} from "./lib/camera.js";
import { loadAirlines } from "./lib/format.js";
import {
  followHintWasDismissed,
  hintWasDismissed,
  rememberFollowHintDismissed,
  rememberHintDismissed,
} from "./lib/hint.js";
import { AIRPORT_CLICK_LAYERS, airportIndex, installMapLayers, loadAirports, loadRunways, runwayIndex } from "./lib/map.js";
import { MeridianController } from "./lib/controller.js";
import Hud from "./components/Hud.jsx";
import Sheet from "./components/Sheet.jsx";
import Tip from "./components/Tip.jsx";
import Credit from "./components/Credit.jsx";

export default function App() {
  const mapContainerRef = useRef(null);
  const controllerRef = useRef(null);

  const [status, setStatus] = useState({
    kind: "idle",
    label: "Waiting for the map",
    meta: "OpenSky live positions",
  });
  const [sheet, setSheet] = useState(null);
  const [results, setResults] = useState({ items: [], visible: false });
  const [paused, setPaused] = useState(false);
  const [airborneOnly, setAirborneOnly] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [tip, setTip] = useState({ visible: false, text: "", x: 0, y: 0 });
  const [showHint, setShowHint] = useState(false);
  const hintDismissedRef = useRef(hintWasDismissed());
  const [showFollowHint, setShowFollowHint] = useState(!followHintWasDismissed());
  const followHintDismissedRef = useRef(followHintWasDismissed());
  const [locationNote, setLocationNote] = useState(null);

  const dismissFollowHint = () => {
    if (!followHintDismissedRef.current) {
      followHintDismissedRef.current = true;
      rememberFollowHintDismissed();
    }
    setShowFollowHint(false);
  };

  useEffect(() => {
    const saved = readSavedCamera();
    const initial = openingCamera();
    let cancelled = false;
    let userMoved = false;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: initial.center,
      zoom: initial.zoom,
      attributionControl: { compact: true },
    });

    const markUserMoved = (event) => {
      if (!event?.originalEvent && event?.type !== "dragstart") return;
      userMoved = true;
    };

    const handleVisibility = () => {
      if (!document.hidden) controllerRef.current?.refresh();
    };

    map.on("dragstart", markUserMoved);
    map.on("zoomstart", markUserMoved);

    map.on("load", async () => {
      const bootIcao = new URLSearchParams(location.search).get("icao");
      const dataPromise = Promise.all([
        loadAirports().catch(() => undefined),
        loadAirlines().catch(() => undefined),
        loadRunways().catch(() => undefined),
      ]);

      if (!bootIcao && !userMoved && !saved) {
        const permission = await locationPermission();
        if (cancelled) return;
        if (permission === "denied" || permission === "unsupported") {
          setLocationNote("off");
          setStatus({
            kind: "idle",
            label: "Showing a starting map",
            meta: "Use Near me to show traffic around you",
          });
        } else {
          if (permission !== "granted") setLocationNote("ask");
          setStatus({
            kind: "loading",
            label: "To show traffic near you",
            meta: permission === "granted" ? "OpenSky live positions" : "The browser may ask for location",
          });
          const located = await locateUser();
          if (cancelled) return;
          if (located.ok && !userMoved) {
            setLocationNote(null);
            map.jumpTo({ center: located.center, zoom: located.zoom });
            saveCamera(map);
          } else if (!located.ok) {
            setLocationNote("off");
            setStatus({
              kind: "idle",
              label: located.reason === "denied" ? "Location is off" : "Could not find you",
              meta: "The map stays here · use Near me anytime",
            });
          } else {
            setLocationNote(null);
          }
        }
      }

      const [airports, airlines, runways] = await dataPromise;
      if (cancelled) return;
      installMapLayers(map, airports, runways);

      const controller = new MeridianController(map, {
        onStatus: setStatus,
        onSheet: setSheet,
        onResults: setResults,
        onPaused: setPaused,
        onTip: setTip,
        onSearchValue: setSearchValue,
        onLiveTraffic: () => {
          if (hintDismissedRef.current) return;
          setShowHint(true);
        },
        onEngage: () => {
          if (!hintDismissedRef.current) {
            hintDismissedRef.current = true;
            rememberHintDismissed();
          }
          setShowHint(false);
          setLocationNote(null);
        },
        onLocationNote: setLocationNote,
      });
      if (airports) controller.setAirports(airportIndex(airports));
      if (airlines) controller.setAirlines(airlines);
      if (runways) controller.setRunways(runwayIndex(runways));
      controllerRef.current = controller;

      map.on("moveend", () => {
        saveCamera(map);
        controller.handleMoveEnd();
      });
      map.on("dragstart", () => controller.handleDragStart());
      map.on("click", (event) => controller.handleMapClick(event));
      map.on("mouseenter", "flights", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mousemove", "flights", (event) => controller.showTip(event));
      map.on("mouseleave", "flights", () => {
        map.getCanvas().style.cursor = "";
        controller.hideTip();
      });
      for (const layer of AIRPORT_CLICK_LAYERS) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mousemove", layer, (event) => controller.showAirportTip(event));
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
          controller.hideTip();
        });
      }

      document.addEventListener("visibilitychange", handleVisibility);
      controller.boot();
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      controllerRef.current?.destroy();
      controllerRef.current = null;
      map.remove();
    };
  }, []);

  const handleSearchChange = (value) => {
    setSearchValue(value);
    controllerRef.current?.setSearchValue(value);
  };

  return (
    <>
      <div id="map" ref={mapContainerRef} />
      <Tip tip={tip} />
      <Hud
        searchValue={searchValue}
        onSearchChange={handleSearchChange}
        onSearchSubmit={() => controllerRef.current?.submitSearch()}
        results={results}
        onPickResult={(id) => controllerRef.current?.pickResult(id)}
        onPickAirport={(ident) => controllerRef.current?.pickAirport(ident)}
        onWorldwide={() => controllerRef.current?.searchWorldwide()}
        paused={paused}
        airborneOnly={airborneOnly}
        onTogglePause={() => controllerRef.current?.togglePause()}
        onToggleAirborne={() => {
          const next = !airborneOnly;
          setAirborneOnly(next);
          controllerRef.current?.setAirborneOnly(next);
        }}
        onLocate={() => controllerRef.current?.locateMe()}
        status={status}
        hint={showHint}
        locationNote={locationNote === "ask" ? LOCATION_ASK : locationNote === "off" ? LOCATION_OFF : null}
      />
      <Sheet
        sheet={sheet}
        followHint={Boolean(showFollowHint && sheet && sheet.kind !== "airport")}
        onClose={() => {
          dismissFollowHint();
          controllerRef.current?.closeSheet();
        }}
        onToggleFollow={() => {
          dismissFollowHint();
          controllerRef.current?.toggleFollow();
        }}
        onPickNearby={(id) => controllerRef.current?.pickResult(id)}
      />
      <Credit />
    </>
  );
}
