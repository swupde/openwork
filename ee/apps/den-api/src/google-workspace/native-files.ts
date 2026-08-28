import { randomUUID } from "node:crypto"

export type NativeGoogleFileContent =
  | { type: "document"; text: string }
  | { type: "spreadsheet"; sheetName: string; values: Array<Array<string | number | boolean | null>> }
  | { type: "presentation"; slides: Array<{ title: string; body: string }> }

export type NativeGoogleFileCreateInput = NativeGoogleFileContent & {
  name: string
  folderId?: string
}

export type NativeGoogleFileUpdateInput = NativeGoogleFileContent & {
  name?: string
  folderId?: string
}

export type NativeGoogleFileMetadata = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  webViewLink: string
  size: string | null
}

export class NativeGoogleFileApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly details: string,
  ) {
    super(`${operation} failed: ${status} ${details}`)
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

type NativeGoogleApiContext = {
  accessToken: string
  apiBase: string
  driveApiBase: string
  fetch: FetchLike
}

type SheetProperties = { sheetId: number; title: string }

function apiUrl(base: string, path: string): URL {
  return new URL(path, `${base.replace(/\/+$/, "")}/`)
}

async function googleJson(
  context: NativeGoogleApiContext,
  operation: string,
  url: URL,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await context.fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${context.accessToken}`,
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new NativeGoogleFileApiError(operation, response.status, (await response.text()).slice(0, 300))
  }
  const value: unknown = await response.json()
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NativeGoogleFileApiError(operation, 502, "Google returned an invalid JSON object.")
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string, operation: string): string {
  const value = record[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new NativeGoogleFileApiError(operation, 502, `Google returned no ${key}.`)
  }
  return value
}

export function buildDocumentReplacementRequests(text: string, currentEndIndex: number | null): unknown[] {
  const requests: unknown[] = []
  if (currentEndIndex !== null && currentEndIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: currentEndIndex - 1 } } })
  }
  if (text) requests.push({ insertText: { location: { index: 1 }, text } })
  return requests
}

export function buildSpreadsheetStructureRequests(input: {
  sheets: SheetProperties[]
  sheetName: string
}): unknown[] {
  const first = input.sheets[0]
  if (!first) return []
  return [
    ...(first.title === input.sheetName
      ? []
      : [{ updateSheetProperties: { properties: { sheetId: first.sheetId, title: input.sheetName }, fields: "title" } }]),
    ...input.sheets.slice(1).map((sheet) => ({ deleteSheet: { sheetId: sheet.sheetId } })),
  ]
}

export function spreadsheetA1Range(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'!A1`
}

export function buildPresentationReplacementRequests(input: {
  existingPageIds: string[]
  slides: Array<{ title: string; body: string }>
  idFactory?: (label: string) => string
}): unknown[] {
  const idFactory = input.idFactory ?? ((label) => `ow_${label}_${randomUUID()}`)
  const requests: unknown[] = []
  input.slides.forEach((slide, index) => {
    const position = index + 1
    const slideId = idFactory(`slide_${position}`)
    const titleId = idFactory(`title_${position}`)
    const bodyId = idFactory(`body_${position}`)
    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: index,
        slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: bodyId },
        ],
      },
    })
    if (slide.title) requests.push({ insertText: { objectId: titleId, text: slide.title } })
    if (slide.body) requests.push({ insertText: { objectId: bodyId, text: slide.body } })
  })
  requests.push(...input.existingPageIds.map((objectId) => ({ deleteObject: { objectId } })))
  return requests
}

export function driveFolderMoveParameters(currentParents: string[], folderId: string): {
  addParents?: string
  removeParents?: string
} {
  if (currentParents.length === 1 && currentParents[0] === folderId) return {}
  return {
    addParents: folderId,
    ...(currentParents.length ? { removeParents: currentParents.join(",") } : {}),
  }
}

function documentEndIndex(value: Record<string, unknown>): number | null {
  const body = value.body
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null
  const content = (body as Record<string, unknown>).content
  if (!Array.isArray(content)) return null
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const item = content[index]
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue
    const endIndex = (item as Record<string, unknown>).endIndex
    if (typeof endIndex === "number" && Number.isInteger(endIndex)) return endIndex
  }
  return null
}

