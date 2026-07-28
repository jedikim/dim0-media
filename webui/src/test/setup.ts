/**
 * Vitest global setup. Patches `globalThis.indexedDB` (+ IDBKeyRange, etc.) with
 * the in-memory `fake-indexeddb` implementation so persistence code runs in
 * Node/jsdom without a browser. Tests reset state with a fresh `IDBFactory`.
 */
import "fake-indexeddb/auto"
