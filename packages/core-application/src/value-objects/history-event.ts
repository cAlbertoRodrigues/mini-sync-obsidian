import type { FileMetadata } from "./file-metadata";
import crypto from "crypto";

export type HistoryEvent = {
    id: string;
    occurredAtIso: string;
    origin: string;
    change: FileMetadata;

    
}

export function createHistoryEvent(
    change: FileMetadata,
    origin: string = "local",
): HistoryEvent {
    return {
        id: crypto.randomUUID(),
        occurredAtIso: new Date().toISOString(),
        origin,
        change,
    };
}