import type { ObsidianBank } from "./bank/obsidian";
import { bankCommands, CommandResults, commandSummary } from "./commands";
import { Request } from "./bank/operations";
import { loadRegistry } from "./bank/registry";
import { INSTANCE_CONFIG, readVaultInstance, InstancePaths } from "./instance";
// Noteweaver: Obsidian glue for src/core.ts. The instance selects the vocabulary path.
// Private property APIs are isolated in property-adapter.ts.
import {
  App, debounce, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, getIcon,
  ItemView, MarkdownPostProcessorContext, Modal, moment, normalizePath, Notice, Plugin, PluginSettingTab, Setting,
  SuggestModal, TFile, WorkspaceLeaf,
} from "obsidian";
import * as core from "./core";
import { applyRelationPlan, checkRelations, planRelations, readRelationState, type RelationIssue, type RelationState } from "./relations";
import { installReadonlyProperties } from "./property-adapter";

const VIEW = "noteweaver-findings";

interface Settings { actor: string }
const DEFAULTS: Settings = { actor: "" };

export default class Noteweaver extends Plugin {
  readonly automationVersion = 1;
  private bank?: ObsidianBank;
  private commandResults = new CommandResults();
  commandResult(expectedId?: string) { return this.commandResults.result(expectedId); }
  private runBankCommand(id: string, request: Request) {
    void this.commandResults.start(id, () => this.runAutomation(request))
      .then(result => { new Notice(commandSummary(request, result), 8000); });
  }
  async runAutomation(request: Request) {
    const { ObsidianBank } = await import("./bank/obsidian");
    this.bank ??= new ObsidianBank(this.app);
    const result = await this.bank.run(request);
    if (result.changes.length) await this.syncRelations();
    return result;
  }
  settings: Settings = { ...DEFAULTS };
  schema: core.KbSchema | null = null;
  schemaError = "";
  private schemaMtime = -1;
  private schemaPath = "";
  private schemaBank = "";
  private evidenceRoot = "evidence";
  private statusEl!: HTMLElement;
  private styleEl: HTMLStyleElement | null = null;
  private created = new Map<string, number>();
  current: { path: string; findings: core.Finding[] } | null = null;
  all: Map<string, core.Finding[]> | null = null;
  private refreshSoon = debounce(() => void this.refresh(), 300, true);
  private syncSoon = debounce(() => void this.syncRelations(), 500, true);
  private relationState?: RelationState;
  private relationRenames = new Map<string, string>();
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private stopped = false;
  private lastRelationError = "";
  relationIssues: RelationIssue[] = [];

