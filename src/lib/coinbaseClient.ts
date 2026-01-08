// src/lib/coinbaseClient.ts

export interface OnrampInitInput {
  amount_cents: number
  currency: string
  wallet_address?: string
  network?: string
  user_id?: string
  privy_user_id?: string
  metadata?: Record<string, unknown>
}

export interface OnrampInitResponse {
  session_token?: string
  onramp_url?: string
  session?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OnrampQuoteInput {
  amount_cents: number
  currency: string
  network?: string
}

export interface OnrampQuoteResponse {
  quote?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OnrampStatusInput {
  session_id: string
  sync?: boolean
}

export interface OnrampStatusResponse {
  status?: string
  session?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OnrampCancelInput {
  session_id: string
}

export interface OnrampCancelResponse {
  ok?: boolean
  session?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OfframpInitInput {
  amount: number
  currency: string
  address: string
  network?: string
  note?: string
  user_id?: string
  privy_user_id?: string
}

export interface OfframpInitResponse {
  payout_id?: string
  session?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OfframpQuoteInput {
  amount: number
  currency: string
  address: string
  network?: string
}

export interface OfframpQuoteResponse {
  quote?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OfframpStatusInput {
  payout_id: string
  sync?: boolean
}

export interface OfframpStatusResponse {
  status?: string
  payout?: Record<string, unknown>
  error?: string
  details?: string
}

export interface OfframpCancelInput {
  payout_id: string
}

export interface OfframpCancelResponse {
  ok?: boolean
  payout?: Record<string, unknown>
  error?: string
  details?: string
}

type Fetcher = (input: RequestInfo, init?: RequestInit) => Promise<Response>

export interface CoinbaseEdgeClientOptions {
  baseUrl: string // e.g., https://<project-ref>.functions.supabase.co
  getAuthToken?: () => Promise<string | null> | string | null // optional
  fetch?: Fetcher // optional custom fetch (for SSR/tests)
  defaultHeaders?: Record<string, string>
}

export class CoinbaseEdgeClient {
  private baseUrl: string
  private getAuthToken?: CoinbaseEdgeClientOptions['getAuthToken']
  private fetchFn: Fetcher
  private defaultHeaders: Record<string, string>

  constructor(opts: CoinbaseEdgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.getAuthToken = opts.getAuthToken
    this.fetchFn = opts.fetch ?? fetch
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...(opts.defaultHeaders ?? {}),
    }
  }

  private async headers(extra?: Record<string, string>) {
    const h: Record<string, string> = { ...this.defaultHeaders, ...(extra ?? {}) }
    if (this.getAuthToken) {
      const token = await this.getAuthToken()
      if (token) h['Authorization'] = `Bearer ${token}`
    }
    return h
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let data: unknown
    try { data = text ? JSON.parse(text) : {} } catch { data = { error: 'Invalid JSON response', raw: text } }
    if (!res.ok) {
      const err = typeof data === 'object' && data && 'error' in data ? (data as any).error : `HTTP ${res.status}`
      const details = typeof data === 'object' && data && 'details' in data ? (data as any).details : text
      throw new Error(`${err}${details ? `: ${details}` : ''}`)
    }
    return data as T
  }

  // Onramp
  onrampInit(input: OnrampInitInput) {
    return this.post<OnrampInitResponse>('/onramp-init', input)
  }

  onrampQuote(input: OnrampQuoteInput) {
    return this.post<OnrampQuoteResponse>('/onramp-quote', input)
  }

  onrampStatus(input: OnrampStatusInput) {
    return this.post<OnrampStatusResponse>('/onramp-status', input)
  }

  onrampCancel(input: OnrampCancelInput) {
    return this.post<OnrampCancelResponse>('/onramp-cancel', input)
  }

  // Offramp
  offrampInit(input: OfframpInitInput) {
    return this.post<OfframpInitResponse>('/offramp-init', input)
  }

  offrampQuote(input: OfframpQuoteInput) {
    return this.post<OfframpQuoteResponse>('/offramp-quote', input)
  }

  offrampStatus(input: OfframpStatusInput) {
    return this.post<OfframpStatusResponse>('/offramp-status', input)
  }

  offrampCancel(input: OfframpCancelInput) {
    return this.post<OfframpCancelResponse>('/offramp-cancel', input)
  }
}
