const isQuotaExceededError = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014;

export class SafeStorage {
  #storage = null;
  #memory = new Map();
  #usingMemory = false;

  constructor(storage) {
    if (storage !== undefined) {
      this.#storage = storage;
      this.#usingMemory = storage === null;
      return;
    }

    try {
      this.#storage = globalThis.localStorage;
      this.#usingMemory = !this.#storage;
    } catch {
      this.#usingMemory = true;
    }
  }

  getItem(key, fallback = null) {
    const normalizedKey = String(key);
    let serialized = null;

    if (this.#usingMemory) {
      serialized = this.#memory.get(normalizedKey) ?? null;
    } else {
      try {
        serialized = this.#storage.getItem(normalizedKey);
        if (serialized !== null) {
          this.#memory.set(normalizedKey, serialized);
        }
      } catch {
        this.#switchToMemory();
        serialized = this.#memory.get(normalizedKey) ?? null;
      }
    }

    if (serialized === null) {
      return fallback;
    }

    try {
      return JSON.parse(serialized);
    } catch {
      return fallback;
    }
  }

  setItem(key, value) {
    const normalizedKey = String(key);
    let serialized;

    try {
      serialized = JSON.stringify(value);
    } catch {
      return false;
    }

    if (serialized === undefined) {
      return false;
    }

    this.#memory.set(normalizedKey, serialized);

    if (this.#usingMemory) {
      return true;
    }

    try {
      this.#storage.setItem(normalizedKey, serialized);
      return true;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        this.#switchToMemory();
        return true;
      }

      this.#switchToMemory();
      return true;
    }
  }

  clear() {
    this.#memory.clear();

    if (this.#usingMemory) {
      return true;
    }

    try {
      this.#storage.clear();
      return true;
    } catch {
      this.#switchToMemory();
      return false;
    }
  }

  #switchToMemory() {
    this.#usingMemory = true;
    this.#storage = null;
  }
}
