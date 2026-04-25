// Shared types for the /api/search endpoint. Kept out of the route file
// because Next.js App Router only allows HTTP handlers (and `runtime` etc.)
// to be exported from `app/api/**/route.ts`.

export interface SearchHit {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  typeDisp?: string;
  score?: number;
}

export interface SearchApiResponse {
  hits: SearchHit[];
  cached?: boolean;
  error?: string;
}
