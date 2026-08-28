import { describe, expect, test } from "bun:test"

import {
  DATA_CONTEXTS,
  DEFAULT_WORK_CONTEXT,
  WORK_MODES,
  workContextSchema,
} from "../src/work-context"

describe("work context contract", () => {
  test("has exactly two data contexts and five colleague-facing work modes", () => {
    expect(DATA_CONTEXTS).toEqual(["internal", "client"])
    expect(WORK_MODES).toEqual([
      "everyday",
      "research-decisions",
      "complex-analysis",
      "build-automate",
      "documents-spreadsheets",
    ])
    expect(DEFAULT_WORK_CONTEXT).toEqual({ dataContext: "internal", workMode: "everyday" })
  })

  test("accepts only the two persisted enum fields", () => {
    expect(workContextSchema.parse({ dataContext: "client", workMode: "documents-spreadsheets" })).toEqual({
      dataContext: "client",
      workMode: "documents-spreadsheets",
    })
    expect(() => workContextSchema.parse({ dataContext: "secret", workMode: "everyday" })).toThrow()
    expect(() => workContextSchema.parse({ dataContext: "internal", workMode: "future", model: "hidden" })).toThrow()
  })
})
