import { Project } from "../scene/Project";

export const PROJECT_FORMAT = "marathon-project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  project: unknown;
}

export function serializeProject(project: Project): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    project: project.toJSON(),
  };
}

export function deserializeProject(file: unknown): Project {
  const f = file as Partial<ProjectFile>;
  if (!f || f.format !== PROJECT_FORMAT) {
    throw new Error("Not a Marathon project file");
  }
  if ((f.version ?? 0) > PROJECT_VERSION) {
    console.warn(`[io] project version ${f.version} is newer than ${PROJECT_VERSION}; attempting to load anyway`);
  }
  return Project.fromJSON(f.project);
}
