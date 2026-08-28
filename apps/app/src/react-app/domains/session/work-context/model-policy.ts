import type { DataContext, WorkContext, WorkMode } from "@openwork/types/work-context"

import type { ModelOption, ModelRef } from "@/app/types"

type ModeGuidance = {
  label: string
  recommended: string
  alternatives: string[]
}

export const DATA_CONTEXT_LABELS: Record<DataContext, string> = {
  internal: "Internal work only",
  client: "Client data — EU hosted only",
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "openai-terra": "OpenAI Terra",
  "openai-sol": "OpenAI Sol",
  "claude-opus": "Claude Opus",
  "claude-fable": "Claude Fable",
  "nemotron-super-3-120b": "Nemotron",
}

export const MODE_GUIDANCE: Record<WorkMode, ModeGuidance> = {
  everyday: { label: "Everyday Work", recommended: "openai-terra", alternatives: [] },
  "research-decisions": { label: "Research & Decisions", recommended: "claude-opus", alternatives: [] },
  "complex-analysis": { label: "Complex Analysis", recommended: "claude-fable", alternatives: [] },
  "build-automate": { label: "Build & Automate", recommended: "openai-sol", alternatives: [] },
  "documents-spreadsheets": { label: "Documents & Spreadsheets", recommended: "openai-terra", alternatives: ["claude-opus"] },
}

const INTERNAL_ALIASES = new Set([
  "openai-terra",
  "openai-sol",
  "claude-opus",
  "claude-fable",
])

const CLIENT_ALIAS = "nemotron-super-3-120b"
const APPROVED_CLIENT_DEPLOYMENT = {
  provider: "bedrock",
  region: "eu-central-1",
  inferenceMode: "in-region",
  providerModelId: "nvidia.nemotron-super-3-120b",
} as const

function hasMatchingAlias(option: ModelOption): boolean {
  return option.workPolicy?.alias === option.modelID
}

function eligibleInternal(option: ModelOption): boolean {
  return hasMatchingAlias(option)
    && INTERNAL_ALIASES.has(option.modelID)
    && option.workPolicy?.dataContexts.includes("internal") === true
}

function eligibleClient(option: ModelOption): boolean {
  return hasMatchingAlias(option)
    && option.modelID === CLIENT_ALIAS
    && option.workPolicy?.dataContexts.includes("client") === true
    && option.workPolicy.deployment?.provider === APPROVED_CLIENT_DEPLOYMENT.provider
    && option.workPolicy.deployment.region === APPROVED_CLIENT_DEPLOYMENT.region
    && option.workPolicy.deployment.inferenceMode === APPROVED_CLIENT_DEPLOYMENT.inferenceMode
    && option.workPolicy.deployment.providerModelId === APPROVED_CLIENT_DEPLOYMENT.providerModelId
    && option.workPolicy.verification?.status === "verified"
    && Boolean(option.workPolicy.verification.verifiedAt)
    && Boolean(option.workPolicy.verification.evidenceRef)
}

export function eligibleModelOptions(options: readonly ModelOption[], dataContext: DataContext): ModelOption[] {
  return options.filter((option) => dataContext === "internal" ? eligibleInternal(option) : eligibleClient(option))
}

export function isModelEligible(selected: ModelRef, option: ModelOption | undefined, dataContext: DataContext): boolean {
  if (!option || option.providerID !== selected.providerID || option.modelID !== selected.modelID) return false
  return dataContext === "internal" ? eligibleInternal(option) : eligibleClient(option)
}

export function modelRecommendation(context: WorkContext): Pick<ModeGuidance, "recommended" | "alternatives"> {
  if (context.dataContext === "client") return { recommended: CLIENT_ALIAS, alternatives: [] }
  const mode = MODE_GUIDANCE[context.workMode]
  return { recommended: mode.recommended, alternatives: mode.alternatives }
}

export function colleagueFacingModelLabel(alias: string, fallback: string): string {
  return MODEL_DISPLAY_NAMES[alias] ?? fallback
}

export function shouldShowTechnicalModelId(option: ModelOption): boolean {
  return option.workPolicy === undefined
}

export function modelRecommendationPresentation(context: WorkContext): Pick<ModeGuidance, "recommended" | "alternatives"> {
  const recommendation = modelRecommendation(context)
  return {
    recommended: colleagueFacingModelLabel(recommendation.recommended, recommendation.recommended),
    alternatives: recommendation.alternatives.map((alias) => colleagueFacingModelLabel(alias, alias)),
  }
}

export function buildWorkContextSystemGuidance(context: WorkContext): string {
  const mode = MODE_GUIDANCE[context.workMode]
  const selectedRecommendation = modelRecommendationPresentation(context)
  const recommendation = [selectedRecommendation.recommended, ...selectedRecommendation.alternatives].join(" or ")
  const dataGuidance = context.dataContext === "client"
    ? "Data context: Client data. Use only the approved EU-hosted Nemotron model and do not send this content to another model."
    : "Data context: Internal. The retained OpenAI and Claude models are available according to the selected work mode."
  const documentLifecycle = context.workMode === "documents-spreadsheets"
    ? [
        "Document lifecycle: Use app-managed execution storage for uploaded, generated, and intermediate files, and render a preview there before handover.",
        "For Google Docs, Sheets, or Slides, use the signed-in colleague's native Google capability to create or explicitly update the requested file. For an Office or flat-file artifact, create and preview the requested format locally, then use the direct Drive upload action when handover was requested.",
        "An explicit create or update request authorizes saving to the resolved destination, so do not ask for a second confirmation. Keep a draft only unpublished; ask only when the destination is genuinely ambiguous or before moving, renaming, sharing, or widening access to an existing file.",
        "Complete handover with the preview, one real Drive link, and one sentence stating where the item was created or updated. Report an unsupported format visibly; never silently convert it or present a local file URL as the deliverable.",
      ]
    : []
  return [
    "OpenWork work context:",
    dataGuidance,
    `Work mode: ${mode.label}. Apply this work style. The colleague-facing model recommendation for this data context is ${recommendation}.`,
    ...documentLifecycle,
    "The selected model has already been chosen by the user interface; apply the work-mode guidance to how you help.",
  ].join("\n")
}
