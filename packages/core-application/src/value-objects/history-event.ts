import type { FileMetadata } from "./file-metadata";
import crypto from "crypto";

export type HistoryEventBlobRef = {
  sha256: string;
  sizeBytes: number;
  mime?: string;
};

export type HistoryEvent = {
  id: string;
  occurredAtIso: string;
  origin: "local" | "remote";
  change: FileMetadata;

  // Para texto pequeno (md/txt/json etc)
  contentUtf8?: string;

  // Para binário ou texto grande: referência ao blob/attachment
  blob?: HistoryEventBlobRef;
};

export function createHistoryEvent(
  change: FileMetadata,
  origin: "local" | "remote" = "local"
): HistoryEvent {
  return {
    id: crypto.randomUUID(),
    occurredAtIso: new Date().toISOString(),
    origin,
    change,
  };
}