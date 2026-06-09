import { useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Plus, Circle } from "lucide-react";
import type { Layer } from "@/engine";
import { useEngine, useRevision, useSelection } from "@/ui/engine/EngineProvider";
import { cn } from "@/ui/lib/cn";
import { Button } from "@/ui/components/ui/button";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { LayerIcon } from "@/ui/components/LayerIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/components/ui/context-menu";

export function LayersPanel() {
  const engine = useEngine();
  useRevision();
  const selection = useSelection();
  const comp = engine.comp;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge bg-panel px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Layers</span>
        <AddLayerMenu />
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {comp.layers.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-ink-dim">No layers. Add one ↑</div>
          )}
          {comp.layers.map((layer, i) => (
            <LayerRow key={layer.id} layer={layer} index={i} selected={selection.includes(layer.id)} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function AddLayerMenu() {
  const engine = useEngine();
  const categories = engine.registry.categories();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" title="Add layer">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {[...categories.entries()].map(([cat, defs], i) => (
          <div key={cat}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{cat}</DropdownMenuLabel>
            {defs.map((def) => (
              <DropdownMenuItem key={def.type} onSelect={() => engine.addLayer(def.type)}>
                <LayerIcon name={def.icon} className="h-3.5 w-3.5 text-accent" />
                {def.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LayerRow({ layer, index, selected }: { layer: Layer; index: number; selected: boolean }) {
  const engine = useEngine();
  const [renaming, setRenaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const depth = engine.comp.ancestry(layer).length;

  const onClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) engine.toggleSelect(layer.id);
    else engine.select([layer.id]);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!renaming}
          onDragStart={(e) => e.dataTransfer.setData("text/layer-id", layer.id)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const id = e.dataTransfer.getData("text/layer-id");
            if (id && id !== layer.id) engine.reorderLayer(id, index);
          }}
          onClick={onClick}
          className={cn(
            "group flex h-7 items-center gap-1 px-1.5 text-xs",
            selected ? "bg-accent/15 text-ink" : "text-ink-dim hover:bg-panel-raised/60",
            dragOver && "border-t border-accent",
          )}
        >
          <IconToggle
            on={layer.enabled}
            onIcon={<Eye className="h-3.5 w-3.5" />}
            offIcon={<EyeOff className="h-3.5 w-3.5 opacity-50" />}
            onClick={() => engine.setLayerField(layer.id, "enabled", !layer.enabled)}
            title="Visibility"
          />
          <button
            title="Solo"
            className={cn("flex h-4 w-4 items-center justify-center", layer.solo ? "text-accent" : "text-ink-dim/40 hover:text-ink-dim")}
            onClick={(e) => {
              e.stopPropagation();
              engine.setLayerField(layer.id, "solo", !layer.solo);
            }}
          >
            <Circle className={cn("h-2.5 w-2.5", layer.solo && "fill-accent")} />
          </button>
          <IconToggle
            on={!layer.locked}
            onIcon={<LockOpen className="h-3.5 w-3.5 opacity-40" />}
            offIcon={<Lock className="h-3.5 w-3.5 text-accent" />}
            onClick={() => engine.setLayerField(layer.id, "locked", !layer.locked)}
            title="Lock"
          />

          <span style={{ width: depth * 12 }} className="shrink-0" />
          <LayerIcon name={engine.registry.get(layer.type)?.icon} className="h-3.5 w-3.5 shrink-0 text-ink-dim" />

          {renaming ? (
            <input
              autoFocus
              defaultValue={layer.name}
              className="min-w-0 flex-1 bg-panel-raised px-1 text-xs text-ink outline-none"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                engine.setLayerField(layer.id, "name", e.target.value || layer.name);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setRenaming(true)}>
              {layer.name}
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => engine.duplicateLayers(pickSelection(engine, layer.id))}>Duplicate</ContextMenuItem>
        <ContextMenuItem onSelect={() => engine.groupLayers(pickSelection(engine, layer.id))}>Group selection</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => engine.reorderLayer(layer.id, Math.max(0, index - 1))}>Bring forward</ContextMenuItem>
        <ContextMenuItem onSelect={() => engine.reorderLayer(layer.id, index + 1)}>Send backward</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-red-400" onSelect={() => engine.removeLayers(pickSelection(engine, layer.id))}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function IconToggle({
  on,
  onIcon,
  offIcon,
  onClick,
  title,
}: {
  on: boolean;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      className="flex h-4 w-4 items-center justify-center text-ink-dim hover:text-ink"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

/** Operate on the full selection when the right-clicked layer is part of it. */
function pickSelection(engine: ReturnType<typeof useEngine>, layerId: string): string[] {
  return engine.selection.includes(layerId) ? engine.selection : [layerId];
}
