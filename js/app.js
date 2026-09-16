import {
  DEFAULT_CHANNELS,
  EpgProvider,
  availableDateKeys,
  dateKey,
  parisMidnight,
  parisWallTime
} from "./epg.js";
import {
  getCachedEpg,
  loadChannelPreferences,
  loadTimelineZoom,
  saveChannelPreferences,
  saveTimelineZoom,
  setCachedEpg
} from "./storage.js";
import {
  DEFAULT_MINUTE_WIDTH,
  MAX_MINUTE_WIDTH,
  MIN_MINUTE_WIDTH,
  attachSwipeToClose,
  clampMinuteWidth,
  populateDateSelector,
  renderChannelSettings,
  renderGuide,
  resolveChannels,
  showProgrammeDetails,
  updateNowLine
} from "./ui.js";

// Passez à "demo" pour développer sans réseau. En production, "remote"
// lit la copie XMLTV mise à jour par GitHub Actions dans data/epg.xml.
export const DATA_SOURCE = "remote";
const REMOTE_DATA_URL = "data/epg.xml";
const DEMO_DATA_URL = "demo/sample.xml";
const CACHE_TTL = 8 * 60 * 60 * 1000;

const elements = {
  canvas: document.querySelector("#epgCanvas"),
  scroller: document.querySelector("#gridScroller"),
  loading: document.querySelector("#loadingState"),
  updateStatus: document.querySelector("#updateStatus"),
  dateSelect: document.querySelector("#dateSelect"),
  nowButton: document.querySelector("#nowButton"),
  tonightButton: document.querySelector("#tonightButton"),
  todayButton: document.querySelector("#todayButton"),
  floatingNowButton: document.querySelector("#floatingNowButton"),
  programmeDialog: document.querySelector("#programmeDialog"),
  programmeSheet: document.querySelector("#programmeSheet"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  channelSettings: document.querySelector("#channelSettings"),
  zoomRange: document.querySelector("#zoomRange"),
  zoomValue: document.querySelector("#zoomValue"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  restoreChannelsButton: document.querySelector("#restoreChannelsButton"),
  toast: document.querySelector("#toast")
};

const state = {
  provider: new EpgProvider(REMOTE_DATA_URL),
  selectedDate: dateKey(Date.now()),
  dateKeys: [],
  preferences: loadChannelPreferences(DEFAULT_CHANNELS.map(channel => channel.id)),
  source: DATA_SOURCE,
  fetchedAt: 0,
  minuteWidth: clampMinuteWidth(loadTimelineZoom(DEFAULT_MINUTE_WIDTH)),
  windowStart: 0,
  windowEnd: 0,
  toastTimer: null
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
}

function updateStatus() {
  if (state.source === "demo") {
    elements.updateStatus.textContent = "Mode démo";
    elements.updateStatus.title = "Fixture XMLTV locale";
    return;
  }

  const formatter = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  elements.updateStatus.textContent = state.fetchedAt
    ? `Màj ${formatter.format(new Date(state.fetchedAt))}`
    : "Données enregistrées";
  elements.updateStatus.title = "Dernière récupération réussie du guide";
}

function chooseInitialDate() {
  const today = dateKey(Date.now());
  if (state.dateKeys.includes(today)) return today;
  const future = state.dateKeys.find(key => key > today);
  return future || state.dateKeys.at(-1) || today;
}

function setActiveNav(active) {
  [elements.nowButton, elements.tonightButton, elements.todayButton].forEach(button => {
    button.classList.toggle("is-active", button === active);
  });
}

function render({ preserveScroll = false } = {}) {
  const previousTimestamp = state.windowStart
    ? state.windowStart + (elements.scroller.scrollLeft / state.minuteWidth) * 60_000
    : null;
  const previousTop = elements.scroller.scrollTop;
  const channels = resolveChannels(state.provider, state.preferences);

  populateDateSelector(elements.dateSelect, state.dateKeys, state.selectedDate);
  const layout = renderGuide({
    canvas: elements.canvas,
    epgProvider: state.provider,
    channels,
    dateKeys: state.dateKeys,
    selectedDate: state.selectedDate,
    minuteWidth: state.minuteWidth,
    onProgrammeSelect: programme => showProgrammeDetails(elements.programmeDialog, programme)
  });
  state.windowStart = layout.windowStart;
  state.windowEnd = layout.windowEnd;

  if (preserveScroll) {
    if (previousTimestamp !== null) {
      elements.scroller.scrollLeft = Math.max(
        0,
        ((previousTimestamp - state.windowStart) / 60_000) * state.minuteWidth
      );
    }
    elements.scroller.scrollTop = previousTop;
  }
  updateZoomControls();
  updateStatus();
  elements.loading.classList.add("is-hidden");
}

function shiftDemoDataToToday(data) {
  const dates = availableDateKeys(data);
  if (!dates.length) return data;
  const delta = parisMidnight(dateKey(Date.now())) - parisMidnight(dates[0]);
  Object.values(data.programmesByChannel).forEach(programmes => {
    programmes.forEach(programme => {
      programme.start += delta;
      programme.stop += delta;
    });
  });
  return data;
}

async function fetchAndParse(source = DATA_SOURCE) {
  const isDemo = source === "demo";
  const provider = new EpgProvider(isDemo ? DEMO_DATA_URL : REMOTE_DATA_URL);
  const xml = await provider.fetch();
  let data = provider.parse(xml);
  if (isDemo) data = shiftDemoDataToToday(data);
  return { provider: provider.hydrate(data), data, isDemo };
}

async function loadGuide() {
  const cached = DATA_SOURCE === "remote" ? await getCachedEpg() : null;
  if (cached?.data) {
    state.provider.hydrate(cached.data);
    state.fetchedAt = cached.fetchedAt || 0;
    state.source = "remote";
    state.dateKeys = availableDateKeys(cached.data);
    state.selectedDate = chooseInitialDate();
    render();
    requestAnimationFrame(() => goToNow(false));
  }

  const cacheIsFresh = cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL;
  if (cacheIsFresh) return;

  try {
    const result = await fetchAndParse(DATA_SOURCE);
    state.provider = result.provider;
    state.source = result.isDemo ? "demo" : "remote";
    state.fetchedAt = Date.now();
    state.dateKeys = availableDateKeys(result.data);
    state.selectedDate = chooseInitialDate();
    if (!result.isDemo) await setCachedEpg({ data: result.data, fetchedAt: state.fetchedAt });
    render();
    requestAnimationFrame(() => goToNow(false));
  } catch (error) {
    console.error("Chargement EPG impossible", error);
    if (cached?.data) {
      showToast("Hors ligne · guide enregistré conservé");
      return;
    }

    try {
      const demo = await fetchAndParse("demo");
      state.provider = demo.provider;
      state.source = "demo";
      state.fetchedAt = 0;
      state.dateKeys = availableDateKeys(demo.data);
      state.selectedDate = chooseInitialDate();
      render();
      requestAnimationFrame(() => goToNow(false));
      showToast("Source EPG indisponible · mode démo");
    } catch (demoError) {
      console.error("Fixture de démonstration illisible", demoError);
      elements.loading.querySelector("strong").textContent = "Guide indisponible";
      elements.loading.querySelector("span").textContent = "Rechargez la page lorsque votre connexion revient.";
      elements.updateStatus.textContent = "Aucune donnée";
    }
  }
}

function selectDate(key) {
  if (!state.dateKeys.includes(key)) {
    showToast("Cette date n’est pas disponible dans le guide");
    return false;
  }
  state.selectedDate = key;
  elements.dateSelect.value = key;
  return true;
}

function scrollToTime(timestamp, smooth = true, leadMinutes = 45) {
  const left = Math.max(
    0,
    ((timestamp - state.windowStart) / 60_000 - leadMinutes) * state.minuteWidth
  );
  elements.scroller.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
}

function goToNow(smooth = true) {
  const today = dateKey(Date.now());
  if (state.selectedDate !== today && !selectDate(today)) return;
  setActiveNav(elements.nowButton);
  requestAnimationFrame(() => scrollToTime(Date.now(), smooth));
}

function goToTonight() {
  const key = state.selectedDate || dateKey(Date.now());
  setActiveNav(elements.tonightButton);
  scrollToTime(parisWallTime(key, 20, 30), true, 30);
}

function handlePreferenceChange(reorder = false) {
  saveChannelPreferences(state.preferences);
  render({ preserveScroll: true });
  if (reorder) renderSettingsPanel();
}

function renderSettingsPanel() {
  renderChannelSettings(elements.channelSettings, state.preferences, handlePreferenceChange);
  updateZoomControls();
}

function openSettings() {
  renderSettingsPanel();
  elements.settingsDialog.showModal();
}

function getChannelWidth() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--channel-width")) || 0;
}

function timelineTimestampAt(viewportX) {
  const localX = elements.scroller.scrollLeft + viewportX - getChannelWidth();
  const timestamp = state.windowStart + (localX / state.minuteWidth) * 60_000;
  return Math.min(state.windowEnd, Math.max(state.windowStart, timestamp));
}

function zoomPercent(width = state.minuteWidth) {
  return Math.round((width / DEFAULT_MINUTE_WIDTH) * 100);
}

function updateZoomControls(width = state.minuteWidth) {
  if (!elements.zoomRange) return;
  elements.zoomRange.value = String(width);
  elements.zoomValue.value = `${zoomPercent(width)} %`;
  elements.zoomValue.textContent = `${zoomPercent(width)} %`;
  elements.zoomOutButton.disabled = width <= MIN_MINUTE_WIDTH + 0.01;
  elements.zoomInButton.disabled = width >= MAX_MINUTE_WIDTH - 0.01;
}

function viewportCenterX() {
  const channelWidth = getChannelWidth();
  return channelWidth + Math.max(0, elements.scroller.clientWidth - channelWidth) / 2;
}

function clearPinchPreview() {
  elements.canvas.classList.remove("is-pinching");
  elements.canvas.style.removeProperty("--pinch-origin");
  elements.canvas.style.removeProperty("--pinch-scale");
}

function commitZoom(nextWidth, anchorTimestamp, anchorViewportX, announce = false) {
  const width = clampMinuteWidth(nextWidth);
  clearPinchPreview();
  if (Math.abs(width - state.minuteWidth) < 0.01) {
    updateZoomControls();
    return;
  }

  const top = elements.scroller.scrollTop;
  state.minuteWidth = width;
  saveTimelineZoom(width);
  render();

  const anchorMinutes = (anchorTimestamp - state.windowStart) / 60_000;
  elements.scroller.scrollLeft = Math.max(
    0,
    getChannelWidth() + anchorMinutes * state.minuteWidth - anchorViewportX
  );
  elements.scroller.scrollTop = top;
  syncDateWithScroll();
  if (announce) showToast(`Zoom ${zoomPercent()} %`);
}

function zoomAroundCenter(nextWidth) {
  const anchorViewportX = viewportCenterX();
  commitZoom(nextWidth, timelineTimestampAt(anchorViewportX), anchorViewportX);
}

function syncDateWithScroll() {
  if (!state.windowStart || !state.dateKeys.length) return;
  const timestamp = timelineTimestampAt(getChannelWidth() + 2);
  const key = dateKey(Math.min(timestamp, state.windowEnd - 1));
  if (!state.dateKeys.includes(key) || key === state.selectedDate) return;
  state.selectedDate = key;
  elements.dateSelect.value = key;
}

const pinch = {
  active: false,
  startDistance: 0,
  startWidth: DEFAULT_MINUTE_WIDTH,
  targetWidth: DEFAULT_MINUTE_WIDTH,
  anchorTimestamp: 0,
  anchorViewportX: 0,
  suppressClickUntil: 0
};

const edgeSwipe = {
  startX: null,
  atStart: false,
  atEnd: false
};

function touchDistance(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function beginPinch(event) {
  if (event.touches.length !== 2 || !state.windowStart) return;
  const rect = elements.scroller.getBoundingClientRect();
  const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
  if (centerX <= getChannelWidth()) return;
  const distance = touchDistance(event.touches);
  if (!distance) return;

  pinch.active = true;
  pinch.startDistance = distance;
  pinch.startWidth = state.minuteWidth;
  pinch.targetWidth = state.minuteWidth;
  pinch.anchorViewportX = centerX;
  pinch.anchorTimestamp = timelineTimestampAt(centerX);
  const origin = Math.max(0, elements.scroller.scrollLeft + centerX - getChannelWidth());
  elements.canvas.style.setProperty("--pinch-origin", `${origin}px`);
  elements.canvas.style.setProperty("--pinch-scale", "1");
  elements.canvas.classList.add("is-pinching");
  event.preventDefault();
}

function movePinch(event) {
  if (!pinch.active || event.touches.length < 2) return;
  pinch.targetWidth = clampMinuteWidth(
    pinch.startWidth * (touchDistance(event.touches) / pinch.startDistance)
  );
  elements.canvas.style.setProperty("--pinch-scale", String(pinch.targetWidth / pinch.startWidth));
  updateZoomControls(pinch.targetWidth);
  event.preventDefault();
}

function endPinch(event) {
  if (!pinch.active || event.touches.length >= 2) return;
  pinch.active = false;
  pinch.suppressClickUntil = performance.now() + 450;
  commitZoom(
    pinch.targetWidth,
    pinch.anchorTimestamp,
    pinch.anchorViewportX,
    Math.abs(pinch.targetWidth - pinch.startWidth) >= 0.05
  );
}

elements.nowButton.addEventListener("click", () => goToNow());
elements.floatingNowButton.addEventListener("click", () => goToNow());
elements.tonightButton.addEventListener("click", goToTonight);
elements.todayButton.addEventListener("click", () => {
  const today = dateKey(Date.now());
  if (state.selectedDate !== today && !selectDate(today)) return;
  setActiveNav(elements.todayButton);
  scrollToTime(Date.now(), true, 90);
});

elements.dateSelect.addEventListener("change", event => {
  if (!selectDate(event.currentTarget.value)) return;
  setActiveNav(null);
  scrollToTime(parisWallTime(state.selectedDate, 18, 0), false, 30);
});

let scrollFrame = 0;
elements.scroller.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    syncDateWithScroll();
  });
}, { passive: true });

