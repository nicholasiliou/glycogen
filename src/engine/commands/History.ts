export interface Command {
  label: string;
  do(): void;
  undo(): void;
  /**
   * Commands sharing a coalesceKey issued in quick succession collapse into one
   * undo step (e.g. dragging a slider = one undo, not hundreds). The first
   * command's `undo` is preserved (restores the pre-drag state) while later `do`s
   * replace the redo action.
   */
  coalesceKey?: string;
}

/**
 * Linear undo/redo stack with time-based coalescing. The engine routes every
 * mutation through here, which is what makes the whole editor undoable for free.
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private lastAt = 0;
  private readonly limit = 300;
  private readonly coalesceWindowMs = 700;

  constructor(private readonly onChange: () => void) {}

  execute(cmd: Command): void {
    cmd.do();
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const canMerge =
      top &&
      cmd.coalesceKey &&
      top.coalesceKey === cmd.coalesceKey &&
      now - this.lastAt < this.coalesceWindowMs;

    if (canMerge) {
      top.do = cmd.do; // redo replays the latest value…
      // …but keep top.undo so undo rolls back to before the gesture began.
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.lastAt = now;
    this.redoStack = [];
    this.onChange();
  }

  /** Run a mutation without recording it (used during deserialization, etc.). */
  silent(fn: () => void): void {
    fn();
    this.onChange();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.lastAt = 0; // break any coalescing chain
    this.onChange();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do();
    this.undoStack.push(cmd);
    this.onChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastAt = 0;
    this.onChange();
  }
}
