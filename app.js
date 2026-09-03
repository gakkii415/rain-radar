import { buildRadarTileUrl, buildTimelines, formatJst, formatOffsetMinutes } from "./radar-utils.js";

const DATA_URLS = {
  observations: "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json",
  forecasts: "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json",
  extendedForecasts: "https://www.jma.go.jp/bosai/jmatile/data/rasrf/targetTimes.json",
};
const SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const DEFAULT_LOCATION = { lat: 34.98585, lon: 135.75877, label: "京都駅周辺" };
const STORAGE_KEYS = { location: "rain-radar:location", searchCache: "rain-radar:search-cache", range: "rain-radar:range" };
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;

const elements = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#place-input"),
  searchButton: document.querySelector("#search-button"),
  searchMessage: document.querySelector("#search-message"),
  searchResults: document.querySelector("#search-results"),
  selectedPlace: document.querySelector("#selected-place"),
  locateButton: document.querySelector("#locate-button"),
  refreshButton: document.querySelector("#refresh-button"),
  statusDot: document.querySelector("#status-dot"),
  dataStatus: document.querySelector("#data-status"),
  slider: document.querySelector("#time-slider"),
  playButton: document.querySelector("#play-button"),
  frameKind: document.querySelector("#frame-kind"),
  frameTime: document.querySelector("#frame-time"),
  frameDate: document.querySelector("#frame-date"),
  rangeStart: document.querySelector("#range-start"),
  rangeMiddle: document.querySelector("#range-middle"),
  rangeEnd: document.querySelector("#range-end"),
  rangeButtons: [...document.querySelectorAll("[data-range]")],
};

let frames = [];
let timelines = { short: [], long: [] };
let activeRange = readJson(STORAGE_KEYS.range, "long");
let radarLayer = null;
let pendingRadarLayer = null;
let locationMarker = null;
let playbackTimer = null;
let lastSearchAt = 0;

const savedLocation = readJson(STORAGE_KEYS.location, DEFAULT_LOCATION);
const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
  [savedLocation.lat, savedLocation.lon],
  12,
);

L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
}).addTo(map);

setLocation(savedLocation, { move: false });
loadRadarFrames();

elements.form.addEventListener("submit", handleSearch);
elements.locateButton.addEventListener("click", locateUser);
elements.refreshButton.addEventListener("click", () => loadRadarFrames({ keepIndex: true }));
elements.slider.addEventListener("input", () => showFrame(Number(elements.slider.value)));
elements.playButton.addEventListener("click", togglePlayback);
for (const button of elements.rangeButtons) {
  button.addEventListener("click", () => selectRange(button.dataset.range));
}
document.addEventListener("click", (event) => {
  if (!elements.form.contains(event.target) && !elements.searchResults.contains(event.target)) {
    elements.searchResults.hidden = true;
  }
});
window.addEventListener("online", () => loadRadarFrames({ keepIndex: true }));
window.addEventListener("offline", () => setDataStatus("オフラインです", "error"));
setInterval(() => loadRadarFrames({ keepIndex: true }), 5 * 60 * 1000);

async function loadRadarFrames({ keepIndex = false } = {}) {
  if (playbackTimer) stopPlayback();
  const previousIndex = Number(elements.slider.value);
  setDataStatus("雨雲データを取得中", "loading");
  elements.refreshButton.classList.add("is-loading");
  elements.refreshButton.disabled = true;

  try {
    const [observationsResponse, forecastsResponse, extendedResponse] = await Promise.all([
      fetch(DATA_URLS.observations, { cache: "no-store" }),
      fetch(DATA_URLS.forecasts, { cache: "no-store" }),
      fetch(DATA_URLS.extendedForecasts, { cache: "no-store" }),
    ]);
    if (!observationsResponse.ok || !forecastsResponse.ok || !extendedResponse.ok) throw new Error("data response error");

    const [observations, forecasts, extendedForecasts] = await Promise.all([
      observationsResponse.json(),
      forecastsResponse.json(),
      extendedResponse.json(),
    ]);
    timelines = buildTimelines(observations, forecasts, extendedForecasts);
    if (timelines.short.length < 2 || timelines.long.length < 2) throw new Error("timeline is empty");

    applyRange(activeRange, keepIndex ? previousIndex : 0);

    const updatedAt = formatJst(frames[0].validtime, { hour: "2-digit", minute: "2-digit", hour12: false });
    setDataStatus(`${updatedAt} 更新`, "live");
  } catch (error) {
    console.error(error);
    setDataStatus("雨雲データを取得できません", "error");
    if (!frames.length) {
      elements.frameDate.textContent = "通信状態を確認してください";
    }
  } finally {
    elements.refreshButton.classList.remove("is-loading");
    elements.refreshButton.disabled = false;
  }
}