function spreadsheetSheets(value: Record<string, unknown>): SheetProperties[] {
  if (!Array.isArray(value.sheets)) return []
  return value.sheets.flatMap((sheet) => {
    if (typeof sheet !== "object" || sheet === null || Array.isArray(sheet)) return []
    const properties = (sheet as Record<string, unknown>).properties
    if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return []
    const sheetId = (properties as Record<string, unknown>).sheetId
    const title = (properties as Record<string, unknown>).title
    return typeof sheetId === "number" && typeof title === "string" ? [{ sheetId, title }] : []
  })
}

function presentationPageIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.slides)) return []
  return value.slides.flatMap((slide) => {
    if (typeof slide !== "object" || slide === null || Array.isArray(slide)) return []
    const objectId = (slide as Record<string, unknown>).objectId
    return typeof objectId === "string" && objectId ? [objectId] : []
  })
}

async function batchUpdate(context: NativeGoogleApiContext, operation: string, path: string, requests: unknown[]): Promise<void> {
  if (!requests.length) return
  await googleJson(context, operation, apiUrl(context.apiBase, path), {
    method: "POST",
    body: JSON.stringify({ requests }),
  })
}

async function replaceDocument(context: NativeGoogleApiContext, documentId: string, text: string, currentEndIndex: number | null): Promise<void> {
  await batchUpdate(context, "Google Docs content update", `/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, buildDocumentReplacementRequests(text, currentEndIndex))
}

async function writeSpreadsheetValues(context: NativeGoogleApiContext, spreadsheetId: string, sheetName: string, values: NativeGoogleFileContent & { type: "spreadsheet" }): Promise<void> {
  const range = spreadsheetA1Range(sheetName)
  await googleJson(context, "Google Sheets values clear", apiUrl(context.apiBase, `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`), {
    method: "POST",
    body: "{}",
  })
  const url = apiUrl(context.apiBase, `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`)
  url.searchParams.set("valueInputOption", "RAW")
  await googleJson(context, "Google Sheets values update", url, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values: values.values }),
  })
}

async function replacePresentation(context: NativeGoogleApiContext, presentationId: string, existingPageIds: string[], slides: Array<{ title: string; body: string }>): Promise<void> {
  await batchUpdate(
    context,
    "Google Slides content update",
    `/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
    buildPresentationReplacementRequests({ existingPageIds, slides }),
  )
}

async function driveMetadata(context: NativeGoogleApiContext, fileId: string): Promise<NativeGoogleFileMetadata> {
  const url = apiUrl(context.driveApiBase, `/drive/v3/files/${encodeURIComponent(fileId)}`)
  url.searchParams.set("fields", "id,name,mimeType,modifiedTime,webViewLink,size")
  const value = await googleJson(context, "Google Drive file metadata", url)
  return {
    id: requiredString(value, "id", "Google Drive file metadata"),
    name: requiredString(value, "name", "Google Drive file metadata"),
    mimeType: requiredString(value, "mimeType", "Google Drive file metadata"),
    modifiedTime: requiredString(value, "modifiedTime", "Google Drive file metadata"),
    webViewLink: requiredString(value, "webViewLink", "Google Drive file metadata"),
    size: typeof value.size === "string" ? value.size : null,
  }
}

