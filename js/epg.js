export const PARIS_TIME_ZONE = "Europe/Paris";

export const DEFAULT_CHANNELS = [
  { id: "TF1.fr", number: 1, name: "TF1", short: "TF1" },
  { id: "France2.fr", number: 2, name: "France 2", short: "F2" },
  { id: "France3.fr", number: 3, name: "France 3", short: "F3" },
  { id: "France4.fr", number: 4, name: "France 4", short: "F4" },
  { id: "France5.fr", number: 5, name: "France 5", short: "F5" },
  { id: "M6.fr", number: 6, name: "M6", short: "M6" },
  { id: "arte.fr", number: 7, name: "Arte", short: "arte" },
  { id: "LCP.fr", number: 8, name: "LCP", short: "LCP" },
  { id: "W9.fr", number: 9, name: "W9", short: "W9" },
  { id: "TMC.fr", number: 10, name: "TMC", short: "TMC" },
  { id: "TFX.fr", number: 11, name: "TFX", short: "TFX" },
  { id: "Gulli.fr", number: 12, name: "Gulli", short: "Gulli" },
  { id: "BFMTV.fr", number: 13, name: "BFM TV", short: "BFM" },
  { id: "CNews.fr", number: 14, name: "CNews", short: "CNews" },
  { id: "LCI.fr", number: 15, name: "LCI", short: "LCI" },
  { id: "Franceinfo.fr", number: 16, name: "franceinfo", short: "info" },
  { id: "CStar.fr", number: 17, name: "CSTAR", short: "CSTAR" },
  { id: "T18.fr", number: 18, name: "T18", short: "T18" },
  { id: "NOVO19.fr", number: 19, name: "NOVO19", short: "NOVO19" }
];

const textFrom = (element, selector) => element.querySelector(selector)?.textContent?.trim() || "";

function localizedText(element, selector) {
  const values = [...element.querySelectorAll(selector)];
  return (
    values.find(node => (node.getAttribute("lang") || "").toLowerCase().startsWith("fr")) ||
    values[0]
  )?.textContent?.trim() || "";
}

export function parseXmltvDate(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})$/
  );
  if (!match) return NaN;

  const [, year, month, day, hour, minute, second = "00", sign, offsetHour, offsetMinute] = match;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const direction = sign === "+" ? 1 : -1;
  const offset = direction * ((+offsetHour * 60 + +offsetMinute) * 60_000);
  return utc - offset;
}

function normalizeCategory(values) {
  const raw = values.join(" ").toLowerCase();
  if (/film|cinéma|movie/.test(raw)) return "film";
  if (/série|feuilleton|soap|drame|fiction/.test(raw)) return "series";
  if (/sport|football|rugby|tennis|cyclisme/.test(raw)) return "sport";
  if (/jeunesse|enfant|animation|dessin/.test(raw)) return "kids";
  if (/documentaire|magazine|découverte|nature|histoire/.test(raw)) return "documentary";
  if (/journal|actualité|information|météo|news/.test(raw)) return "news";
  if (/divertissement|jeu|variété|musique|téléréalité|talk/.test(raw)) return "entertainment";
  return "other";
}

export function getBaseChannelId(channelId) {
  return String(channelId || "").split("@")[0];
}

function serializableChannel(element) {
  const id = element.getAttribute("id") || "";
  const icon = element.querySelector("icon")?.getAttribute("src") || "";
  return {
    id,
    baseId: getBaseChannelId(id),
    name: localizedText(element, "display-name") || id,
    icon
  };
}

function serializableProgramme(element, index) {
  const start = parseXmltvDate(element.getAttribute("start"));
  const stop = parseXmltvDate(element.getAttribute("stop"));
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return null;

  const categories = [...element.querySelectorAll("category")]
    .map(node => node.textContent?.trim())
    .filter(Boolean);
  const rating = textFrom(element, "rating value");
  const episode = textFrom(element, "episode-num");
  const image = element.querySelector("icon")?.getAttribute("src") || "";
  const channelId = element.getAttribute("channel") || "";
  const title = localizedText(element, "title") || "Programme";

  return {
    id: `${channelId}-${start}-${index}`,
    channelId,
    start,
    stop,
    title,
    subtitle: localizedText(element, "sub-title"),
    description: localizedText(element, "desc"),
    categories,
    category: normalizeCategory(categories),
    episode,
    rating,
    image
  };
}

export class EpgProvider {
  constructor(url) {
    this.url = url;
    this.channels = [];
    this.programmesByChannel = {};
  }

  async fetch() {
    const response = await window.fetch(this.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`EPG HTTP ${response.status}`);
    const xml = await response.text();
    if (!xml.includes("<tv") || !xml.includes("<programme")) {
      throw new Error("Réponse XMLTV invalide");
    }
    return xml;
  }

  parse(xml) {
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = documentNode.querySelector("parsererror");
    if (parserError) throw new Error("XMLTV impossible à analyser");

    this.channels = [...documentNode.querySelectorAll("tv > channel")].map(serializableChannel);
    this.programmesByChannel = {};

    [...documentNode.querySelectorAll("tv > programme")].forEach((element, index) => {
      const programme = serializableProgramme(element, index);
      if (!programme) return;
      (this.programmesByChannel[programme.channelId] ||= []).push(programme);
    });

    Object.values(this.programmesByChannel).forEach(programmes => programmes.sort((a, b) => a.start - b.start));
    return this.toJSON();
  }

  hydrate(data) {
    this.channels = data.channels || [];
    this.programmesByChannel = data.programmesByChannel || {};
    return this;
  }

  toJSON() {
    return { channels: this.channels, programmesByChannel: this.programmesByChannel };
  }

  getChannels() {
    return this.channels;
  }

  getPrograms(channelId, start, end) {
    const programmes = this.programmesByChannel[channelId] || [];
    let low = 0;
    let high = programmes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (programmes[middle].stop <= start) low = middle + 1;
      else high = middle;
    }

    const result = [];
    for (let index = low; index < programmes.length && programmes[index].start < end; index += 1) {
      if (programmes[index].stop > start) result.push(programmes[index]);
    }
    return result;
  }
}

const parisFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function dateKey(timestamp) {
  return parisFormatter.format(new Date(timestamp));
}

function timeZoneOffset(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const asUtc = Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second);
  return asUtc - timestamp;
}

export function parisMidnight(key) {
  return parisWallTime(key, 0, 0);
}

export function parisWallTime(key, hour, minute = 0) {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const targetUtc = Date.UTC(+match[1], +match[2] - 1, +match[3], hour, minute);
  let result = targetUtc - timeZoneOffset(targetUtc);
  result = targetUtc - timeZoneOffset(result);
  return result;
}

export function nextParisMidnight(key) {
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const next = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3] + 1));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return parisMidnight(nextKey);
}

export function availableDateKeys(epgData) {
  const keys = new Set();
  Object.values(epgData.programmesByChannel || {}).forEach(programmes => {
    programmes.forEach(programme => {
      keys.add(dateKey(programme.start));
      if (dateKey(programme.stop - 1) !== dateKey(programme.start)) keys.add(dateKey(programme.stop - 1));
    });
  });
  return [...keys].sort();
}