function showFrame(index) {
  const frame = frames[index];
  if (!frame) return;

  if (pendingRadarLayer) map.removeLayer(pendingRadarLayer);
  const nextLayer = L.tileLayer(buildRadarTileUrl(frame), {
    minZoom: 4,
    maxZoom: 18,
    maxNativeZoom: 10,
    opacity: radarLayer ? 0 : 0.72,
    zIndex: 20,
    attribution: '<a href="https://www.jma.go.jp/bosai/nowc/" target="_blank" rel="noreferrer">気象庁</a>',
  }).addTo(map);
  pendingRadarLayer = nextLayer;
  nextLayer.once("load", () => {
    if (pendingRadarLayer !== nextLayer) return;
    nextLayer.setOpacity(0.72);
    if (radarLayer && radarLayer !== nextLayer) map.removeLayer(radarLayer);
    radarLayer = nextLayer;
    pendingRadarLayer = null;
  });

  const isForecast = frame.kind !== "observation";
  elements.frameKind.textContent = formatOffsetMinutes(frame.offsetMinutes);
  elements.frameKind.classList.toggle("is-forecast", isForecast);
  elements.frameTime.textContent = formatJst(frame.validtime, { hour: "2-digit", minute: "2-digit", hour12: false });
  const dataType = frame.kind === "extendedForecast" ? "1時間雨量" : frame.kind === "shortForecast" ? "高精細予報" : "実況";
  elements.frameDate.textContent = `${formatJst(frame.validtime, { month: "short", day: "numeric", weekday: "short" })} · ${dataType}`;
}

function updateRangeLabels() {
  const middle = frames[Math.floor((frames.length - 1) / 2)];
  const end = frames.at(-1);
  elements.rangeStart.textContent = "現在";
  elements.rangeMiddle.textContent = formatOffsetMinutes(middle?.offsetMinutes);
  elements.rangeEnd.textContent = formatOffsetMinutes(end?.offsetMinutes);
}

function selectRange(range) {
  if (!timelines[range]?.length || range === activeRange) return;
  if (playbackTimer) stopPlayback();
  activeRange = range;
  writeJson(STORAGE_KEYS.range, range);
  applyRange(range, 0);
}

