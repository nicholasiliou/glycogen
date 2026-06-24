export type Listener<T> = (payload: T) => void;
export type AnyListener<Events> = <K extends keyof Events>(type: K, payload: Events[K]) => void;

/**
 * Minimal typed pub/sub. Every subsystem communicates through an Emitter rather
 * than calling into siblings directly — this is the "event-driven" backbone that
 * keeps the engine, plugins and UI decoupled (microservice-inspired boundaries).
 */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();
  private anyListeners = new Set<AnyListener<Events>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<unknown>);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(fn as Listener<unknown>);
  }

  /** Subscribe to every event — used by the React bridge to re-sync on any change. */
  onAny(fn: AnyListener<Events>): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (set) for (const fn of [...set]) (fn as Listener<Events[K]>)(payload);
    for (const fn of [...this.anyListeners]) fn(type, payload);
  }
}
