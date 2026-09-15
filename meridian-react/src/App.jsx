import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { installMapLayers } from "./lib/map.js";
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
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-73.95, 40.74],
      zoom: 7.2,
      attributionControl: { compact: true },
    });

    const handleVisibility = () => {
      if (!document.hidden) controllerRef.current?.refresh();
    };

    map.on("load", () => {
      installMapLayers(map);

      const controller = new MeridianController(map, {
        onStatus: setStatus,
        onSheet: setSheet,
        onResults: setResults,
        onPaused: setPaused,
        onTip: setTip,
        onSearchValue: setSearchValue,
      });
      controllerRef.current = controller;

      map.on("moveend", () => controller.handleMoveEnd());
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

      document.addEventListener("visibilitychange", handleVisibility);
      controller.boot();
    });

    return () => {
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