  async onload() {
    const saved = await this.loadData();
    this.settings = { actor: typeof saved?.actor === "string" ? saved.actor : DEFAULTS.actor };
    this.relationState = readRelationState(saved?.relations);
    this.addSettingTab(new NoteweaverSettings(this.app, this));
    this.registerView(VIEW, (leaf) => new FindingsView(leaf, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("noteweaver-status", "mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => void this.openView());
    this.registerMarkdownPostProcessor((el, ctx) => this.renderClaims(el, ctx));
    this.registerEditorSuggest(new FrontmatterSuggest(this));

    this.addCommand({ id: "set-value", name: "按 schema 设置属性值",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const spec = file && this.specFor(file);
        if (!file || !spec) return false;
        if (!checking) this.chooseKey(file, spec);
        return true;
      } });
    for (const command of bankCommands) this.addCommand({ id: command.id, name: command.name,
      callback: () => this.runBankCommand(command.id, { ...command.request }) });
    this.addCommand({ id: "refs", name: "列出当前页的全部入链", callback: () => {
      const file = this.app.workspace.getActiveFile();
      // Missing active page is an execution failure, also retained in commandResult.
      this.runBankCommand("refs", { operation: "refs", name: file?.basename });
    } });
    this.addCommand({ id: "check-frontmatter", name: "检查全库 frontmatter", callback: () => void this.checkVault() });
    this.addCommand({ id: "show-findings", name: "打开检查面板", callback: () => void this.openView() });
    this.addCommand({ id: "sync-relations", name: "同步全库双向关系", callback: () => void this.syncRelations(true) });
    this.addCommand({ id: "reload-schema", name: "重新读取 kb-schema.json",
      callback: async () => { this.schemaMtime = -1; await this.refresh(); await this.syncRelations();
        new Notice(this.schemaError || "Noteweaver：已重新读取 schema"); } });

    this.app.workspace.onLayoutReady(async () => {
      // Registered after the vault has loaded, so only files created from now on count as new.
      this.registerEvent(this.app.vault.on("create", (f) => { if (f instanceof TFile) this.created.set(f.path, Date.now()); }));
      this.registerEvent(this.app.workspace.on("file-open", (f) => void this.onOpen(f)));
      this.registerEvent(this.app.metadataCache.on("changed", (f) => {
        this.all?.delete(f.path);
        if (f.path === this.app.workspace.getActiveFile()?.path) this.refreshSoon();
        if (this.specFor(f)) this.syncSoon();
      }));
      this.registerEvent(this.app.vault.on("delete", (f) => {
        if (f instanceof TFile && this.specFor(f)) this.syncSoon();
      }));
      this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
        if (!(f instanceof TFile) || !this.schema) return;
        if (core.specFor(this.schema, oldPath) || this.specFor(f)) {
          const oldName = core.pageName(oldPath);
          if (oldName !== f.basename) this.relationRenames.set(oldName, f.basename);
          this.syncSoon();
        }
      }));
      await this.refresh();
      if (!installReadonlyProperties(this, (file) => Boolean(this.specFor(file)), () => this.evidenceRoot)) {
        new Notice("Noteweaver：当前 Obsidian 不支持只读嵌套展示，请在源码中查看 generated、sources、verified", 10000);
      }
      await this.syncRelations();
    });
  }

  onunload() {
    this.stopped = true;
    this.styleEl?.remove();
  }

  async saveSettings() {
    if (this.syncing) await this.syncing;
    await this.saveData({ ...this.settings, relations: this.relationState });
  }

  /** Serialize vault-wide reconciliation; native metadata events request another
   * pass, while our own writes converge to a no-op without a timer-based lock. */
  async syncRelations(notify = false) {
    if (this.stopped) return;
    if (this.syncing) { this.syncAgain = true; await this.syncing; return; }
    let writes = 0;
    this.syncing = (async () => {
      do {
        this.syncAgain = false;
        await this.loadSchema();
        if (!this.schema || this.stopped) return;
        const pages = await Promise.all(this.app.vault.getMarkdownFiles().filter((f) => this.specFor(f))
          .map(async (f) => ({ path: f.path, text: await this.app.vault.read(f) })));
        const plan = planRelations(this.schema, pages, this.relationState, this.relationRenames);
        this.relationIssues = plan.issues;
        this.renderStatus();
        this.views().forEach((v) => v.render());
        if (plan.issues.length) {
          const message = plan.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
          if (notify || message !== this.lastRelationError) new Notice(`Noteweaver：关系同步暂停\n${message}`, 10000);
          this.lastRelationError = message;
          return;
        }
        await applyRelationPlan(plan, {
          update: async (path, transform) => {
            if (this.stopped) throw new Error("插件已停止，未继续同步");
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new Error(`关系同步期间页面已移动或删除：${path}`);
            await this.app.vault.process(file, transform);
          },
          checkpoint: async (state) => {
            if (JSON.stringify(state) !== JSON.stringify(this.relationState)) {
              await this.saveData({ ...this.settings, relations: state });
              this.relationState = state;
            }
          },
        });
        writes += plan.patches.length;
        this.relationRenames.clear();
        this.lastRelationError = "";
      } while (this.syncAgain && !this.stopped);
    })();
    try {
      await this.syncing;
      if (notify && !this.relationIssues.length) new Notice(`Noteweaver：双向关系已同步，更新 ${writes} 页`);
    } catch (e) {
      // Do not checkpoint a partial write. Retry on the next edit or explicit sync;
      // the old agreed edges preserve the user's additions and removals.
      this.lastRelationError = (e as Error).message;
      new Notice(`Noteweaver：${this.lastRelationError}`, 10000);
    } finally {
      this.syncing = null;
      if (this.syncAgain && !this.stopped) this.syncSoon();
    }
  }

  // ---------------------------------------------------------------- schema and pages
  async loadSchema() {
    let path: string;
    let paths: InstancePaths;
    try {
      ({ paths } = await readVaultInstance(
        p => this.app.vault.adapter.read(p), p => this.app.vault.adapter.exists(p), this.app.vault.configDir));
      this.evidenceRoot = paths.evidence;
      path = normalizePath(paths.schema);
    } catch (error) {
      this.schema = null;
      this.schemaMtime = -1;
      this.schemaError = (error as Error).message;
      this.applyIcons();
      return;
    }
    const stat = await this.app.vault.adapter.stat(path);
    const mtime = stat?.mtime ?? 0;
    if (path === this.schemaPath && paths.bank === this.schemaBank && mtime === this.schemaMtime) return;
    this.schemaPath = path;
    this.schemaBank = paths.bank;
    this.schemaMtime = mtime;
    this.schema = null;
    if (!stat) {
      this.schemaError = `找不到实例词表：请检查 ${INSTANCE_CONFIG} 的 schema 路径`;
    } else {
      try {
        this.schema = loadRegistry(await this.app.vault.adapter.read(path), paths.bank).schema;
        this.schemaError = "";
      } catch (e) {
        this.schemaError = `实例词表读取失败：${(e as Error).message}`;
      }
    }
    this.applyIcons();
  }

  specFor(file: TFile): core.DirSpec | undefined {
    return this.schema ? core.specFor(this.schema, file.path) : undefined;
  }

  /** Bank pages by name, from Obsidian's metadata cache; a duplicated name resolves to nothing, as in kb. */
  pages(): Map<string, core.PageInfo[]> {
    const out = new Map<string, core.PageInfo[]>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.specFor(f)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const list = out.get(f.basename) ?? [];
      list.push({ type: fm.type, class: fm.class });
      out.set(f.basename, list);
    }
    return out;
  }

  pageList(): Array<{ name: string; info: core.PageInfo }> {
    return [...this.pages()].filter(([, l]) => l.length === 1).map(([name, l]) => ({ name, info: l[0] }));
  }

  private lookup(pages = this.pages()): core.PageLookup {
    return (name) => { const l = pages.get(name); return l && l.length === 1 ? l[0] : undefined; };
  }

  private async check(file: TFile, spec: core.DirSpec, lookup: core.PageLookup): Promise<core.Finding[]> {
    const text = await this.app.vault.cachedRead(file);
    const { data, error } = core.readFrontmatter(text);
    return core.validate(this.schema!, spec, data, error, lookup, core.claimedAttributes(text));
  }

  // ---------------------------------------------------------------- templates and checks
  private async onOpen(file: TFile | null) {
    const at = file && this.created.get(file.path);
    if (file && at) {
      this.created.delete(file.path);
      if (Date.now() - at < 10_000) await this.applyTemplate(file);
    }
    await this.refresh();
  }

  private async applyTemplate(file: TFile) {
    await this.loadSchema();
    const spec = this.specFor(file);
    if (!spec) return;
    let applied = false;
    await this.app.vault.process(file, (text) => {
      const out = core.applyTemplate(text, spec, { by: this.settings.actor, at: moment().format("YYYY-MM-DDTHH:mm:ssZ") });
      applied = out !== null;
      return out ?? text;
    });
    if (applied && !this.settings.actor) new Notice("Noteweaver：在插件设置里填 actor（如 human:demo），generated.by 才会自动写好");
  }

  async refresh() {
    await this.loadSchema();
    const file = this.app.workspace.getActiveFile();
    const spec = file && this.specFor(file);
    this.current = file && spec ? { path: file.path, findings: await this.check(file, spec, this.lookup()) } : null;
    if (this.current && this.all) {
      if (this.current.findings.length) this.all.set(this.current.path, this.current.findings);
      else this.all.delete(this.current.path);
    }
    this.renderStatus();
    this.views().forEach((v) => v.render());
  }

  async checkVault() {
    await this.loadSchema();
    const lookup = this.lookup();
    const all = new Map<string, core.Finding[]>();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const spec = this.specFor(f);
      if (!spec) continue;
      const findings = await this.check(f, spec, lookup);
      if (findings.length) all.set(f.path, findings);
    }
    if (this.schema) {
      const pages = await Promise.all(this.app.vault.getMarkdownFiles().filter((f) => this.specFor(f))
        .map(async (f) => ({ path: f.path, text: await this.app.vault.read(f) })));
      const pending = planRelations(this.schema, pages, this.relationState, this.relationRenames);
      this.relationIssues = pending.issues.length ? pending.issues : checkRelations(this.schema, pages);
      for (const issue of this.relationIssues) all.set(issue.path, [...(all.get(issue.path) ?? []), issue]);
    }
    this.all = all;
    await this.openView();
    this.views().forEach((v) => v.render());
  }

  private renderStatus() {
    const el = this.statusEl;
    el.empty();
    el.removeClass("noteweaver-error", "noteweaver-warning");
    if (!this.schema) {
      el.setText("Noteweaver: 无 schema");
      el.setAttr("aria-label", this.schemaError);
      return;
    }
    if (this.relationIssues.length) {
      el.setText(`Noteweaver: ${this.relationIssues.length} 项关系待处理`);
      el.addClass("noteweaver-error");
      el.setAttr("aria-label", "双向关系未同步，点开看详情");
      return;
    }
    if (!this.current) return;
    const errors = this.current.findings.filter((f) => f.severity === "error").length;
    const warnings = this.current.findings.length - errors;
    el.setText(errors || warnings ? `Noteweaver: ${errors} 错误 · ${warnings} 警告` : "Noteweaver ✓");
    if (errors) el.addClass("noteweaver-error");
    else if (warnings) el.addClass("noteweaver-warning");
    el.setAttr("aria-label", "frontmatter 检查（点开看详情）");
  }

  private views(): FindingsView[] {
    return this.app.workspace.getLeavesOfType(VIEW).map((l) => l.view).filter((v): v is FindingsView => v instanceof FindingsView);
  }

  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  // ---------------------------------------------------------------- icons
  private applyIcons() {
    this.styleEl?.remove();
    this.styleEl = null;
    if (!this.schema) return;
    this.styleEl = document.head.createEl("style", { attr: { id: "noteweaver-icons" } });
    this.styleEl.textContent = core.iconCss(this.schema, (id) => getIcon(id)?.outerHTML ?? null);
  }

  // ---------------------------------------------------------------- the ## 断言 table
  private renderClaims(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const pre = el.querySelector("pre > code.language-yaml")?.parentElement;
    const info = pre && ctx.getSectionInfo(el);
    if (!pre || !info) return;
    const block = core.claimsBlock(info.text);
    if (!block || block.error || block.fenceLine !== info.lineStart) return;
    const { rows, error } = core.claimRows(this.schema, block.yaml);
    const box = createDiv({ cls: "noteweaver-claims" });
    if (error) box.createDiv({ cls: "noteweaver-claims-error", text: error });
    if (rows.length) {
      const table = box.createEl("table");
      const head = table.createEl("thead").createEl("tr");
      for (const h of ["属性", "值", "适用范围", "生效", "取得方式", "证据", "核验", "状态"]) head.createEl("th", { text: h });
      const body = table.createEl("tbody");
      for (const r of rows) {
        const tr = body.createEl("tr", { cls: r.state.startsWith("已撤回") ? "noteweaver-claim-retracted" : "" });
        tr.setAttr("title", r.id);
        const attr = tr.createEl("td");
        if (r.label) attr.createSpan({ text: `${r.label} ` });
        attr.createEl("code", { text: r.attribute });
        for (const v of [r.value, r.scope, r.valid, r.basis, r.evidence, r.verified, r.state]) tr.createEl("td", { text: v });
      }
    }
    const details = createEl("details", { cls: "noteweaver-claims-yaml" });
    details.createEl("summary", { text: "yaml 原文" });
    pre.replaceWith(box);
    box.appendChild(details);
    details.appendChild(pre);
  }

  // ---------------------------------------------------------------- set a value
  private chooseKey(file: TFile, spec: core.DirSpec) {
    const keys = Object.entries(spec.keys).filter(([, k]) => k.place === "frontmatter")
      .sort(([a], [b]) => Number(!spec.required.includes(a)) - Number(!spec.required.includes(b)));
    new ChoiceModal(this.app, keys.map(([k, ks]) => ({ value: k, text: `${ks.label} ${k}${spec.required.includes(k) ? "（必填）" : ""}` })),
      "选一个键", (key) => this.chooseValue(file, spec, key)).open();
  }

  private chooseValue(file: TFile, spec: core.DirSpec, key: string) {
    const ks = spec.keys[key];
    const write = async (chosen: string) => {
      const current = this.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
      const value = core.nextValue(this.schema!, ks, current, chosen);
      await this.app.vault.process(file, (text) => core.setFrontmatterKey(text, key, value) ?? text);
    };
    const choices = core.valueChoices(this.schema!, spec, key, this.pageList());
    if (choices) {
      new ChoiceModal(this.app, choices.map((c) => ({ value: c, text: c })), `${ks.label}（${key}）`, write).open();
    } else {
      const hint = ks.value === "quantity" ? `数量，单位 ${ks.unit}，如 8.02B` : "时间，如 2025、2025-02 或 2025-02-14";
      new TextModal(this.app, `${ks.label}（${key}）`, `${hint}；未披露写 unknown，不适用写 none`, write).open();
    }
  }
}