elements.scroller.addEventListener("touchstart", event => {
  setActiveNav(null);
  if (event.touches.length === 1) {
    const maxScroll = elements.scroller.scrollWidth - elements.scroller.clientWidth;
    edgeSwipe.startX = event.touches[0].clientX;
    edgeSwipe.atStart = elements.scroller.scrollLeft <= 2;
    edgeSwipe.atEnd = elements.scroller.scrollLeft >= maxScroll - 2;
  } else if (event.touches.length === 2) {
    edgeSwipe.startX = null;
    beginPinch(event);
  }
}, { passive: false });
elements.scroller.addEventListener("touchmove", movePinch, { passive: false });
elements.scroller.addEventListener("touchend", event => {
  endPinch(event);
  if (event.touches.length || edgeSwipe.startX === null || !event.changedTouches.length) return;
  const deltaX = event.changedTouches[0].clientX - edgeSwipe.startX;
  if (edgeSwipe.atEnd && deltaX < -70) showToast("Fin des programmes disponibles");
  if (edgeSwipe.atStart && deltaX > 70) showToast("Début des programmes disponibles");
  edgeSwipe.startX = null;
}, { passive: false });
elements.scroller.addEventListener("touchcancel", event => {
  edgeSwipe.startX = null;
  endPinch(event);
}, { passive: false });
// Safari émet aussi GestureEvent pendant un pincement. Le calcul reste fondé
// sur TouchEvent, mais bloquer ce geste natif évite de zoomer toute la page.
["gesturestart", "gesturechange", "gestureend"].forEach(type => {
  elements.scroller.addEventListener(type, event => event.preventDefault(), { passive: false });
});
elements.scroller.addEventListener("click", event => {
  if (performance.now() >= pinch.suppressClickUntil) return;
  event.preventDefault();
  event.stopPropagation();
}, true);

