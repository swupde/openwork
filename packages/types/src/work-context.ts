import { z } from "zod"

export const DATA_CONTEXTS = ["internal", "client"] as const
export type DataContext = (typeof DATA_CONTEXTS)[number]

export const WORK_MODES = [
  "everyday",
  "research-decisions",
  "complex-analysis",
  "build-automate",
  "documents-spreadsheets",
] as const
export type WorkMode = (typeof WORK_MODES)[number]

export const workContextSchema = z.object({
  dataContext: z.enum(DATA_CONTEXTS),
  workMode: z.enum(WORK_MODES),
}).strict()

export type WorkContext = z.infer<typeof workContextSchema>

export const DEFAULT_WORK_CONTEXT: WorkContext = {
  dataContext: "internal",
  workMode: "everyday",
}
