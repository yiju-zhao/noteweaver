import { Patch } from "./model";
export interface Writer {
  read(path: string): Promise<string | null>;
  write(patch: Patch): Promise<void>;
}
export async function applyChanges(writer: Writer, changes: Patch[]) {
  for (const p of changes)
    if ((await writer.read(p.path)) !== p.before)
      throw new Error(`file changed since planning: ${p.path}`);
  for (const p of changes) await writer.write(p);
}
