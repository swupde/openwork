/** @jsxImportSource react */
import type { DataContext, WorkContext, WorkMode } from "@openwork/types/work-context"

import { DATA_CONTEXT_LABELS, MODE_GUIDANCE, modelRecommendationPresentation } from "./model-policy"

const WORK_MODE_OPTIONS: Array<{ value: WorkMode; label: string }> = Object.entries(MODE_GUIDANCE)
  .map(([value, guidance]) => ({ value: value as WorkMode, label: guidance.label }))

export function WorkContextBar(props: {
  context: WorkContext
  busy: boolean
  error: string | null
  modelEligible: boolean
  onChange: (next: WorkContext) => void
  onOpenModelPicker: () => void
}) {
  const recommendation = modelRecommendationPresentation(props.context)
  const changeDataContext = (dataContext: DataContext) => props.onChange({ ...props.context, dataContext })
  const changeWorkMode = (workMode: WorkMode) => props.onChange({ ...props.context, workMode })

  return (
    <div className="mx-3 mb-2 rounded-xl border border-gray-5 bg-gray-1/80 px-3 py-2" data-testid="work-context-bar">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-10">
          Data
          <select
            aria-label="Data context"
            className="rounded-md border border-gray-6 bg-gray-2 px-2 py-1 text-xs text-gray-12"
            disabled={props.busy}
            value={props.context.dataContext}
            onChange={(event) => changeDataContext(event.target.value as DataContext)}
          >
            <option value="internal">{DATA_CONTEXT_LABELS.internal}</option>
            <option value="client">{DATA_CONTEXT_LABELS.client}</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-10">
          Work mode
          <select
            aria-label="Work mode"
            className="rounded-md border border-gray-6 bg-gray-2 px-2 py-1 text-xs text-gray-12"
            disabled={props.busy}
            value={props.context.workMode}
            onChange={(event) => changeWorkMode(event.target.value as WorkMode)}
          >
            {WORK_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <span className="min-w-0 flex-1 text-[11px] text-gray-9">
          Recommended: <span className="font-medium text-gray-11">{recommendation.recommended}</span>
          {recommendation.alternatives.length ? `; alternative: ${recommendation.alternatives.join(", ")}` : ""}
        </span>
        {!props.modelEligible ? (
          <button type="button" className="text-[11px] font-medium text-amber-11 hover:underline" onClick={props.onOpenModelPicker}>
            Choose an eligible model
          </button>
        ) : null}
      </div>
      {props.context.dataContext === "client" ? (
        <p className="mt-1 text-[11px] text-amber-11">Client data uses only the approved EU-hosted Nemotron model.</p>
      ) : null}
      {props.error ? <p className="mt-1 text-[11px] text-red-11">{props.error}</p> : null}
    </div>
  )
}