class ChoiceModal extends SuggestModal<{ value: string; text: string }> {
  constructor(app: App, private items: Array<{ value: string; text: string }>, placeholder: string,
              private onChoose: (value: string) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getSuggestions(query: string) {
    const q = query.toLowerCase();
    return this.items.filter((i) => i.text.toLowerCase().includes(q));
  }
  renderSuggestion(item: { value: string; text: string }, el: HTMLElement) { el.setText(item.text); }
  onChooseSuggestion(item: { value: string; text: string }) { this.onChoose(item.value); }
}

class TextModal extends Modal {
  constructor(app: App, private heading: string, private hint: string, private onSubmit: (value: string) => void) {
    super(app);
  }
  onOpen() {
    let value = "";
    this.setTitle(this.heading);
    new Setting(this.contentEl).setName("值").setDesc(this.hint).addText((t) => {
      t.onChange((v) => { value = v.trim(); });
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && value) { this.close(); this.onSubmit(value); } });
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("写入").setCta().onClick(() => {
      if (value) { this.close(); this.onSubmit(value); }
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/** Source-mode suggestions for enum and relation keys inside the frontmatter. */
class FrontmatterSuggest extends EditorSuggest<string> {
  private choices: string[] = [];
  constructor(private plugin: Noteweaver) { super(plugin.app); }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    const spec = file && this.plugin.specFor(file);
    if (!spec || editor.getLine(0) !== "---" || cursor.line === 0) return null;
    for (let i = 1; i <= cursor.line; i++) if (editor.getLine(i) === "---") return null;
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    let key: string | undefined;
    let query: string;
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (kv) {
      [, key, query] = kv;
    } else {
      const item = /^\s*-\s?(.*)$/.exec(line);
      if (!item) return null;
      query = item[1];
      for (let i = cursor.line - 1; i > 0 && !key; i--) {
        const own = /^([A-Za-z0-9_-]+):\s*$/.exec(editor.getLine(i));
        if (own) key = own[1];
        else if (!/^\s*-/.test(editor.getLine(i))) return null;
      }
    }
    const choices = key && core.valueChoices(this.plugin.schema!, spec, key, this.plugin.pageList());
    if (!choices) return null;
    this.choices = choices;
    return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
  }

  getSuggestions(ctx: EditorSuggestContext): string[] {
    const q = ctx.query.replace(/^["']|["']$/g, "").toLowerCase();
    return this.choices.filter((c) => c.toLowerCase().includes(q)).slice(0, 50);
  }

  renderSuggestion(value: string, el: HTMLElement) { el.setText(value); }

  selectSuggestion(value: string) {
    const ctx = this.context;
    if (ctx) ctx.editor.replaceRange(value.startsWith("[[") ? `"${value}"` : value, ctx.start, ctx.end);
  }
}

class FindingsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: Noteweaver) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return "Noteweaver 检查"; }
  getIcon() { return "shield-check"; }
  async onOpen() { this.render(); }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("noteweaver-view");
    const p = this.plugin;
    if (p.schemaError) el.createDiv({ cls: "noteweaver-error", text: p.schemaError });
    if (p.relationIssues.length) {
      el.createEl("h4", { text: "关系同步" });
      for (const issue of p.relationIssues) {
        const link = el.createDiv({ cls: "noteweaver-file" }).createEl("a", { text: issue.path });
        link.onclick = () => void this.app.workspace.openLinkText(issue.path, "", false);
        this.list(el, [issue]);
      }
    }
    el.createEl("h4", { text: "当前页" });
    if (!p.current) el.createDiv({ cls: "noteweaver-muted", text: "当前页不在 schema 绑定的目录里" });
    else this.list(el, p.current.findings);
    const bar = el.createDiv({ cls: "noteweaver-bar" });
    bar.createEl("h4", { text: "全库" });
    bar.createEl("button", { text: p.all ? "重新检查" : "检查全库" }).onclick = () => void p.checkVault();
    if (p.all) {
      el.createDiv({ cls: "noteweaver-muted", text: `${p.all.size} 页有问题` });
      for (const [path, findings] of [...p.all].sort(([a], [b]) => a.localeCompare(b))) {
        const link = el.createDiv({ cls: "noteweaver-file" }).createEl("a", { text: path });
        link.onclick = () => void this.app.workspace.openLinkText(path, "", false);
        this.list(el, findings);
      }
    }
  }

  private list(el: HTMLElement, findings: core.Finding[]) {
    if (!findings.length) {
      el.createDiv({ cls: "noteweaver-muted", text: "frontmatter 没有问题" });
      return;
    }
    const ul = el.createEl("ul");
    for (const f of findings) {
      const li = ul.createEl("li", { cls: f.severity === "error" ? "noteweaver-error" : "noteweaver-warning" });
      li.createEl("code", { text: f.code });
      li.appendText(` ${f.message}`);
    }
  }
}

class NoteweaverSettings extends PluginSettingTab {
  constructor(app: App, private plugin: Noteweaver) { super(app, plugin); }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("actor")
      .setDesc("新页面模板里 generated.by 的值，如 human:demo")
      .addText((t) => t.setValue(this.plugin.settings.actor).onChange(async (v) => {
        this.plugin.settings.actor = v.trim();
        await this.plugin.saveSettings();
      }));
  }
}
