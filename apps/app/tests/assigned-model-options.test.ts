import { describe, expect, test } from "vitest";

import type { DenOrgLlmProvider } from "../src/app/lib/den";
import type { ModelOption } from "../src/app/types";
import {
  assignedModelOptions,
  mergeModelOptions,
} from "../src/react-app/domains/connections/provider-auth/assigned-model-options";

function provider(
  input: Pick<DenOrgLlmProvider, "id" | "source" | "providerId" | "name" | "hasApiKey" | "models">,
): DenOrgLlmProvider {
  return {
    ...input,
    providerConfig: {},
    createdAt: null,
    updatedAt: null,
  };
}

function option(providerID: string, modelID: string, title: string): ModelOption {
  return {
    providerID,
    modelID,
    title,
    behaviorTitle: "Reasoning",
    behaviorLabel: "Default",
    behaviorDescription: "",
    behaviorValue: null,
    isFree: false,
  };
}

describe("assigned model options", () => {
  test("exposes member-assigned provider models before a workspace exists", () => {
    const result = assignedModelOptions([
      provider({
        id: "lpr_anthropic_team",
        source: "custom",
        providerId: "anthropic",
        name: "Team Anthropic",
        hasApiKey: true,
        models: [{ id: "claude-sonnet", name: "Claude Sonnet", config: {}, createdAt: null }],
      }),
      provider({
        id: "lpr_openwork_subscription",
        source: "openwork",
        providerId: "openwork",
        name: "OpenWork Models",
        hasApiKey: false,
        models: [{ id: "gpt-5", name: "GPT-5", config: {}, createdAt: null }],
      }),
    ]);

    expect(result).toMatchObject([
      {
        providerID: "lpr_anthropic_team",
        modelID: "claude-sonnet",
        title: "Claude Sonnet",
        description: "Team Anthropic",
        source: "cloud",
      },
      {
        providerID: "openwork",
        modelID: "gpt-5",
        title: "GPT-5",
        description: "OpenWork Models",
        source: "cloud",
      },
    ]);
  });

  test("preserves validated model.config.openwork guidance metadata", () => {
    const [result] = assignedModelOptions([provider({
      id: "lpr_openai",
      source: "custom",
      providerId: "openai",
      name: "OpenAI",
      hasApiKey: true,
      models: [{
        id: "openai-terra",
        name: "openai-terra",
        config: {
          openwork: {
            alias: "openai-terra",
            dataContexts: ["internal"],
            verification: {
              status: "verified",
              verifiedAt: "2026-08-27T12:00:00.000Z",
              evidenceRef: "change-2026-08-27",
            },
          },
        },
        createdAt: null,
      }],
    })]);
    expect(result?.workPolicy).toEqual({
      alias: "openai-terra",
      dataContexts: ["internal"],
      verification: {
        status: "verified",
        verifiedAt: "2026-08-27T12:00:00.000Z",
        evidenceRef: "change-2026-08-27",
      },
    });
    expect(result?.title).toBe("OpenAI Terra");
  });

  test("drops malformed deployment verification metadata instead of treating it as proof", () => {
    const [result] = assignedModelOptions([provider({
      id: "lpr_nemotron",
      source: "custom",
      providerId: "bedrock",
      name: "Bedrock",
      hasApiKey: true,
      models: [{
        id: "nemotron-super-3-120b",
        name: "Nemotron",
        config: {
          openwork: {
            alias: "nemotron-super-3-120b",
            dataContexts: ["client"],
            deployment: { provider: "bedrock", region: "eu-central-1" },
            verification: { status: "verified", verifiedAt: "not-a-date", evidenceRef: "" },
          },
        },
        createdAt: null,
      }],
    })]);
    expect(result?.workPolicy).toBeUndefined();
  });

  test("preserves an explicit required verification state without treating it as proof", () => {
    const [result] = assignedModelOptions([provider({
      id: "lpr_nemotron",
      source: "custom",
      providerId: "swup-litellm",
      name: "SwitchUp AI models",
      hasApiKey: true,
      models: [{
        id: "nemotron-super-3-120b",
        name: "Nemotron Super 3 120B",
        config: {
          openwork: {
            alias: "nemotron-super-3-120b",
            dataContexts: ["client"],
            deployment: {
              provider: "bedrock",
              region: "eu-central-1",
              inferenceMode: "in-region",
              providerModelId: "nvidia.nemotron-super-3-120b",
            },
            verification: { status: "required", verifiedAt: null, evidenceRef: null },
          },
        },
        createdAt: null,
      }],
    })]);
    expect(result?.workPolicy?.verification).toEqual({ status: "required", verifiedAt: null, evidenceRef: null });
  });

  test("keeps local API-key models and lets the live workspace catalog replace fallbacks", () => {
    const fallback = {
      ...option("lpr_anthropic_team", "claude-sonnet", "Assigned Sonnet"),
      workPolicy: { alias: "claude-sonnet", dataContexts: ["internal" as const] },
    };
    const live = option("lpr_anthropic_team", "claude-sonnet", "Live Sonnet");
    const local = option("openai", "gpt-5", "GPT-5");

    expect(mergeModelOptions([live, local], [fallback])).toEqual([{ ...live, workPolicy: fallback.workPolicy }, local]);
  });
});
