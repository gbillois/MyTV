import {
  DEFAULT_CHANNELS,
  PARIS_TIME_ZONE,
  dateKey,
  nextParisMidnight,
  parisMidnight
} from "./epg.js";

export const DEFAULT_MINUTE_WIDTH = 2.25;
export const MIN_MINUTE_WIDTH = 1.5;
export const MAX_MINUTE_WIDTH = 12;
const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short"
});

const longDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long"
});

const channelDefaults = new Map(DEFAULT_CHANNELS.map(channel => [channel.id, channel]));

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatTime(timestamp) {
  return timeFormatter.format(new Date(timestamp));
}

export function formatDateLabel(key, todayKey) {
  if (key === todayKey) return "Aujourd’hui";
  return dateFormatter.format(new Date(parisMidnight(key))).replace(".", "");
}

export function populateDateSelector(select, dateKeys, selectedKey) {
  const todayKey = dateKey(Date.now());
  select.replaceChildren(
    ...dateKeys.map(key => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = formatDateLabel(key, todayKey);
      option.selected = key === selectedKey;
      return option;
    })
  );
}

export function resolveChannels(epgProvider, preferences) {
  const actualByBase = new Map();
  epgProvider.getChannels().forEach(channel => {
    if (!actualByBase.has(channel.baseId)) actualByBase.set(channel.baseId, channel);
  });

  return preferences.order
    .filter(id => !preferences.hidden.includes(id))
    .map(id => {
      const fallback = channelDefaults.get(id);
      const actual = actualByBase.get(id);
      return {
        ...fallback,
        actualId: actual?.id || id,
        sourceName: actual?.name || fallback.name,
        icon: actual?.icon || ""
      };
    });
}

function programmeSizeClass(width) {
  if (width < 28) return "is-tiny";
  if (width < 64) return "is-small";
  if (width < 96) return "is-medium";
  return "is-large";
}

export function clampMinuteWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_MINUTE_WIDTH;
  return Math.min(MAX_MINUTE_WIDTH, Math.max(MIN_MINUTE_WIDTH, width));
}

function createProgrammeButton(programme, windowStart, windowEnd, minuteWidth, onSelect) {
  const clippedStart = Math.max(programme.start, windowStart);
  const clippedStop = Math.min(programme.stop, windowEnd);
  const left = ((clippedStart - windowStart) / 60_000) * minuteWidth;
  const width = Math.max(2, ((clippedStop - clippedStart) / 60_000) * minuteWidth);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `programme cat-${programme.category} ${programmeSizeClass(width)}`;
  if (programme.stop < Date.now()) button.classList.add("is-past");
  button.style.left = `${left}px`;
  button.style.width = `${width}px`;
  button.setAttribute(
    "aria-label",
    `${programme.title}, de ${formatTime(programme.start)} à ${formatTime(programme.stop)}`
  );
  button.innerHTML = `
    <span class="programme-content">
      <span class="programme-title">${escapeHtml(programme.title)}</span>
      ${programme.subtitle ? `<span class="programme-subtitle">${escapeHtml(programme.subtitle)}</span>` : ""}
      <span class="programme-meta">${formatTime(programme.start)}–${formatTime(programme.stop)}</span>
    </span>
  `;
  button.addEventListener("click", () => onSelect(programme));
  return button;
}

