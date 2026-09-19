/**
 * The ship kit as the server sends it (`GET /v1/projects/{key}/kit`, docs/ship-kit.md) and the
 * phone's requests for a demo (`/v1/demos/requests`). The document's shape is the spec's
 * (`KitDocument`, generated); the file list and the request rows are the route's own.
 */
import type { KitDocument, KitSlot, RequestRefusal, RequestStatus } from '../generated/shipkit';

export interface KitFileRow {
  id: string;
  slot: KitSlot;
  content_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'video/mp4';
  width: number;
  height: number;
  duration_ms: number | null;
  bytes: number;
  position: number;
  label: string | null;
  /** Relative on the local stack (read with the bearer), a presigned GET in production. */
  url: string;
}

export interface ShipKitResponse {
  document: KitDocument;
  published_at: string;
  files: KitFileRow[];
}

export interface DemoRequestRow {
  id: string;
  project_key: string;
  status: RequestStatus;
  refusal: RequestRefusal | null;
  hue: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}
