import assert from "node:assert/strict"
import test from "node:test"
import {
  HOUR_MS,
  describeLaunchWindow,
  hoursToMs,
  launchWindowMs,
  parseLaunchHours,
} from "./launch-window"

const ORIGIN = Date.parse("2026-11-03T20:23:41.000Z")

test("first 5 minutes starts at pool init", () => {
  const window = launchWindowMs(ORIGIN, 0, 5 * 60_000)
  assert.equal(window.startMs, ORIGIN)
  assert.equal(window.endMs, ORIGIN + 5 * 60_000)
  assert.equal(describeLaunchWindow(ORIGIN, window.startMs, window.endMs), "First 5min")
})

test("start 2 end 5 is hours 2 through 5 after init", () => {
  const window = launchWindowMs(ORIGIN, hoursToMs(2), hoursToMs(5))
  assert.equal(window.startMs, ORIGIN + 2 * HOUR_MS)
  assert.equal(window.endMs, ORIGIN + 5 * HOUR_MS)
  assert.equal(describeLaunchWindow(ORIGIN, window.startMs, window.endMs), "2h to 5h from pool start")
})

test("reversed custom hours still run from the earlier hour", () => {
  const window = launchWindowMs(ORIGIN, hoursToMs(5), hoursToMs(2))
  assert.equal(window.startMs, ORIGIN + 2 * HOUR_MS)
  assert.equal(window.endMs, ORIGIN + 5 * HOUR_MS)
})

test("parseLaunchHours accepts hour numbers and rejects blanks", () => {
  assert.equal(parseLaunchHours("2"), 2)
  assert.equal(parseLaunchHours(" 5 "), 5)
  assert.equal(parseLaunchHours("2.5"), 2.5)
  assert.equal(parseLaunchHours("2h"), 2)
  assert.equal(parseLaunchHours(""), null)
  assert.equal(parseLaunchHours("-1"), null)
  assert.equal(parseLaunchHours("abc"), null)
})
