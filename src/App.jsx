import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { locateUser, openingCamera, saveCamera } from "./lib/camera.js";
import { loadAirlines } from "./lib/format.js";
import { AIRPORT_LAYERS, airportIndex, installMapLayers, loadAirports } from "./lib/map.js";
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

  useEffect(() => {
    const initial = openingCamera();
    const locatePromise = locateUser();
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
      ]);

      if (!bootIcao && !userMoved) {
        setStatus({
          kind: "loading",
          label: "Finding your location",
          meta: "OpenSky live positions",
        });
        const located = await locatePromise;
        if (cancelled) return;
        if (located && !userMoved) {
          map.jumpTo(located);
          saveCamera(map);
        }
      }

      const [airports, airlines] = await dataPromise;
      if (cancelled) return;
      installMapLayers(map, airports);

      const controller = new MeridianController(map, {
        onStatus: setStatus,
        onSheet: setSheet,
        onResults: setResults,
        onPaused: setPaused,
        onTip: setTip,
        onSearchValue: setSearchValue,
      });
      if (airports) controller.setAirports(airportIndex(airports));
      if (airlines) controller.setAirlines(airlines);
      controllerRef.current = controller;

      map.on("moveend", () => {
        saveCamera(map);
        controller.handleMoveEnd();
      });
      map.on("dragstart", () => controller.handleDragStart());
      map.on("click", "flights", (event) => controller.handleFlightClick(event));
      map.on("click", (event) => controller.handleMapClick(event));
      map.on("mouseenter", "flights", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mousemove", "flights", (event) => controller.showTip(event));
      map.on("mouseleave", "flights", () => {
        map.getCanvas().style.cursor = "";
        controller.hideTip();
      });
      for (const layer of AIRPORT_LAYERS) {
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
        status={status}
      />
      <Sheet
        sheet={sheet}
        onClose={() => controllerRef.current?.closeSheet()}
        onToggleFollow={() => controllerRef.current?.toggleFollow()}
      />
      <Credit />
    </>
  );
}
