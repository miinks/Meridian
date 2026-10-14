import { FLT_CATS } from "../lib/weather.js";

export default function Credit() {
  return (
    <footer className="credit">
      <ul className="wx-legend" aria-label="Airport weather colors">
        {FLT_CATS.map((cat) => (
          <li key={cat}>
            <span className="wx-dot" data-cat={cat} />
            {cat}
          </li>
        ))}
      </ul>
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
