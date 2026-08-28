import type { DenOrgLlmProvider } from "@/app/lib/den";
import type { ModelOption, ModelWorkPolicy } from "@/app/types";
import { colleagueFacingModelLabel } from "@/react-app/domains/session/work-context/model-policy";
import { getCloudManagedProviderId, isCloudManagedProviderKey } from "./cloud-provider-config";

export function filterCloudManagedModelOptions<T extends Pick<ModelOption, "providerID">>(
  options: readonly T[],
  cloudProvidersEnabled: boolean,
): T[] {
  return cloudProvidersEnabled
    ? [...options]
    : options.filter((option) => !isCloudManagedProviderKey(option.providerID));
}

export function assignedModelOptions(
  providers: readonly DenOrgLlmProvider[],
): ModelOption[] {
  return providers.flatMap((provider) => {
    const providerID = getCloudManagedProviderId(provider);
    if (!providerID) return [];

    return provider.models.flatMap((model) => {
      const modelID = model.id.trim();
      if (!modelID) return [];
      const parsedWorkPolicy = parseModelWorkPolicy(model.config.openwork);
      const fallbackTitle = model.name.trim() || modelID;

      const option: ModelOption = {
        providerID,
        modelID,
        title: parsedWorkPolicy.workPolicy
          ? colleagueFacingModelLabel(parsedWorkPolicy.workPolicy.alias, fallbackTitle)
          : fallbackTitle,
        description: provider.name.trim() || provider.providerId.trim() || providerID,
        behaviorTitle: "Reasoning",
        behaviorLabel: "Default",
        behaviorDescription: "",
        behaviorValue: null,
        isFree: false,
        source: "cloud",
        ...parsedWorkPolicy,
      };
      return [option];
    });
  });
}

function parseModelWorkPolicy(value: unknown): { workPolicy: ModelWorkPolicy } | Record<string, never> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const alias = typeof record.alias === "string" ? record.alias.trim() : "";
  if (!alias || !Array.isArray(record.dataContexts)) return {};
  const dataContexts = [...new Set(record.dataContexts)]
    .filter((context): context is "internal" | "client" => context === "internal" || context === "client");
  if (!dataContexts.length || dataContexts.length !== record.dataContexts.length) return {};

  let deployment: ModelWorkPolicy["deployment"];
  if (record.deployment !== undefined) {
    if (typeof record.deployment !== "object" || record.deployment === null || Array.isArray(record.deployment)) return {};
    const rawDeployment = record.deployment as Record<string, unknown>;
    const provider = rawDeployment.provider;
    const region = typeof rawDeployment.region === "string" ? rawDeployment.region.trim() : "";
    const inferenceMode = typeof rawDeployment.inferenceMode === "string" ? rawDeployment.inferenceMode.trim() : "";
    const providerModelId = typeof rawDeployment.providerModelId === "string" ? rawDeployment.providerModelId.trim() : "";
    if ((provider !== "bedrock" && provider !== "vertex") || !region) return {};
    deployment = {
      provider,
      region,
      ...(inferenceMode ? { inferenceMode } : {}),
      ...(providerModelId ? { providerModelId } : {}),
    };
  }

  let verification: ModelWorkPolicy["verification"];
  if (record.verification !== undefined) {
    if (typeof record.verification !== "object" || record.verification === null || Array.isArray(record.verification)) return {};
    const rawVerification = record.verification as Record<string, unknown>;
    if (rawVerification.status === "required") {
      if (rawVerification.verifiedAt !== null || rawVerification.evidenceRef !== null) return {};
      verification = { status: "required", verifiedAt: null, evidenceRef: null };
    } else {
      const verifiedAt = typeof rawVerification.verifiedAt === "string" ? rawVerification.verifiedAt.trim() : "";
      const evidenceRef = typeof rawVerification.evidenceRef === "string" ? rawVerification.evidenceRef.trim() : "";
      if (rawVerification.status !== "verified" || !verifiedAt || Number.isNaN(Date.parse(verifiedAt)) || !evidenceRef) return {};
      verification = { status: "verified", verifiedAt, evidenceRef };
    }
  }
  return {
    workPolicy: {
      alias,
      dataContexts,
      ...(deployment ? { deployment } : {}),
      ...(verification ? { verification } : {}),
    },
  };
}

export function mergeModelOptions(
  primary: readonly ModelOption[],
  fallback: readonly ModelOption[],
): ModelOption[] {
  const merged = new Map<string, ModelOption>();
  for (const option of fallback) {
    merged.set(`${option.providerID}:${option.modelID}`, option);
  }
  for (const option of primary) {
    const key = `${option.providerID}:${option.modelID}`;
    const existing = merged.get(key);
    merged.set(key, {
      ...option,
      ...(option.workPolicy || !existing?.workPolicy ? {} : { workPolicy: existing.workPolicy }),
    });
  }
  return [...merged.values()];
}