export function renderGuide({
  canvas,
  epgProvider,
  channels,
  dateKeys,
  selectedDate,
  minuteWidth,
  onProgrammeSelect
}) {
  const firstDate = dateKeys[0] || selectedDate;
  const lastDate = dateKeys.at(-1) || selectedDate;
  const windowStart = parisMidnight(firstDate);
  const windowEnd = nextParisMidnight(lastDate);
  const durationMinutes = (windowEnd - windowStart) / 60_000;
  const timelineWidth = durationMinutes * minuteWidth;
  const fragment = document.createDocumentFragment();

  canvas.style.setProperty("--timeline-width", `${timelineWidth}px`);
  canvas.style.setProperty("--minute-width", `${minuteWidth}px`);
  canvas.style.setProperty("--channel-count", channels.length);
  canvas.replaceChildren();

  const corner = document.createElement("div");
  corner.className = "corner-cell";
  corner.textContent = "Chaînes";
  corner.style.gridColumn = "1";
  corner.style.gridRow = "1";
  fragment.append(corner);

  const ruler = document.createElement("div");
  ruler.className = "time-ruler";
  ruler.style.gridColumn = "2";
  ruler.style.gridRow = "1";

  for (let tick = windowStart; tick < windowEnd; tick += 30 * 60_000) {
    const tickElement = document.createElement("div");
    const minutes = (tick - windowStart) / 60_000;
    const formatted = formatTime(tick);
    const tickDate = dateKey(tick);
    const isDayStart = formatted === "00:00";
    tickElement.className = `time-tick${formatted.endsWith(":00") ? " is-hour" : ""}${isDayStart ? " is-day-start" : ""}`;
    tickElement.style.left = `${minutes * minuteWidth}px`;
    tickElement.innerHTML = isDayStart
      ? `<span class="day-label">${escapeHtml(formatDateLabel(tickDate, dateKey(Date.now())))}</span><span class="tick-label">00:00</span>`
      : `<span class="tick-label">${formatted}</span>`;
    ruler.append(tickElement);
  }
  fragment.append(ruler);

  dateKeys.slice(1).forEach(key => {
    const divider = document.createElement("div");
    const minutes = (parisMidnight(key) - windowStart) / 60_000;
    divider.className = "day-divider";
    divider.style.left = `calc(var(--channel-width) + ${minutes * minuteWidth}px)`;
    divider.setAttribute("aria-hidden", "true");
    fragment.append(divider);
  });

  channels.forEach((channel, channelIndex) => {
    const gridRow = channelIndex + 2;
    const channelCell = document.createElement("div");
    channelCell.className = "channel-cell";
    channelCell.style.gridColumn = "1";
    channelCell.style.gridRow = `${gridRow}`;
    channelCell.innerHTML = `
      <span class="channel-number">${channel.number}</span>
      <span class="channel-name">${escapeHtml(channel.name)}</span>
    `;
    if (channel.icon) {
      const logo = document.createElement("img");
      logo.className = "channel-logo";
      logo.alt = "";
      logo.loading = "lazy";
      logo.addEventListener("load", () => channelCell.classList.add("has-logo"));
      logo.addEventListener("error", () => logo.remove());
      logo.src = channel.icon;
      channelCell.append(logo);
    }

    const programmeRow = document.createElement("div");
    programmeRow.className = "programme-row";
    programmeRow.style.gridColumn = "2";
    programmeRow.style.gridRow = `${gridRow}`;
    programmeRow.setAttribute("aria-label", `Programmes ${channel.name}`);

    const programmes = epgProvider.getPrograms(channel.actualId, windowStart, windowEnd);
    if (programmes.length) {
      programmes.forEach(programme => {
        programme.channelDisplayName = channel.name;
        programmeRow.append(createProgrammeButton(programme, windowStart, windowEnd, minuteWidth, onProgrammeSelect));
      });
    } else {
      const empty = document.createElement("span");
      empty.className = "empty-programmes";
      empty.textContent = "Programme indisponible";
      programmeRow.append(empty);
    }

    fragment.append(channelCell, programmeRow);
  });

  const now = Date.now();
  if (now >= windowStart && now < windowEnd) {
    const line = document.createElement("div");
    line.className = "now-line";
    line.id = "nowLine";
    const left = (now - windowStart) / 60_000 * minuteWidth;
    line.style.left = `calc(var(--channel-width) + ${left}px)`;
    fragment.append(line);
  }

  canvas.append(fragment);
  return { windowStart, windowEnd, timelineWidth };
}

export function updateNowLine(canvas, windowStart, windowEnd, minuteWidth) {
  const line = canvas.querySelector("#nowLine");
  const now = Date.now();
  if (!line || now < windowStart || now >= windowEnd) return;
  const left = (now - windowStart) / 60_000 * minuteWidth;
  line.style.left = `calc(var(--channel-width) + ${left}px)`;
}

