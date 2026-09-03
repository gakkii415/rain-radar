const JMA_TILE_ROOT = "https://www.jma.go.jp/bosai/jmatile/data/nowc";

export function parseJmaTime(value) {
  if (!/^\d{14}$/.test(value)) return new Date(NaN);
  const parts = [
    value.slice(0, 4), value.slice(4, 6), value.slice(6, 8),
    value.slice(8, 10), value.slice(10, 12), value.slice(12, 14),
  ].map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
}

export function buildRadarTileUrl(frame) {
  return `${JMA_TILE_ROOT}/${frame.basetime}/none/${frame.validtime}/surf/hrpns/{z}/{x}/{y}.png`;
}

export function buildTimeline(observations, forecasts) {
  const observed = observations.find((item) => item.elements?.includes("hrpns"));
  if (!observed) return [];

  const startMs = parseJmaTime(observed.validtime).getTime();
  const futureFrames = forecasts
    .filter((item) => item.elements?.includes("hrpns"))
    .filter((item) => {
      const diff = parseJmaTime(item.validtime).getTime() - startMs;
      return diff > 0 && diff <= 60 * 60 * 1000;
    });

  const frames = [{ ...observed, kind: "observation", offsetMinutes: 0 }];
  for (const item of futureFrames) {
    frames.push({
      ...item,
      kind: "forecast",
      offsetMinutes: Math.round((parseJmaTime(item.validtime).getTime() - startMs) / 60000),
    });
  }

  return frames
    .sort((a, b) => a.validtime.localeCompare(b.validtime))
    .filter((item, index, all) => index === 0 || item.validtime !== all[index - 1].validtime);
}

export function formatJst(value, options) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options }).format(parseJmaTime(value));
}
