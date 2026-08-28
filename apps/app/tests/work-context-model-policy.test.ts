import { describe, expect, test } from "bun:test"

import type { ModelOption } from "../src/app/types"
import {
  DATA_CONTEXT_LABELS,
  MODE_GUIDANCE,
  buildWorkContextSystemGuidance,
  colleagueFacingModelLabel,
  eligibleModelOptions,
  isModelEligible,
  modelRecommendation,
  modelRecommendationPresentation,
  shouldShowTechnicalModelId,
} from "../src/react-app/domains/session/work-context/model-policy"

function option(alias: string, input?: {
  dataContexts?: Array<"internal" | "client">
  provider?: "bedrock" | "vertex"
  region?: string
  verified?: boolean
}): ModelOption {
  return {
    providerID: "lpr_org",
    modelID: alias,
    title: alias,
    behaviorTitle: "Reasoning",
    behaviorLabel: "Default",
    behaviorDescription: "",
    behaviorValue: null,
    isFree: false,
    source: "cloud",
    workPolicy: {
      alias,
      dataContexts: input?.dataContexts ?? ["internal"],
      ...(input?.provider && input.region
        ? {
            deployment: {
              provider: input.provider,
              region: input.region,
              inferenceMode: "in-region",
              providerModelId: "nvidia.nemotron-super-3-120b",
            },
          }
        : {}),
      ...(input?.verified
        ? { verification: { status: "verified", verifiedAt: "2026-08-27T12:00:00.000Z", evidenceRef: "change-2026-08-27" } }
        : {}),
    },
  }
}

describe("work-context model policy", () => {
  test("maps five work modes to colleague-facing OpenAI and Claude guidance", () => {
    expect(MODE_GUIDANCE).toEqual({
      everyday: { label: "Everyday Work", recommended: "openai-terra", alternatives: [] },
      "research-decisions": { label: "Research & Decisions", recommended: "claude-opus", alternatives: [] },
      "complex-analysis": { label: "Complex Analysis", recommended: "claude-fable", alternatives: [] },
      "build-automate": { label: "Build & Automate", recommended: "openai-sol", alternatives: [] },
      "documents-spreadsheets": { label: "Documents & Spreadsheets", recommended: "openai-terra", alternatives: ["claude-opus"] },
    })
  })

  test("presents data contexts and recommendations without exposing technical IDs", () => {
    expect(DATA_CONTEXT_LABELS).toEqual({
      internal: "Internal work only",
      client: "Client data — EU hosted only",
    })
    expect(modelRecommendationPresentation({ dataContext: "internal", workMode: "documents-spreadsheets" })).toEqual({
      recommended: "OpenAI Terra",
      alternatives: ["Claude Opus"],
    })
    expect(modelRecommendationPresentation({ dataContext: "client", workMode: "documents-spreadsheets" })).toEqual({
      recommended: "Nemotron",
      alternatives: [],
    })
  })

  test("uses colleague-facing labels for retained aliases and preserves ordinary provider names", () => {
    expect(colleagueFacingModelLabel("openai-terra", "openai-terra")).toBe("OpenAI Terra")
    expect(colleagueFacingModelLabel("claude-opus", "claude-opus")).toBe("Claude Opus")
    expect(colleagueFacingModelLabel("nemotron-super-3-120b", "nemotron-super-3-120b")).toBe("Nemotron")
    expect(colleagueFacingModelLabel("local-model", "My local model")).toBe("My local model")
  })

  test("keeps policy-managed routing IDs out of colleague-facing model rows", () => {
    expect(shouldShowTechnicalModelId(option("openai-terra"))).toBe(false)
    expect(shouldShowTechnicalModelId({ ...option("local-model"), workPolicy: undefined })).toBe(true)
  })

  test("internal exposes exactly four retained aliases and no MiniMax", () => {
    const options = [
      option("openai-terra"),
      option("openai-sol"),
      option("claude-opus"),
      option("claude-fable"),
      option("minimax-m2.5"),
      option("future-model"),
    ]
    expect(eligibleModelOptions(options, "internal").map((item) => item.modelID)).toEqual([
      "openai-terra",
      "openai-sol",
      "claude-opus",
      "claude-fable",
    ])
  })

  test("client exposes only EU Bedrock Nemotron and fails closed otherwise", () => {
    const eligible = option("nemotron-super-3-120b", { dataContexts: ["client"], provider: "bedrock", region: "eu-central-1", verified: true })
    const candidates = [
      eligible,
      option("nemotron-super-3-120b", { dataContexts: ["client"], provider: "bedrock", region: "eu-central-1" }),
      option("nemotron-super-3-120b", { dataContexts: ["client"], provider: "bedrock", region: "eu-west-1" }),
      option("nemotron-super-3-120b", { dataContexts: ["client"], provider: "bedrock", region: "us-east-1" }),
      option("nemotron-super-3-120b", { dataContexts: ["client"], provider: "vertex", region: "europe-west4" }),
      option("openai-terra", { dataContexts: ["client"], provider: "bedrock", region: "eu-central-1" }),
      { ...eligible, workPolicy: undefined },
    ]
    expect(eligibleModelOptions(candidates, "client")).toEqual([eligible])
    expect(isModelEligible({ providerID: eligible.providerID, modelID: eligible.modelID }, candidates[1]!, "client")).toBe(false)
  })

  test("system guidance carries both persisted axes without routing the model", () => {
    const text = buildWorkContextSystemGuidance({ dataContext: "client", workMode: "documents-spreadsheets" })
    expect(text).toContain("Client data")
    expect(text).toContain("Documents & Spreadsheets")
    expect(text).toContain("Nemotron")
    expect(text).not.toContain("openai-terra")
    expect(text).not.toContain("claude-opus")
    expect(text).not.toContain("route")
  })

  test("documents and spreadsheets guidance defines one local-preview-to-Drive lifecycle", () => {
    const text = buildWorkContextSystemGuidance({ dataContext: "internal", workMode: "documents-spreadsheets" })
    expect(text).toContain("app-managed execution storage")
    expect(text).toContain("preview")
    expect(text).toContain("Google Docs, Sheets, or Slides")
    expect(text).toContain("Office or flat-file")
    expect(text).toContain("real Drive link")
    expect(text).toContain("do not ask for a second confirmation")
    expect(text).toContain("draft only")
    expect(text).toContain("unsupported format")
  })

  test("client data overrides internal model recommendations without discarding the work mode", () => {
    expect(modelRecommendation({ dataContext: "client", workMode: "documents-spreadsheets" })).toEqual({
      recommended: "nemotron-super-3-120b",
      alternatives: [],
    })
    expect(modelRecommendation({ dataContext: "internal", workMode: "documents-spreadsheets" })).toEqual({
      recommended: "openai-terra",
      alternatives: ["claude-opus"],
    })
  })
})
