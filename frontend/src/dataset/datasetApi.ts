// The admin's dataset collector on the server (backend/app/dataset.py). Admin only: the server
// refuses everyone else. Self-contained: nothing outside src/dataset and pages/DatasetPage uses it.

import { ApiError, apiRequest } from '../api/client'

export type GuitarType = 'acoustic' | 'classical' | 'electric' | 'other'
export type StringMaterial = 'steel' | 'nylon' | 'unknown'
export type Noise = 'quiet' | 'moderate' | 'noisy'
export type PluckMethod = 'finger' | 'pick'
export type PluckStrength = 'soft' | 'medium' | 'strong'
export type Device = 'phone' | 'tablet' | 'laptop' | 'other'
export type ReviewStatus = 'accepted' | 'needs_review' | 'rejected'

export type DatasetGuitar = {
  id: string
  name: string
  guitarType: GuitarType
  stringMaterial: StringMaterial
  /** Which strings are wound (null: not known). */
  woundStrings: number[] | null
  samples: number
}

export type NewGuitar = Omit<DatasetGuitar, 'id' | 'samples'>

export type PositionCount = { stringNumber: number; fret: number; count: number }

export type SampleMeta = {
  guitarId: string
  stringNumber: number
  fret: number
  backgroundNoise: Noise
  pluckMethod: PluckMethod
  pluckStrength: PluckStrength
  device: Device | null
  notes?: string | null
  pluckAtMs: number | null
  capture: Record<string, string | number | boolean | null>
}

export type DatasetSample = {
  id: string
  guitarId: string
  guitarName: string
  guitarType: GuitarType
  stringMaterial: StringMaterial
  stringNumber: number
  fret: number
  position: string
  expectedMidi: number
  expectedNote: string
  expectedHz: number
  stringConstruction: 'wound' | 'unwound' | 'unknown'
  backgroundNoise: Noise
  pluckMethod: PluckMethod
  pluckStrength: PluckStrength
  device: Device | null
  notes: string | null
  audioKey: string
  audioFormat: string
  sampleRate: number
  bitDepth: number
  channels: number
  durationMs: number
  audioBytes: number
  peak: number
  pluckAtMs: number | null
  status: ReviewStatus
  recordedAt: string
}

export type SampleFilters = {
  guitarId?: string
  stringNumber?: number
  fret?: number
  stringMaterial?: StringMaterial
  backgroundNoise?: Noise
  status?: ReviewStatus
}

export type SamplePage = { items: DatasetSample[]; total: number; page: number; pageSize: number }

const BASE = '/api/dataset'

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** A request apiRequest cannot make (a file upload, or a file download): same rules and messages. */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'X-Requested-With': 'fetch' } })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Please check your internet connection and try again.')
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : null
    throw new ApiError(response.status, detail ?? 'Something went wrong on the server. Please try again in a moment.')
  }
  return response
}

export const listGuitars = () => apiRequest<DatasetGuitar[]>(`${BASE}/guitars`)

export const addGuitar = (guitar: NewGuitar) => apiRequest<DatasetGuitar>(`${BASE}/guitars`, { method: 'POST', body: guitar })

export const guitarProgress = (guitarId: string) => apiRequest<PositionCount[]>(`${BASE}/guitars/${guitarId}/progress`)

/** Saves one reviewed pluck. Resolves only when both the audio and its labels are saved. */
export async function saveSample(audio: Blob, meta: SampleMeta): Promise<{ sample: DatasetSample; countAtPosition: number }> {
  const form = new FormData()
  form.append('audio', audio, 'pluck.wav')
  form.append('meta', JSON.stringify(meta))
  return (await send(`${BASE}/samples`, { method: 'POST', body: form })).json()
}

export const listSamples = (filters: SampleFilters, page: number, pageSize = 20) =>
  apiRequest<SamplePage>(`${BASE}/samples${query({ ...filters, page, pageSize })}`)

/** A link to play the sample (signed, works for a few minutes). */
export const audioUrl = async (sampleId: string) => (await apiRequest<{ url: string }>(`${BASE}/samples/${sampleId}/audio-url`)).url

export const changeSample = (sampleId: string, change: { status?: ReviewStatus; notes?: string | null }) =>
  apiRequest<DatasetSample>(`${BASE}/samples/${sampleId}`, { method: 'PATCH', body: change })

export const deleteSample = (sampleId: string) => apiRequest<void>(`${BASE}/samples/${sampleId}`, { method: 'DELETE' })

/** Labels and storage keys of the matching samples, as a file (no audio inside). */
export async function exportSamples(filters: SampleFilters, format: 'csv' | 'jsonl'): Promise<Blob> {
  return (await send(`${BASE}/export${query({ ...filters, format })}`)).blob()
}
