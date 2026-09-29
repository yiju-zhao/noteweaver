/** The only private Obsidian interface used by the read-only property renderer.
 * Tested on 1.13.7. Wrapping render preserves native type inference/serialization;
 * neither ctx.onChange nor processFrontMatter is exposed to the display layer. */
import { Keymap, Notice, Plugin, setIcon, TFile } from "obsidian";
import { readFrontmatter } from "./core";
import { evidencePath, NESTED_KEYS, renderNested, type EvidenceLink } from "./nested";

const PROPERTY_ICONS: Record<string, string> = {
  generated: "history", sources: "book-open", verified: "badge-check",
};

interface Context { key?: string; sourcePath?: string }
interface Widget {
  type: string;
  render(el: HTMLElement, value: unknown, context: Context): unknown;
}
interface Manager {
  registeredTypeWidgets: Record<string, Widget>;
  getWidget(type: string): Widget;
}
interface PropertyEditor {
  serialize(): unknown;
  synchronize(value: unknown): void;
}

function redraw(plugin: Plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const editor = (leaf.view as unknown as { metadataEditor?: PropertyEditor }).metadataEditor;
    if (!editor || typeof editor.serialize !== "function" || typeof editor.synchronize !== "function") continue;
    const data = editor.serialize();
    editor.synchronize({});
    editor.synchronize(data);
  }
}

export function installReadonlyProperties(plugin: Plugin, isBankPage: (file: TFile) => boolean, evidenceRoot = () => "evidence"): boolean {
  const manager = (plugin.app as unknown as { metadataTypeManager?: Manager }).metadataTypeManager;
  if (!manager || typeof manager.getWidget !== "function" || !manager.registeredTypeWidgets) return false;
  const unknownWidget = manager.getWidget("unknown");
  if (typeof unknownWidget?.render !== "function") return false;
  const widgets = new Set([unknownWidget, ...Object.values(manager.registeredTypeWidgets)]);
  const restore: Array<() => void> = [];
  const pending = new WeakMap<HTMLElement, object>();
  let active = true;
  for (const widget of widgets) {
    if (typeof widget?.render !== "function") continue;
    const original = widget.render;
    const wrapped: Widget["render"] = function (this: Widget, el, value, ctx) {
      const file = ctx.sourcePath && plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!active || !ctx.key || !NESTED_KEYS.has(ctx.key) || !(file instanceof TFile) || !isBankPage(file)) {
        pending.delete(el);
        if (el.classList.contains("kb-nested")) {
          el.classList.remove("kb-nested");
          el.removeAttribute("aria-label");
        }
        return original.call(this, el, value, ctx);
      }
      const key = ctx.key;
      const token = {};
      pending.set(el, token);
      el.replaceChildren();
      el.classList.add("kb-nested");
      el.textContent = "读取中…";
      // Source parsing uses failsafe YAML so the presentation also keeps lexical
      // quantities and timestamps. The native cache's parsed numbers are unused.
      void plugin.app.vault.cachedRead(file).then(async (text) => {
        if (!active || pending.get(el) !== token || !el.isConnected) return;
        // Native metadata rows use the unknown-type icon for nested YAML. Change
        // only this rendered bank property, keeping the shared widget/type intact.
        const icon = el.closest(".metadata-property")?.querySelector<HTMLElement>(".metadata-property-icon");
        if (icon) setIcon(icon, PROPERTY_ICONS[key]);
        const { data, error } = readFrontmatter(text);
        if (error) { el.textContent = error; return; }
        const links = new Map<string, EvidenceLink>();
        const sources = key === "sources" && Array.isArray(data?.sources) ? data.sources : [];
        await Promise.all(sources.map(async (entry: unknown) => {
          if (!entry || typeof entry !== "object" || !("resource" in entry)) return;
          const path = evidencePath(file.path, entry.resource, evidenceRoot());
          const target = path && plugin.app.vault.getAbstractFileByPath(path);
          if (!path || !(target instanceof TFile)) return;
          // Layout can become ready before a newly created card is indexed.
          const cached = plugin.app.metadataCache.getFileCache(target);
          const fm = cached ? cached.frontmatter : readFrontmatter(await plugin.app.vault.cachedRead(target)).data;
          if (fm?.type === "source" || fm?.type === "record") {
            links.set(path, { path, title: typeof fm.title === "string" ? fm.title : target.basename });
          }
        }));
        if (!active || pending.get(el) !== token || !el.isConnected) return;
        renderNested(el, key, data?.[key], file.path, (path) => links.get(path), (link, event) => {
          const target = plugin.app.vault.getAbstractFileByPath(link.path);
          if (!(target instanceof TFile)) { new Notice("证据卡片已不存在，请检查来源路径"); return; }
          void plugin.app.workspace.getLeaf(event.button === 1 || Keymap.isModEvent(event) ? "tab" : false).openFile(target);
        }, evidenceRoot());
      }).catch((error: Error) => { if (active && pending.get(el) === token) el.textContent = `读取失败：${error.message}`; });
      return { type: widget.type, focus: () => el.querySelector<HTMLElement>("summary, a")?.focus() };
    };
    widget.render = wrapped;
    restore.push(() => { if (widget.render === wrapped) widget.render = original; });
  }
  plugin.register(() => {
    active = false;
    restore.reverse().forEach((f) => f());
    redraw(plugin);
  });
  redraw(plugin);
  return true;
}
