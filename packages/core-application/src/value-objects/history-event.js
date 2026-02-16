import crypto from "crypto";
export function createHistoryEvent(change, origin = "local") {
    return {
        id: crypto.randomUUID(),
        occurredAtIso: new Date().toISOString(),
        origin,
        change,
    };
}