export function showProgrammeDetails(dialog, programme) {
  const duration = Math.max(1, Math.round((programme.stop - programme.start) / 60_000));
  const details = dialog.querySelector("#programmeDetails");
  const category = programme.categories?.filter(Boolean).join(", ");
  const metadata = [
    category && ["Catégorie", category],
    programme.episode && ["Épisode", programme.episode],
    programme.rating && ["Classification", programme.rating]
  ].filter(Boolean);

  details.innerHTML = `
    <p class="detail-channel">${escapeHtml(programme.channelDisplayName)}</p>
    <h2 id="programmeTitle">${escapeHtml(programme.title)}</h2>
    ${programme.subtitle ? `<p class="detail-subtitle">${escapeHtml(programme.subtitle)}</p>` : ""}
    <p class="detail-time">${formatTime(programme.start)}–${formatTime(programme.stop)} <span>${duration} min</span></p>
    ${programme.image ? `<img class="detail-image" src="${escapeHtml(programme.image)}" alt="" loading="lazy">` : ""}
    ${programme.description ? `<p class="detail-description">${escapeHtml(programme.description)}</p>` : ""}
    ${metadata.length ? `<dl class="metadata-grid">${metadata.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>` : ""}
  `;
  details.querySelector("img")?.addEventListener("error", event => event.currentTarget.remove());
  dialog.showModal();
}

export function attachSwipeToClose(dialog, sheet) {
  let startY = null;
  let deltaY = 0;

  sheet.addEventListener("touchstart", event => {
    if (sheet.scrollTop > 0) return;
    startY = event.touches[0].clientY;
    deltaY = 0;
  }, { passive: true });

  sheet.addEventListener("touchmove", event => {
    if (startY === null) return;
    deltaY = Math.max(0, event.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${deltaY}px)`;
  }, { passive: true });

  sheet.addEventListener("touchend", () => {
    if (startY === null) return;
    sheet.style.transform = "";
    if (deltaY > 100) dialog.close();
    startY = null;
    deltaY = 0;
  });
}

export function renderChannelSettings(container, preferences, onChange) {
  container.replaceChildren();
  preferences.order.forEach((id, index) => {
    const channel = channelDefaults.get(id);
    if (!channel) return;
    const row = document.createElement("div");
    row.className = "channel-setting";
    const visible = !preferences.hidden.includes(id);
    row.innerHTML = `
      <label class="visibility-toggle" title="Afficher ${escapeHtml(channel.name)}">
        <input type="checkbox" ${visible ? "checked" : ""} aria-label="Afficher ${escapeHtml(channel.name)}">
        <span class="toggle-track"></span>
      </label>
      <label><span>${channel.number}. ${escapeHtml(channel.name)}</span></label>
      <div class="order-buttons">
        <button class="order-button move-up" type="button" aria-label="Monter ${escapeHtml(channel.name)}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="order-button move-down" type="button" aria-label="Descendre ${escapeHtml(channel.name)}" ${index === preferences.order.length - 1 ? "disabled" : ""}>↓</button>
      </div>
    `;

    row.querySelector("input").addEventListener("change", event => {
      if (event.currentTarget.checked) {
        preferences.hidden = preferences.hidden.filter(hiddenId => hiddenId !== id);
      } else if (!preferences.hidden.includes(id)) {
        preferences.hidden.push(id);
      }
      onChange();
    });

    row.querySelector(".move-up").addEventListener("click", () => {
      [preferences.order[index - 1], preferences.order[index]] = [preferences.order[index], preferences.order[index - 1]];
      onChange(true);
    });
    row.querySelector(".move-down").addEventListener("click", () => {
      [preferences.order[index + 1], preferences.order[index]] = [preferences.order[index], preferences.order[index + 1]];
      onChange(true);
    });
    container.append(row);
  });
}

export function longDate(key) {
  return longDateFormatter.format(new Date(parisMidnight(key)));
}
