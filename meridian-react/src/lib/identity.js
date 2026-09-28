import { AIRLINES_ICAO, AIRLINES_IATA } from "../data/airlines.js";

const REGISTRATION = /^(N[0-9]|[A-Z]-[A-Z]|C[A-Z][0-9]|VH[A-Z]|JA[0-9A-Z]|B-[0-9]|HL[0-9]|RP-C)/;

export function lookupAirline(callsign) {
  const cs = (callsign || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!cs || REGISTRATION.test(cs)) return null;

  const icao = cs.match(/^([A-Z]{3})(\d)/);
  if (icao && AIRLINES_ICAO[icao[1]]) {
    const number = cs.slice(3).replace(/^0+/, "") || cs.slice(3);
    return { code: icao[1], name: AIRLINES_ICAO[icao[1]], flight: `${AIRLINES_ICAO[icao[1]]} ${number}` };
  }

  if (/^[A-Z]{3}$/.test(cs) && AIRLINES_ICAO[cs]) {
    return { code: cs, name: AIRLINES_ICAO[cs], flight: AIRLINES_ICAO[cs] };
  }

  const iata = cs.match(/^([A-Z]{2})(\d)/);
  if (iata && AIRLINES_IATA[iata[1]]) {
    const number = cs.slice(2).replace(/^0+/, "") || cs.slice(2);
    return { code: iata[1], name: AIRLINES_IATA[iata[1]], flight: `${AIRLINES_IATA[iata[1]]} ${number}` };
  }

  return null;
}

export function categoryLabel(category) {
  switch (Number(category)) {
    case 2:
      return "Light aircraft";
    case 3:
      return "Small aircraft";
    case 4:
      return "Large aircraft";
    case 5:
      return "High-vortex airliner";
    case 6:
      return "Heavy aircraft";
    case 7:
      return "High-performance";
    case 8:
      return "Rotorcraft";
    case 9:
      return "Glider";
    case 10:
      return "Lighter-than-air";
    case 11:
      return "Parachutist";
    case 12:
      return "Ultralight";
    case 14:
      return "UAV";
    case 16:
      return "Emergency vehicle";
    case 17:
      return "Service vehicle";
    default:
      return "Aircraft";
  }
}

export function aircraftIcon(category) {
  switch (Number(category)) {
    case 2:
    case 3:
    case 12:
      return "small";
    case 6:
      return "heavy";
    case 8:
      return "rotor";
    case 9:
      return "glider";
    case 10:
      return "balloon";
    case 14:
      return "uav";
    case 16:
    case 17:
      return "ground";
    default:
      return "jet";
  }
}

const ROTOR = /^(A10|A11|A13|A16|A18|AS3|AS5|AS6|AW1|B06|B10|B40|B41|B42|B43|EC2|EC3|EC5|EC7|H12|H13|H15|H16|H17|H21|H22|R22|R44|R66|S76|S92|UH1|UH6|CH4|MI8|MI1|KA3|KA5)/;
const HEAVY = /^(A332|A333|A338|A339|A342|A343|A345|A346|A359|A35K|A388|A3ST|A124|A225|B741|B742|B743|B744|B748|B74S|B772|B773|B77L|B77W|B788|B789|B78X|MD11|DC10|C17|C5M)/;
const SMALL = /^(C15|C16|C17[2-9]|C18|C20[6-8]|C21|PA2|PA3|PA4|P28|SR2|DA4|DA6|BE3|M20|GLAS|DV20|C72|C82|C90|E50|E55|PC12|TBM)/;
const UAV = /^(Q4|MQ1|MQ9|RQ)/;
const GLIDER = /^(GLID|ASK|DG[0-9]|LS8)/;
const BALLOON = /^(BALL|SHIP)/;

export function iconFromTypecode(typecode) {
  const t = (typecode || "").toUpperCase();
  if (!t) return "";
  if (ROTOR.test(t) || t.startsWith("H1") || t.startsWith("H2")) return "rotor";
  if (HEAVY.test(t)) return "heavy";
  if (SMALL.test(t)) return "small";
  if (UAV.test(t)) return "uav";
  if (GLIDER.test(t)) return "glider";
  if (BALLOON.test(t)) return "balloon";
  return "jet";
}

export function formatAircraft(info, category) {
  if (info?.model && info?.manufacturer) {
    const model = info.model.startsWith(info.manufacturer) ? info.model : `${info.manufacturer} ${info.model}`;
    return info.typecode ? `${model} (${info.typecode})` : model;
  }
  if (info?.model) return info.typecode ? `${info.model} (${info.typecode})` : info.model;
  if (info?.typecode) return info.typecode;
  const label = categoryLabel(category);
  return label === "Aircraft" ? "Unknown type" : label;
}
