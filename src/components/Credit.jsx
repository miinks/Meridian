import { FLT_CATS } from "../lib/weather.js";

export default function Credit() {
  return (
    <footer className="credit">
      <div className="wx">
        <p className="wx-label" id="wx-legend-label">
          Airport weather
        </p>
        <ul className="wx-legend" aria-labelledby="wx-legend-label">
          {FLT_CATS.map((cat) => (
            <li key={cat}>
              <span className="wx-dot" data-cat={cat} />
              {cat}
            </li>
          ))}
        </ul>
      </div>
      <p className="credit-sources">
        Positions from <a href="https://opensky-network.org">OpenSky Network</a>
        {" · "}
        Airports <a href="https://ourairports.com">OurAirports</a>
        {" · "}
        Weather <a href="https://aviationweather.gov">Aviation Weather Center</a>
        {" · "}
        Airlines <a href="https://openflights.org">OpenFlights</a>
        {" · "}
        Map <a href="https://openfreemap.org">OpenFreeMap</a>
      </p>
    </footer>
  );
}