elements.zoomRange.addEventListener("input", event => {
  updateZoomControls(clampMinuteWidth(event.currentTarget.value));
});
elements.zoomRange.addEventListener("change", event => {
  zoomAroundCenter(event.currentTarget.value);
});
elements.zoomOutButton.addEventListener("click", () => {
  zoomAroundCenter(Math.round((state.minuteWidth / 1.35) * 4) / 4);
});
elements.zoomInButton.addEventListener("click", () => {
  zoomAroundCenter(Math.round((state.minuteWidth * 1.35) * 4) / 4);
});

elements.settingsButton.addEventListener("click", openSettings);
elements.restoreChannelsButton.addEventListener("click", () => {
  state.preferences = {
    order: DEFAULT_CHANNELS.map(channel => channel.id),
    hidden: []
  };
  saveChannelPreferences(state.preferences);
  renderSettingsPanel();
  render({ preserveScroll: true });
  showToast("Ordre TNT rétabli");
});

document.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => elements.programmeDialog.close());
});
document.querySelectorAll("[data-close-settings]").forEach(button => {
  button.addEventListener("click", () => elements.settingsDialog.close());
});

attachSwipeToClose(elements.programmeDialog, elements.programmeSheet);

setInterval(() => {
  updateNowLine(elements.canvas, state.windowStart, state.windowEnd, state.minuteWidth);
}, 60_000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(error => {
      console.warn("Service worker non enregistré", error);
    });
  });
}

loadGuide();
