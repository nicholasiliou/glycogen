import { useCallback, useState } from "react";
import type { AudioEngine } from "@/audio/AudioEngine";
import type { ScaleName } from "@/audio/scale";

export function useAudioTransport(audio: AudioEngine) {
  const [started, setStarted] = useState(false);
  const [master, setMasterState] = useState(0.9);
  const [bpm, setBpmState] = useState(110);
  const [root, setRoot] = useState(48);
  const [scale, setScale] = useState<ScaleName>("minorPentatonic");

  const startAudio = useCallback(async () => {
    await audio.start();
    audio.setBpm(bpm);
    audio.setKey(root, scale);
    audio.setMasterLevel(master);
    setStarted(true);
  }, [audio, bpm, root, scale, master]);

  const setMaster = useCallback((v: number) => { setMasterState(v); audio.setMasterLevel(v); }, [audio]);
  const setBpm = useCallback((v: number) => { setBpmState(v); audio.setBpm(v); }, [audio]);
  const setKey = useCallback((r: number, s: ScaleName) => { setRoot(r); setScale(s); audio.setKey(r, s); }, [audio]);

  return { started, startAudio, master, setMaster, bpm, setBpm, root, scale, setKey };
}
