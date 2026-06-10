import { useState } from "react";
import { ChevronRight, Circle, Eye, EyeOff, Folder, Lock, LockOpen, Plus, X } from "lucide-react";
import type { Layer, LayerTypeDefinition } from "@/engine";
import { useEngine, useRevision, useSelection } from "@/ui/engine/EngineProvider";
import { cn } from "@/ui/lib/cn";
import { Button } from "@/ui/components/ui/button";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { LayerIcon } from "@/ui/components/LayerIcon";
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);

  const isContainer = (l: Layer) => {
    const k = engine.registry.get(l.type)?.kind;
    return k === "group" || k === "layout";
  };
  const hidden = (l: Layer) => {
    const seen = new Set<string>([l.id]);
    let p = l.parentId ? comp.find(l.parentId) : undefined;
    while (p && !seen.has(p.id)) {
      if (isContainer(p) && collapsed.has(p.id)) return true;
      seen.add(p.id);
      p = p.parentId ? comp.find(p.parentId) : undefined;
    }
    return false;
  };
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const expand = (id: string) =>
    setCollapsed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  // If exactly one container is selected, new layers (and the add-tree) drop INTO it.
  const addTarget =
    selection.length === 1 ? (() => { const l = comp.find(selection[0]); return l && isContainer(l) ? l : null; })() : null;

  const addLayer = (type: string) => {
    engine.addLayer(type, addTarget ? { parentId: addTarget.id } : undefined);
    if (addTarget) expand(addTarget.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge bg-panel px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Layers</span>
        <Button
          size="icon-sm"
          variant={adding ? "accent" : "ghost"}
          title={adding ? "Close" : "Add layer"}
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {adding && <AddLayerTree onAdd={addLayer} target={addTarget} />}

      <ScrollArea className="flex-1">
        <div className="py-1">
          {comp.layers.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] text-ink-dim">No layers. Add one ↑</div>
          )}
          {comp.layers.map((layer, i) =>
            hidden(layer) ? null : (
              <LayerRow
                key={layer.id}
                layer={layer}
                index={i}
                selected={selection.includes(layer.id)}
                container={isContainer(layer)}
                collapsed={collapsed.has(layer.id)}
                onToggleCollapse={() => toggle(layer.id)}
                onExpand={() => expand(layer.id)}
              />
            ),
          )}
          {comp.layers.length > 0 && <TopLevelDropZone />}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Inline, folder-like browser of addable layer types — it expands down inside the
 * panel instead of popping a menu, so containers can be drilled into one click at a time. */
function AddLayerTree({ onAdd, target }: { onAdd: (type: string) => void; target: Layer | null }) {
  const engine = useEngine();
  const categories = [...engine.registry.categories().entries()];
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (cat: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });

  return (
    <div className="max-h-[55%] shrink-0 overflow-y-auto border-b border-edge bg-panel-raised/40">
      {target && (
        <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent">
          <LayerIcon name={engine.registry.get(target.type)?.icon} className="h-3 w-3" />
          Adding into <span className="font-medium">{target.name}</span>
        </div>
      )}
      {categories.map(([cat, defs]) => {
        const isOpen = open.has(cat);
        return (
          <div key={cat}>
            <button
              className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] text-ink-dim hover:bg-panel-raised hover:text-ink"
              onClick={() => toggle(cat)}
            >
              <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
              <Folder className="h-3.5 w-3.5 shrink-0 text-accent/70" />
              <span className="flex-1 font-medium uppercase tracking-wide">{cat}</span>
              <span className="text-[9px] text-ink-dim/60">{defs.length}</span>
            </button>
            {isOpen &&
              defs.map((def: LayerTypeDefinition) => (
                <button
                  key={def.type}
                  title={def.description}
                  className="flex w-full items-center gap-1.5 py-1 pl-8 pr-2 text-left text-xs text-ink-dim hover:bg-accent/15 hover:text-ink"
                  onClick={() => onAdd(def.type)}
                >
                  <LayerIcon name={def.icon} className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate">{def.label}</span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Drop zone at the bottom of the stack — drag a layer here to pull it back out to the
 * top level (un-parent it from any container). */
function TopLevelDropZone() {
  const engine = useEngine();
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn(
        "mx-1.5 mt-1 h-6 rounded border border-dashed text-center text-[10px] leading-6 transition-colors",
        over ? "border-accent bg-accent/10 text-accent" : "border-edge/40 text-transparent",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/layer-id");
        if (id) engine.moveLayerTo(id, null, engine.comp.layers.length - 1);
      }}
    >
      Move to top level
    </div>
  );
}

function LayerRow({
  layer,
  index,
  selected,
  container,
  collapsed,
  onToggleCollapse,
  onExpand,
}: {
  layer: Layer;
  index: number;
  selected: boolean;
  container: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onExpand: () => void;
}) {
  const engine = useEngine();
  const [renaming, setRenaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const depth = engine.comp.ancestry(layer).length;

  const onClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) engine.toggleSelect(layer.id);
    else engine.select([layer.id]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const id = e.dataTransfer.getData("text/layer-id");
    if (!id || id === layer.id) return;
    const comp = engine.comp;
    if (container) {
      // Drop INSIDE this container (parent it + slot it just under the container row).
      engine.moveLayerTo(id, layer.id, comp.indexOf(layer.id) + 1);
      onExpand();
    } else {
      // Reorder next to this row, adopting its parent (so it joins the same container).
      engine.moveLayerTo(id, layer.parentId, comp.indexOf(layer.id));
    }
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
          onDrop={onDrop}
          onClick={onClick}
          className={cn(
            "group flex h-7 items-center gap-1 px-1.5 text-xs",
            selected ? "bg-accent/15 text-ink" : "text-ink-dim hover:bg-panel-raised/60",
            dragOver && (container ? "bg-accent/10 ring-1 ring-inset ring-accent/70" : "border-t border-accent"),
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
          {container ? (
            <button
              className="flex h-4 w-3 shrink-0 items-center justify-center text-ink-dim hover:text-ink"
              title={collapsed ? "Expand" : "Collapse"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
            >
              <span className={cn("text-[8px] transition-transform", collapsed ? "" : "rotate-90")}>▶</span>
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
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
        <ContextMenuItem onSelect={() => engine.layoutLayers(pickSelection(engine, layer.id))}>Auto-layout selection</ContextMenuItem>
        {layer.parentId && (
          <ContextMenuItem onSelect={() => engine.moveLayerTo(layer.id, null, engine.comp.layers.length - 1)}>
            Remove from container
          </ContextMenuItem>
        )}
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
