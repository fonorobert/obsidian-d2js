// .obsidian/plugins/<your-id>/main.js
// Uses global D2 bundle (d2.global.js) on desktop + iOS.
// If d2.global.js / d2.wasm are missing (e.g., not synced due to 5 MB limit),
// downloads them from your GitHub repo into the plugin folder, then loads D2.
//
// Per-diagram config only: we DO NOT pass CompileOptions; we pass compile()'s return renderOptions to render().

const { Plugin, MarkdownRenderChild, normalizePath, Notice } = require('obsidian');

// ⬇️ EDIT THIS: folder in your repo that holds d2.global.js + d2.wasm (raw URL base)
const RAW_BASE = 'https://raw.githubusercontent.com/fonorobert/obsidian-d2js/main';

// If you also gzipped your global bundle, ignore that here; this version pulls the plain files.
const ASSETS = [
  { name: 'd2.global.js', type: 'text'   },  // text script
];

// (Optional) You can pin checksums to harden integrity.
// const CHECKSUMS = { 'd2.global.js': '<sha256-hex>', 'd2.wasm': '<sha256-hex>' };

module.exports = class D2Plugin extends Plugin {
  async onload() {
    this._d2 = null;
    this._loadPromise = null;

    this.registerMarkdownCodeBlockProcessor('d2', async (source, el, ctx) => {
      try {
        await this.ensureD2Ready();

        const child = new D2RenderChild(el, async (host) => {
          try {
            // Per-diagram only: no global CompileOptions here.
            const { diagram, renderOptions } = await this._d2.compile(source);
            const svg = await this._d2.render(diagram, renderOptions);

            host.empty();
            const wrap = host.createDiv({ cls: 'd2-host' });
            wrap.innerHTML = svg;

            const svgEl = wrap.querySelector('svg');
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

  // --- Core: ensure the D2 runtime is present locally, else download it, then load it.
  async ensureD2Ready() {
    if (this._d2) return;
    if (this._loadPromise) { await this._loadPromise; return; }

    const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    await this.ensureFolder(pluginDir);

    // 1) Make sure both files exist; if any is missing, download both (keeps versions in sync).
    const missing = [];
    for (const a of ASSETS) {
      const p = normalizePath(`${pluginDir}/${a.name}`);
      const exists = await this.app.vault.adapter.exists(p);
      if (!exists) missing.push(a.name);
    }
    if (missing.length) {
      new Notice(`Downloading D2 runtime (${missing.join(', ')})…`);
      await this.downloadAssets(pluginDir);
      new Notice('D2 runtime ready.');
    }

    // 2) Load global bundle via classic <script>
    this._loadPromise = this.injectGlobal(`${pluginDir}/d2.global.js`)
      .then(() => {
        // Accept both shapes: window.D2 (ctor) or window.D2.D2 (namespace+ctor)
        const ctor =
          (typeof window.D2 === 'function') ? window.D2 :
          (window.D2 && typeof window.D2.D2 === 'function') ? window.D2.D2 :
          null;

        if (!ctor) throw new Error('d2.global.js loaded but no constructor (expected window.D2 or window.D2.D2).');

        this._d2 = new ctor(); // single shared instance; no global options
      })
      .finally(() => { this._loadPromise = null; });

    await this._loadPromise;
  }

  async ensureFolder(path) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) await adapter.mkdir(path);
  }

  async downloadAssets(pluginDir) {
    // Download assets fresh each time we detect a missing file (keeps pair in sync)
    for (const a of ASSETS) {
      const url = `${RAW_BASE}/${a.name}`;
      const outPath = normalizePath(`${pluginDir}/${a.name}`);

      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Failed to fetch ${a.name} (${resp.status})`);

      if (a.type === 'binary') {
        const buf = await resp.arrayBuffer();
        // Optional integrity check:
        // await this.assertSha256(buf, CHECKSUMS[a.name], a.name);
        await this.app.vault.adapter.writeBinary(outPath, buf);
      } else {
        const txt = await resp.text();
        // Optional integrity check:
        // await this.assertSha256(new TextEncoder().encode(txt), CHECKSUMS[a.name], a.name);
        await this.app.vault.adapter.write(outPath, txt);
      }
    }
  }

  async injectGlobal(vaultRelPath) {
    const url = this.app.vault.adapter.getResourcePath(normalizePath(vaultRelPath));
    await new Promise((resolve, reject) => {
      if (window.D2) return resolve();
      const s = document.createElement('script');
      s.src = `${url}?v=${Date.now()}`; // cache-bust after updates
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${vaultRelPath}`));
      document.head.appendChild(s);
    });
  }

  // (Optional) content integrity using SHA-256 — enable by filling CHECKSUMS above
  async assertSha256(bufOrU8, expectedHex, name) {
    if (!expectedHex) return;
    const buf = (bufOrU8 instanceof ArrayBuffer) ? bufOrU8 : bufOrU8.buffer;
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== expectedHex.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${name}: got ${hex}, expected ${expectedHex}`);
    }
  }
};

class D2RenderChild extends MarkdownRenderChild {
  constructor(containerEl, run) { super(containerEl); this.run = run; }
  async onload() { await this.run(this.containerEl); }
}
