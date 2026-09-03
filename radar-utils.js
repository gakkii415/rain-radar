const JMA_TILE_ROOTS = {
  hrpns: "https://www.jma.go.jp/bosai/jmatile/data/nowc",
  rasrf: "https://www.jma.go.jp/bosai/jmatile/data/rasrf",
};

export function parseJmaTime(value) {
  if (!/^\d{14}$/.test(value)) return new Date(NaN);
  const parts = [
    value.slice(0, 4), value.slice(4, 6), value.slice(6, 8),
    value.slice(8, 10), value.slice(10, 12), value.slice(12, 14),
  ].map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
}

export function buildRadarTileUrl(frame) {
  const product = frame.product || "hrpns";
  const member = product === "rasrf" ? (frame.member || "none") : "none";
  return `${JMA_TILE_ROOTS[product]}/${frame.basetime}/${member}/${frame.validtime}/surf/${product}/{z}/{x}/{y}.png`;
}

export function buildTimelines(observations, forecasts, extendedForecasts) {
  const observed = observations.find((item) => item.elements?.includes("hrpns"));
  if (!observed) return { short: [], long: [] };

  const startMs = parseJmaTime(observed.validtime).getTime();
  const shortForecasts = forecasts
    .filter((item) => item.elements?.includes("hrpns"))
    .filter((item) => {
      const diff = parseJmaTime(item.validtime).getTime() - startMs;
      return diff > 0 && diff <= 60 * 60 * 1000;
    });

  const observation = { ...observed, kind: "observation", product: "hrpns", offsetMinutes: 0 };
  const short = [observation];
  for (const item of shortForecasts) {
    short.push({
      ...item,
      kind: "shortForecast",
      product: "hrpns",
      offsetMinutes: Math.round((parseJmaTime(item.validtime).getTime() - startMs) / 60000),
    });
  }

  const normalizedShort = short
    .sort((a, b) => a.validtime.localeCompare(b.validtime))
    .filter((item, index, all) => index === 0 || item.validtime !== all[index - 1].validtime);

  const byValidTime = new Map();
  for (const item of extendedForecasts.filter((entry) => entry.elements?.includes("rasrf"))) {
    const diff = parseJmaTime(item.validtime).getTime() - startMs;
    if (diff <= 60 * 60 * 1000 || diff > 15 * 60 * 60 * 1000) continue;
    const existing = byValidTime.get(item.validtime);
    if (!existing || item.basetime > existing.basetime) byValidTime.set(item.validtime, item);
  }

  const long = [observation, ...[...byValidTime.values()]
    .sort((a, b) => a.validtime.localeCompare(b.validtime))
    .map((item) => ({
      ...item,
      kind: "extendedForecast",
      product: "rasrf",
      offsetMinutes: Math.round((parseJmaTime(item.validtime).getTime() - startMs) / 60000),
    }))];

  return { short: normalizedShort, long };
}

export function formatOffsetMinutes(minutes) {
  if (!minutes) return "現在";
  if (minutes < 60) return `${minutes}分後`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}時間${remainder}分後` : `${hours}時間後`;
}

export function formatJst(value, options) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options }).format(parseJmaTime(value));
}
