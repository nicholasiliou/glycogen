import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Engine } from "@/engine";
import type { Composition } from "@/engine";

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: React.ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine must be used within <EngineProvider>");
  return engine;
}

/**
 * Subscribe to structural engine changes. Returns a monotonically increasing
 * revision number — a *primitive*, so useSyncExternalStore never loops. Components
 * call this then read live engine state directly in render. Deliberately excludes
 * the 60fps clock (see useTime) so editing the timeline doesn't re-render everything.
 */
export function useRevision(): number {
  const engine = useEngine();
  const ver = useRef(0);
  const subscribe = useCallback(
    (cb: () => void) =>
      engine.subscribe(() => {
        ver.current++;
        cb();
      }),
    [engine],
  );
  return useSyncExternalStore(
    subscribe,
    () => ver.current,
    () => ver.current,
  );
}

export interface TimeState {
  time: number;
  frame: number;
  playing: boolean;
}

/** High-frequency clock subscription, isolated from the structural store. */
export function useTime(): TimeState {
  const engine = useEngine();
  const [t, setT] = useState<TimeState>(() => ({
    time: engine.transport.time,
    frame: engine.transport.frame,
    playing: engine.transport.playing,
  }));
  useEffect(() => engine.onTime(setT), [engine]);
  // Also resync when transport state flips via the structural bus (play/pause button).
  useEffect(
    () =>
      engine.subscribe(() =>
        setT({
          time: engine.transport.time,
          frame: engine.transport.frame,
          playing: engine.transport.playing,
        }),
      ),
    [engine],
  );
  return t;
}

export function useSelection(): string[] {
  useRevision();
  return useEngine().selection;
}

export function useActiveComposition(): Composition {
  useRevision();
  return useEngine().comp;
}
