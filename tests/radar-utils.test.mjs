import test from "node:test";
import assert from "node:assert/strict";
import { buildRadarTileUrl, buildTimelines, formatOffsetMinutes, parseJmaTime } from "../dist/radar-utils.js";

test("JMA UTC timestamp is parsed correctly", () => {
  assert.equal(parseJmaTime("20260903065000").toISOString(), "2026-09-03T06:50:00.000Z");
});

test("timelines separate high-resolution and extended forecasts", () => {
  const observations = [{ basetime: "20260903065000", validtime: "20260903065000", elements: ["hrpns"] }];
  const forecasts = [
    { basetime: "20260903065000", validtime: "20260903075500", elements: ["hrpns"] },
    { basetime: "20260903065000", validtime: "20260903070000", elements: ["hrpns"] },
    { basetime: "20260903065000", validtime: "20260903065500", elements: ["hrpns"] },
  ];
  const extended = [
    { basetime: "20260903065000", validtime: "20260903075000", member: "immed", elements: ["rasrf"] },
    { basetime: "20260903065000", validtime: "20260903085000", member: "immed", elements: ["rasrf"] },
    { basetime: "20260903055000", validtime: "20260903215000", member: "none", elements: ["rasrf"] },
  ];
  const timelines = buildTimelines(observations, forecasts, extended);
  assert.deepEqual(timelines.short.map((frame) => frame.offsetMinutes), [0, 5, 10]);
  assert.deepEqual(timelines.long.map((frame) => frame.offsetMinutes), [0, 120, 900]);
  assert.equal(timelines.long[1].kind, "extendedForecast");
});

test("extended tile URL uses its member and rasrf product", () => {
  const url = buildRadarTileUrl({ product: "rasrf", member: "immed", basetime: "20260903065000", validtime: "20260903085000" });
  assert.match(url, /rasrf\/20260903065000\/immed\/20260903085000\/surf\/rasrf/);
});

test("long offsets use hours and remaining minutes", () => {
  assert.equal(formatOffsetMinutes(5), "5分後");
  assert.equal(formatOffsetMinutes(120), "2時間後");
  assert.equal(formatOffsetMinutes(135), "2時間15分後");
});

test("tile URL contains base and valid timestamps", () => {
  const url = buildRadarTileUrl({ basetime: "20260903065000", validtime: "20260903070000" });
  assert.match(url, /20260903065000\/none\/20260903070000\/surf\/hrpns\/\{z\}\/\{x\}\/\{y\}\.png$/);
});
