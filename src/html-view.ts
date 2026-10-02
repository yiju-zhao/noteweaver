import { debounce, FileView, TFile, WorkspaceLeaf } from "obsidian";
import { frameFor, linkAction, LINK_MESSAGE } from "./presentation";

export const HTML_VIEW = "noteweaver-html";

/** Read-only display of an .html file in a sandboxed iframe. `scripts(path)` decides whether the page may
 * run code; the frame never shares an origin with Obsidian either way. */
export class HtmlView extends FileView {
  private frame: HTMLIFrameElement | null = null;
  private rendering = 0;
  private unlisten = () => {};
  private refreshSoon = debounce(() => { if (this.file) void this.render(this.file); }, 200, true);

  constructor(leaf: WorkspaceLeaf, private scripts: (path: string) => Promise<boolean>) { super(leaf); }
  getViewType() { return HTML_VIEW; }
  getIcon() { return "file-code"; }
  canAcceptExtension(extension: string) { return extension === "html"; }

  onload() {
    super.onload();
    this.contentEl.addClass("noteweaver-html");
    this.registerEvent(this.app.vault.on("modify", (f) => { if (f === this.file) this.refreshSoon(); }));
    const listen = (win: Window) => {
      this.unlisten();
      win.addEventListener("message", this.onMessage);
      this.unlisten = () => win.removeEventListener("message", this.onMessage);
    };
    listen(this.contentEl.win);
    this.register(this.contentEl.onWindowMigrated(listen));
    this.register(() => this.unlisten());
  }

  async onLoadFile(file: TFile) { await this.render(file); }
  async onUnloadFile() { this.rendering++; this.frame = null; this.contentEl.empty(); }

  private async render(file: TFile) {
    const turn = ++this.rendering;
    const html = await this.app.vault.read(file);
    const { srcdoc, sandbox } = frameFor(html, await this.scripts(file.path));
    if (turn !== this.rendering) return;
    this.contentEl.empty();
    this.frame = this.contentEl.createEl("iframe", { cls: "noteweaver-html-frame", attr: { sandbox } });
    this.frame.srcdoc = srcdoc;
  }

  /** The page is untrusted: accept only link reports from our own frame, and only open what the click's
   * target says. Opening a web page needs a user gesture, which a page script cannot fake. */
  private onMessage = (event: MessageEvent) => {
    const file = this.file;
    if (!file || !this.frame || event.source !== this.frame.contentWindow || event.data?.type !== LINK_MESSAGE) return;
    const action = linkAction(event.data.href, file.path);
    if (action?.kind === "external") {
      const win = this.contentEl.win;
      if (win.navigator.userActivation?.isActive) win.open(action.url);
    } else if (action) {
      const target = this.app.vault.getAbstractFileByPath(action.path);
      if (target instanceof TFile)
        void this.app.workspace.getLeaf(false).openFile(target, action.hash ? { eState: { subpath: `#${action.hash}` } } : undefined);
    }
  };
}