function applyRange(range, preferredIndex = 0) {
  activeRange = timelines[range]?.length ? range : "short";
  frames = timelines[activeRange];
  for (const button of elements.rangeButtons) {
    const selected = button.dataset.range === activeRange;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  elements.slider.max = String(frames.length - 1);
  elements.slider.disabled = false;
  elements.playButton.disabled = false;
  updateRangeLabels();
  const index = Math.min(preferredIndex, frames.length - 1);
  elements.slider.value = String(index);
  showFrame(index);
}

function togglePlayback() {
  if (playbackTimer) {
    stopPlayback();
    return;
  }

  elements.playButton.classList.add("is-playing");
  elements.playButton.setAttribute("aria-label", "再生を停止");
  if (Number(elements.slider.value) >= frames.length - 1) elements.slider.value = "0";
  playbackTimer = window.setInterval(() => {
    const nextIndex = Number(elements.slider.value) + 1;
    if (nextIndex >= frames.length) {
      stopPlayback();
      return;
    }
    elements.slider.value = String(nextIndex);
    showFrame(nextIndex);
  }, 650);
}

function stopPlayback() {
  window.clearInterval(playbackTimer);
  playbackTimer = null;
  elements.playButton.classList.remove("is-playing");
  elements.playButton.setAttribute("aria-label", "雨雲の動きを再生");
}

async function handleSearch(event) {
  event.preventDefault();
  const query = elements.input.value.trim();
  if (query.length < 2) {
    setSearchMessage("2文字以上で入力してください", true);
    return;
  }

  elements.searchButton.disabled = true;
  setSearchMessage("場所を検索中…");
  elements.searchResults.hidden = true;

  try {
    const cached = getCachedSearch(query);
    const results = cached || await searchPlace(query);
    if (!cached) cacheSearch(query, results);
    renderSearchResults(results);
    setSearchMessage(results.length ? "候補を選んでください" : "場所が見つかりませんでした", !results.length);
  } catch (error) {
    console.error(error);
    setSearchMessage("検索できませんでした。時間をおいて再度お試しください", true);
  } finally {
    elements.searchButton.disabled = false;
  }
}

async function searchPlace(query) {
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1000) await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  lastSearchAt = Date.now();

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    countrycodes: "jp",
    "accept-language": "ja",
  });
  const response = await fetch(`${SEARCH_ENDPOINT}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("search response error");
  return response.json();
}

function renderSearchResults(results) {
  elements.searchResults.replaceChildren();
  if (!results.length) {
    elements.searchResults.hidden = true;
    return;
  }

  for (const result of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = result.display_name;
    button.addEventListener("click", () => {
      setLocation({ lat: Number(result.lat), lon: Number(result.lon), label: result.display_name });
      elements.searchResults.hidden = true;
      setSearchMessage("");
    });
    item.append(button);
    elements.searchResults.append(item);
  }
  elements.searchResults.hidden = false;
}

function locateUser() {
  if (!navigator.geolocation) {
    setSearchMessage("この端末では現在地を取得できません", true);
    return;
  }
  elements.locateButton.disabled = true;
  elements.locateButton.textContent = "取得中";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocation({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        label: "現在地",
      });
      elements.locateButton.disabled = false;
      elements.locateButton.textContent = "現在地";
    },
    () => {
      setSearchMessage("現在地を取得できませんでした", true);
      elements.locateButton.disabled = false;
      elements.locateButton.textContent = "現在地";
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

function setLocation(location, { move = true } = {}) {
  const latlng = [location.lat, location.lon];
  if (locationMarker) map.removeLayer(locationMarker);
  locationMarker = L.circleMarker(latlng, {
    radius: 7,
    color: "#ffffff",
    weight: 3,
    fillColor: "#1268d3",
    fillOpacity: 1,
  }).addTo(map);
  if (move) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) map.setView(latlng, 13);
    else map.flyTo(latlng, 13, { duration: 0.6 });
  }
  elements.selectedPlace.textContent = location.label;
  elements.selectedPlace.title = location.label;
  writeJson(STORAGE_KEYS.location, location);
}

function setDataStatus(message, state) {
  elements.dataStatus.textContent = message;
  elements.statusDot.className = `status-dot${state === "loading" ? " is-loading" : state === "error" ? " is-error" : ""}`;
}

function setSearchMessage(message, isError = false) {
  elements.searchMessage.textContent = message;
  elements.searchMessage.classList.toggle("is-error", isError);
}

function getCachedSearch(query) {
  const cache = readJson(STORAGE_KEYS.searchCache, {});
  const entry = cache[query];
  return entry && Date.now() - entry.savedAt < SEARCH_CACHE_MS ? entry.results : null;
}

function cacheSearch(query, results) {
  const cache = readJson(STORAGE_KEYS.searchCache, {});
  cache[query] = { savedAt: Date.now(), results };
  const recentEntries = Object.entries(cache)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, 20);
  writeJson(STORAGE_KEYS.searchCache, Object.fromEntries(recentEntries));
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and storage restrictions must not block the radar itself.
  }
}
