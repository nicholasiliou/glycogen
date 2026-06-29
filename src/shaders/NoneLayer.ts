import { Plugin, type Frame } from "@/plugins/Plugin";

/** Passthrough shader: does nothing, returns the input unchanged. */
export class NoneLayer extends Plugin {
  render(f: Frame): HTMLCanvasElement | null {
    return f.input;
  }
}
