import { expect, test } from "bun:test"
import { buildCalendarAgendaWindow } from "../src/capability-sources/calendar-agenda.js"

test("calendar agenda resolves a member's local day in their primary calendar timezone", () => {
  expect(buildCalendarAgendaWindow({
    period: "today",
    timeZone: "Europe/Berlin",
    now: new Date("2026-07-29T12:00:00.000Z"),
  })).toEqual({
    timeMin: "2026-07-28T22:00:00.000Z",
    timeMax: "2026-07-29T22:00:00.000Z",
  })
})

test("calendar agenda handles the spring daylight-saving transition", () => {
  expect(buildCalendarAgendaWindow({
    period: "today",
    timeZone: "Europe/Berlin",
    now: new Date("2026-03-29T11:00:00.000Z"),
  })).toEqual({
    timeMin: "2026-03-28T23:00:00.000Z",
    timeMax: "2026-03-29T22:00:00.000Z",
  })
})

test("calendar agenda does not assume a team-default timezone", () => {
  expect(buildCalendarAgendaWindow({
    period: "today",
    timeZone: "America/Los_Angeles",
    now: new Date("2026-07-29T12:00:00.000Z"),
  })).toEqual({
    timeMin: "2026-07-29T07:00:00.000Z",
    timeMax: "2026-07-30T07:00:00.000Z",
  })
})

test("calendar agenda starts an upcoming window at server time rather than asking a client to generate a timestamp", () => {
  expect(buildCalendarAgendaWindow({
    period: "next_7_days",
    timeZone: "Europe/Berlin",
    now: new Date("2026-07-29T12:00:00.000Z"),
  })).toEqual({
    timeMin: "2026-07-29T12:00:00.000Z",
    timeMax: "2026-08-04T22:00:00.000Z",
  })
})
