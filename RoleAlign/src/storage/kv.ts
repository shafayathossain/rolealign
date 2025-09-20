/**
 * RoleAlign — KV storage utility
 *
 * A thin wrapper around chrome.storage.local with:
 * - typed get/set/remove
 * - optional defaults
 * - subscriptions (reactive updates across extension contexts)
 */

export type KvValue = string | number | boolean | object | null;

export const kv = {
  /**
   * Get a value from storage.
   * @param key storage key
   * @param fallback value to return if missing
   */
  async get<T extends KvValue>(key: string, fallback: T): Promise<T> {
    const res = await chrome.storage.local.get(key);
    return (res[key] as T) ?? fallback;
  },

  /**
   * Set a value in storage.
   */
  async set<T extends KvValue>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  /**
   * Remove a key from storage.
   */
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },

  /**
   * Subscribe to changes for a specific key.
   * Returns an unsubscribe function.
   */
  subscribe<T extends KvValue>(
    key: string,
    cb: (newValue: T | undefined, oldValue: T | undefined) => void
  ): () => void {
    function handler(changes: { [key: string]: chrome.storage.StorageChange }, area: string) {
      if (area !== "local") return;
      if (key in changes) {
        const { newValue, oldValue } = changes[key];
        cb(newValue as T, oldValue as T);
      }
    }
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};
