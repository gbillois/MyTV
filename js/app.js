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
  saveChannelPreferences,
  setCachedEpg
} from "./storage.js";
import {
  MINUTE_WIDTH,
  attachSwipeToClose,
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
  const previousLeft = elements.scroller.scrollLeft;
  const previousTop = elements.scroller.scrollTop;
  const channels = resolveChannels(state.provider, state.preferences);

  populateDateSelector(elements.dateSelect, state.dateKeys, state.selectedDate);
  renderGuide({
    canvas: elements.canvas,
    epgProvider: state.provider,
    channels,
    selectedDate: state.selectedDate,
    onProgrammeSelect: programme => showProgrammeDetails(elements.programmeDialog, programme)
  });

  if (preserveScroll) {
    requestAnimationFrame(() => {
      elements.scroller.scrollLeft = previousLeft;
      elements.scroller.scrollTop = previousTop;
    });
  }
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
  render();
  return true;
}

function scrollToTime(timestamp, smooth = true, leadMinutes = 45) {
  const windowStart = parisMidnight(state.selectedDate);
  const left = Math.max(0, ((timestamp - windowStart) / 60_000 - leadMinutes) * MINUTE_WIDTH);
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
}

function openSettings() {
  renderSettingsPanel();
  elements.settingsDialog.showModal();
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

setInterval(() => updateNowLine(elements.canvas, state.selectedDate), 60_000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(error => {
      console.warn("Service worker non enregistré", error);
    });
  });
}

loadGuide();
