// When the region writes its state to disk. Nothing stops the region on a browser reload, so
// whatever has not been saved is lost, and the schedule is the whole of the exposure window.
//
// Leading edge: the first mutating request after a quiet spell saves at once, because Glass
// Garden's traffic is hand-driven - a lone action would otherwise sit unsaved for the entire
// debounce. Trailing edge: the burst behind it is coalesced into one save. Max wait: sustained
// traffic cannot re-arm the debounce forever, so the deadline eventually fires it.
export class SaveScheduler {
  #save;
  #debounceMs;
  #maxWaitMs;
  #timer;
  #lastSaveAt = -Infinity;
  #stopped = false;
  #fire = () => {
    this.#timer = undefined;
    this.#run();
  };

  constructor({ save, debounceMs, maxWaitMs }) {
    this.#save = save;
    this.#debounceMs = debounceMs;
    this.#maxWaitMs = maxWaitMs;
  }

  // Called for every request that changed something
  arm() {
    if (this.#stopped) return;
    const sinceSave = Date.now() - this.#lastSaveAt;
    if (this.#timer === undefined && sinceSave >= this.#debounceMs) return this.#run();
    // A burst always starts within a debounce of the last save, so the deadline hangs off it
    clearTimeout(this.#timer);
    const wait = Math.max(Math.min(this.#debounceMs, this.#maxWaitMs - sinceSave), 0);
    this.#timer = setTimeout(this.#fire, wait);
  }

  // No further save, however the region is torn down: the caller writes the final state itself
  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
  }

  #run() {
    this.#save();
    this.#lastSaveAt = Date.now();
  }
}
