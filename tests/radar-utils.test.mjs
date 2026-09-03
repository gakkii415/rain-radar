import test from "node:test";
import assert from "node:assert/strict";
import { buildRadarTileUrl, buildTimeline, parseJmaTime } from "../dist/radar-utils.js";

test("JMA UTC timestamp is parsed correctly", () => {
  assert.equal(parseJmaTime("20260903065000").toISOString(), "2026-09-03T06:50:00.000Z");
});

test("timeline sorts forecasts and keeps only the next 60 minutes", () => {
  const observations = [{ basetime: "20260903065000", validtime: "20260903065000", elements: ["hrpns"] }];
  const forecasts = [
    { basetime: "20260903065000", validtime: "20260903075500", elements: ["hrpns"] },
    { basetime: "20260903065000", validtime: "20260903070000", elements: ["hrpns"] },
    { basetime: "20260903065000", validtime: "20260903065500", elements: ["hrpns"] },
  ];
  const timeline = buildTimeline(observations, forecasts);
  assert.deepEqual(timeline.map((frame) => frame.offsetMinutes), [0, 5, 10]);
  assert.equal(timeline[1].kind, "forecast");
});

test("tile URL contains base and valid timestamps", () => {
  const url = buildRadarTileUrl({ basetime: "20260903065000", validtime: "20260903070000" });
  assert.match(url, /20260903065000\/none\/20260903070000\/surf\/hrpns\/\{z\}\/\{x\}\/\{y\}\.png$/);
});
