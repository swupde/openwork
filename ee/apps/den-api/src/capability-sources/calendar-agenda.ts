export const calendarAgendaPeriods = ["today", "tomorrow", "next_7_days"] as const

export type CalendarAgendaPeriod = typeof calendarAgendaPeriods[number]

type CalendarDate = {
  year: number
  month: number
  day: number
}

type CalendarDateTime = CalendarDate & {
  hour: number
  minute: number
  second: number
}

function calendarDateTimeAt(instant: Date, timeZone: string): CalendarDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  }
}

function shiftCalendarDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function timeZoneOffsetMilliseconds(instant: Date, timeZone: string): number {
  const local = calendarDateTimeAt(instant, timeZone)
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instant.getTime()
}

function localMidnightUtc(date: CalendarDate, timeZone: string): string {
  const nominalUtc = Date.UTC(date.year, date.month - 1, date.day)
  const firstInstant = new Date(nominalUtc - timeZoneOffsetMilliseconds(new Date(nominalUtc), timeZone))
  const correctedInstant = new Date(nominalUtc - timeZoneOffsetMilliseconds(firstInstant, timeZone))
  return correctedInstant.toISOString()
}

export function buildCalendarAgendaWindow(input: {
  period: CalendarAgendaPeriod
  timeZone: string
  now: Date
}): { timeMin: string; timeMax: string } {
  const today = calendarDateTimeAt(input.now, input.timeZone)
  const date = { year: today.year, month: today.month, day: today.day }

  if (input.period === "next_7_days") {
    return {
      timeMin: input.now.toISOString(),
      timeMax: localMidnightUtc(shiftCalendarDate(date, 7), input.timeZone),
    }
  }

  const startDate = input.period === "tomorrow" ? shiftCalendarDate(date, 1) : date
  return {
    timeMin: localMidnightUtc(startDate, input.timeZone),
    timeMax: localMidnightUtc(shiftCalendarDate(startDate, 1), input.timeZone),
  }
}
