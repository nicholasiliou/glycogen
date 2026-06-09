/**
 * Collision-resistant short ids for editor-session entities.
 * Not meant to be globally unique forever — just stable within a project.
 */
export function uid(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${rand}${time}`;
}
