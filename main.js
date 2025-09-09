// .obsidian/plugins/obsidian-d2/main.js
// Plain JavaScript Obsidian plugin (no build). Loads D2 as an ESM from the plugin folder.
// Per-diagram config only: we pass compile() with no options and render() with the renderOptions
// returned by compile(), which already include the diagram's vars.config merges.

const { Plugin, MarkdownRenderChild, normalizePath } = require('obsidian');

module.exports = class D2Plugin extends Plugin {
  async onload() {
    this._d2 = null;      // D2 instance (from the ESM)
    this._d2Mod = null;   // imported module cache
    this._d2Url = null;   // app:// URL to d2.js

    // Register code-block processor for ```d2 fences
    this.registerMarkdownCodeBlockProcessor('d2', async (source, el, ctx) => {
      try {
        await this.ensureD2Ready();

        const child = new D2RenderChild(el, async (host) => {
          try {
            // 1) Compile with NO global/override options -> per-diagram config only
            const { diagram, renderOptions } = await this._d2.compile(source);
            // 2) Render using the merged per-diagram renderOptions
            const svg = await this._d2.render(diagram, renderOptions);

            host.empty();
            const wrapper = host.createDiv({ cls: 'd2-host' });
            wrapper.innerHTML = svg;

            // Make SVG responsive in preview & PDF
            const svgEl = wrapper.querySelector('svg');
            if (svgEl) {
              svgEl.setAttribute('width', '100%');
              svgEl.style.height = 'auto';
              svgEl.style.maxWidth = '100%';
              svgEl.style.display = 'block';
            }
          } catch (e) {
            host.setText('D2 render error: ' + (e?.message ?? String(e)));
          }
        });

        ctx.addChild(child);
      } catch (e) {
        el.setText('D2 init error: ' + (e?.message ?? String(e)));
      }
    });
  }

  async ensureD2Ready() {
  if (this._d2) return;

  // Build vault-relative path: ".obsidian/plugins/<id>/d2.js"
  const d2Path = normalizePath(`${this.manifest.dir}/d2.js`);

 // || `${this.app.vault.configDir}/plugins/${this.manifest.id}/d2.js`;
  // 1) Resolve to a TFile
  //   const d2File = this.app.vault.getAbstractFileByPath(d2Path);
  //   console.log(this.app.vault.getAbstractFileByPath(d2Path));

  
  // if (!d2File) {
  //   throw new Error(`D2 module not found at: ${d2Path}`);
  // }
  

  // 2) Convert to an app:// URL
  const d2Url = this.app.vault.adapter.getResourcePath(d2Path);

  // 3) Dynamically import the ESM module
  const mod = await import(/* @vite-ignore */ d2Url);
  if (!mod || !mod.D2) {
    throw new Error(`The module at ${d2Path} does not export { D2 } (need the browser ESM build).`);
  }

  // Single shared instance for the session; no global options (per-diagram only)
  this._d2 = new mod.D2();
}

};

class D2RenderChild extends MarkdownRenderChild {
  constructor(containerEl, run) {
    super(containerEl);
    this.run = run;
  }
  async onload() {
    await this.run(this.containerEl);
  }
}
