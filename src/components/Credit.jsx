export default function Credit() {
  return (
    <footer className="credit">
      <span className="alt-key" title="Altitude from low (teal) to high (red)">
        <i style={{ background: "#6ec8d6" }} />
        <i style={{ background: "#7dcc7a" }} />
        <i style={{ background: "#d8c85c" }} />
        <i style={{ background: "#e59a4a" }} />
        <i style={{ background: "#e07070" }} />
        <span>low–high</span>
      </span>
      Positions from <a href="https://opensky-network.org">OpenSky Network</a>
      {" · "}
      Airports <a href="https://ourairports.com">OurAirports</a>
      {" · "}
      Airlines <a href="https://openflights.org">OpenFlights</a>
      {" · "}
      Map <a href="https://openfreemap.org">OpenFreeMap</a>
    </footer>
  );
}