async function updateDrivePlacement(context: NativeGoogleApiContext, fileId: string, input: { name?: string; folderId?: string }): Promise<NativeGoogleFileMetadata> {
  if (!input.name && !input.folderId) return driveMetadata(context, fileId)
  const parentsUrl = apiUrl(context.driveApiBase, `/drive/v3/files/${encodeURIComponent(fileId)}`)
  parentsUrl.searchParams.set("fields", "parents")
  const current = await googleJson(context, "Google Drive parent read", parentsUrl)
  const currentParents = Array.isArray(current.parents)
    ? current.parents.filter((value): value is string => typeof value === "string")
    : []
  const url = apiUrl(context.driveApiBase, `/drive/v3/files/${encodeURIComponent(fileId)}`)
  if (input.folderId) {
    const move = driveFolderMoveParameters(currentParents, input.folderId)
    if (move.addParents) url.searchParams.set("addParents", move.addParents)
    if (move.removeParents) url.searchParams.set("removeParents", move.removeParents)
  }
  url.searchParams.set("fields", "id,name,mimeType,modifiedTime,webViewLink,size")
  const value = await googleJson(context, "Google Drive file placement", url, {
    method: "PATCH",
    body: JSON.stringify(input.name ? { name: input.name } : {}),
  })
  return {
    id: requiredString(value, "id", "Google Drive file placement"),
    name: requiredString(value, "name", "Google Drive file placement"),
    mimeType: requiredString(value, "mimeType", "Google Drive file placement"),
    modifiedTime: requiredString(value, "modifiedTime", "Google Drive file placement"),
    webViewLink: requiredString(value, "webViewLink", "Google Drive file placement"),
    size: typeof value.size === "string" ? value.size : null,
  }
}

export async function createNativeGoogleFile(input: NativeGoogleFileCreateInput, context: NativeGoogleApiContext): Promise<NativeGoogleFileMetadata> {
  let fileId: string
  if (input.type === "document") {
    const created = await googleJson(context, "Google Docs create", apiUrl(context.apiBase, "/v1/documents"), {
      method: "POST",
      body: JSON.stringify({ title: input.name }),
    })
    fileId = requiredString(created, "documentId", "Google Docs create")
    await replaceDocument(context, fileId, input.text, null)
  } else if (input.type === "spreadsheet") {
    const created = await googleJson(context, "Google Sheets create", apiUrl(context.apiBase, "/v4/spreadsheets"), {
      method: "POST",
      body: JSON.stringify({ properties: { title: input.name }, sheets: [{ properties: { title: input.sheetName } }] }),
    })
    fileId = requiredString(created, "spreadsheetId", "Google Sheets create")
    await writeSpreadsheetValues(context, fileId, input.sheetName, input)
  } else {
    const created = await googleJson(context, "Google Slides create", apiUrl(context.apiBase, "/v1/presentations"), {
      method: "POST",
      body: JSON.stringify({ title: input.name }),
    })
    fileId = requiredString(created, "presentationId", "Google Slides create")
    await replacePresentation(context, fileId, presentationPageIds(created), input.slides)
  }
  return updateDrivePlacement(context, fileId, { folderId: input.folderId })
}

export async function updateNativeGoogleFile(fileId: string, input: NativeGoogleFileUpdateInput, context: NativeGoogleApiContext): Promise<NativeGoogleFileMetadata> {
  if (input.type === "document") {
    const current = await googleJson(context, "Google Docs read", apiUrl(context.apiBase, `/v1/documents/${encodeURIComponent(fileId)}`))
    await replaceDocument(context, fileId, input.text, documentEndIndex(current))
  } else if (input.type === "spreadsheet") {
    const url = apiUrl(context.apiBase, `/v4/spreadsheets/${encodeURIComponent(fileId)}`)
    url.searchParams.set("fields", "sheets(properties(sheetId,title))")
    const current = await googleJson(context, "Google Sheets read", url)
    const sheets = spreadsheetSheets(current)
    if (!sheets.length) throw new NativeGoogleFileApiError("Google Sheets read", 502, "Google returned no sheets.")
    await batchUpdate(context, "Google Sheets structure update", `/v4/spreadsheets/${encodeURIComponent(fileId)}:batchUpdate`, buildSpreadsheetStructureRequests({ sheets, sheetName: input.sheetName }))
    await writeSpreadsheetValues(context, fileId, input.sheetName, input)
  } else {
    const current = await googleJson(context, "Google Slides read", apiUrl(context.apiBase, `/v1/presentations/${encodeURIComponent(fileId)}`))
    await replacePresentation(context, fileId, presentationPageIds(current), input.slides)
  }
  return updateDrivePlacement(context, fileId, { name: input.name, folderId: input.folderId })
}
