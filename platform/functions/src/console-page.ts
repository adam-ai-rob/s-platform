import { platformModules } from "./module-registry";

const swaggerCssUrl = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css";
const swaggerBundleUrl =
  "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js";
const swaggerStandalonePresetUrl =
  "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js";
const swaggerCssIntegrity =
  "sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn";
const swaggerBundleIntegrity =
  "sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep";
const swaggerStandalonePresetIntegrity =
  "sha384-2YH8WDRaj7V2OqU/trsmzSagmk/E2SutiCsGkdgoQwC9pNUJV1u/141DHB6jgs8t";

export function renderConsolePage(): string {
  const modulesJson = JSON.stringify(platformModules);

  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>s-platform console</title>
    <link
      rel="stylesheet"
      href="${swaggerCssUrl}"
      integrity="${swaggerCssIntegrity}"
      crossorigin="anonymous"
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f7f5;
        --text: #18201f;
        --muted: #596461;
        --border: #d8ddda;
        --panel: #ffffff;
        --ok: #0d7c45;
        --bad: #b42318;
        --warn: #9a6700;
        --accent: #126c80;
        --shadow: 0 1px 2px rgba(24, 32, 31, 0.06);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.45;
      }

      header {
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }

      .wrap {
        width: min(1240px, calc(100% - 32px));
        margin: 0 auto;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 0;
      }

      h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 720;
      }

      .stage {
        color: var(--muted);
        font-size: 14px;
      }

      nav {
        display: flex;
        gap: 8px;
        padding: 0 0 14px;
      }

      .tab,
      button {
        min-height: 36px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--panel);
        color: var(--text);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }

      .tab {
        padding: 0 14px;
      }

      .tab.active,
      button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: #ffffff;
      }

      main {
        padding: 24px 0 40px;
      }

      section[hidden] {
        display: none;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .toolbar h2 {
        margin: 0;
        font-size: 18px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      input {
        width: min(520px, 100%);
        min-height: 36px;
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 0 10px;
        font: inherit;
        font-size: 14px;
      }

      button {
        padding: 0 12px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 12px;
      }

      .module {
        min-height: 160px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
        box-shadow: var(--shadow);
        padding: 14px;
      }

      .module-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .module h3 {
        margin: 0;
        font-size: 16px;
      }

      .module p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 13px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        border-radius: 999px;
        padding: 0 9px;
        font-size: 12px;
        font-weight: 680;
        white-space: nowrap;
      }

      .pill.pending {
        background: #eef1f0;
        color: var(--muted);
      }

      .pill.up {
        background: #def8e9;
        color: var(--ok);
      }

      .pill.down {
        background: #fee4e2;
        color: var(--bad);
      }

      .pill.warn {
        background: #fff4d6;
        color: var(--warn);
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 10px;
        margin: 12px 0 0;
        font-size: 13px;
      }

      dt {
        color: var(--muted);
      }

      dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      pre {
        max-height: 360px;
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: #fbfbfa;
        padding: 10px;
        font-size: 12px;
      }

      #swagger-ui {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
        min-height: 640px;
      }

      .swagger-ui .topbar {
        display: none;
      }

      @media (max-width: 700px) {
        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }

        nav,
        .actions {
          width: 100%;
        }

        .tab,
        button {
          flex: 1 1 auto;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <div class="topbar">
          <div>
            <h1>s-platform console</h1>
            <div class="stage" id="origin-label"></div>
          </div>
        </div>
        <nav aria-label="Console sections">
          <button class="tab active" type="button" data-section="health">Health</button>
          <button class="tab" type="button" data-section="docs">Docs</button>
          <button class="tab" type="button" data-section="info">Info</button>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <section id="health-section">
        <div class="toolbar">
          <h2>Module health</h2>
          <div class="actions">
            <span class="stage" id="health-checked"></span>
            <button class="primary" type="button" id="refresh-health">Refresh</button>
          </div>
        </div>
        <div class="grid" id="health-grid"></div>
      </section>

      <section id="docs-section" hidden>
        <div class="toolbar">
          <h2>Module API docs</h2>
          <div class="stage">Specs are loaded from each module's live OpenAPI endpoint.</div>
        </div>
        <div id="swagger-ui"></div>
      </section>

      <section id="info-section" hidden>
        <div class="toolbar">
          <h2>Module info</h2>
          <div class="actions">
            <input
              id="token-input"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="Bearer token"
              aria-label="Bearer token"
            />
            <button class="primary" type="button" id="load-info">Load info</button>
          </div>
        </div>
        <div class="grid" id="info-grid"></div>
      </section>
    </main>

    <script
      src="${swaggerBundleUrl}"
      integrity="${swaggerBundleIntegrity}"
      crossorigin="anonymous"
    ></script>
    <script
      src="${swaggerStandalonePresetUrl}"
      integrity="${swaggerStandalonePresetIntegrity}"
      crossorigin="anonymous"
    ></script>
    <script>
      const modules = ${modulesJson};
      const sectionIds = ["health", "docs", "info"];
      let swaggerLoaded = false;

      document.getElementById("origin-label").textContent = window.location.origin;

      function statusClass(status) {
        if (status === "up" || status === "ok") return "up";
        if (status === "loading") return "pending";
        if (status === "unauthorized") return "warn";
        return "down";
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function renderShell(targetId, mode) {
        const target = document.getElementById(targetId);
        target.innerHTML = modules
          .map((module) =>
            [
              '<article class="module" id="' + mode + "-" + module.id + '">',
              '<div class="module-head">',
              "<div>",
              "<h3>" + escapeHtml(module.name) + "</h3>",
              "<p>" + escapeHtml(module.description) + "</p>",
              "</div>",
              '<span class="pill pending">pending</span>',
              "</div>",
              "<dl>",
              "<dt>Path</dt><dd>" + escapeHtml(module.basePath) + "</dd>",
              "</dl>",
              "</article>",
            ].join(""),
          )
          .join("");
      }

      function setModuleContent(mode, module, state, details) {
        const node = document.getElementById(mode + "-" + module.id);
        const status = escapeHtml(state);
        node.querySelector(".pill").className = "pill " + statusClass(state);
        node.querySelector(".pill").textContent = status;
        node.querySelector("dl").innerHTML = details;
      }

      async function loadHealth() {
        renderShell("health-grid", "health");
        await Promise.all(
          modules.map(async (module) => {
            const start = performance.now();
            try {
              const response = await fetch(module.basePath + "/health", { cache: "no-store" });
              const elapsedMs = Math.round(performance.now() - start);
              const body = await response.json().catch(() => null);
              const state = response.ok && body?.status === "ok" ? "up" : "down";
              setModuleContent(
                "health",
                module,
                state,
                [
                  "<dt>Endpoint</dt><dd>" + escapeHtml(module.basePath + "/health") + "</dd>",
                  "<dt>HTTP</dt><dd>" + response.status + "</dd>",
                  "<dt>Latency</dt><dd>" + elapsedMs + " ms</dd>",
                  "<dt>Body</dt><dd>" + escapeHtml(JSON.stringify(body)) + "</dd>",
                ].join(""),
              );
            } catch (error) {
              setModuleContent(
                "health",
                module,
                "down",
                [
                  "<dt>Endpoint</dt><dd>" + escapeHtml(module.basePath + "/health") + "</dd>",
                  "<dt>Error</dt><dd>" + escapeHtml(error.message) + "</dd>",
                ].join(""),
              );
            }
          }),
        );
        document.getElementById("health-checked").textContent =
          "Last checked " + new Date().toLocaleTimeString();
      }

      function loadDocs() {
        if (swaggerLoaded) return;
        swaggerLoaded = true;
        const primaryModule = modules[0];
        const primarySpecName = primaryModule
          ? primaryModule.id + " - " + primaryModule.name
          : undefined;
        const swaggerConfig = {
          dom_id: "#swagger-ui",
          urls: modules.map((module) => ({
            name: module.id + " - " + module.name,
            url: module.basePath + "/openapi.json",
          })),
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
          deepLinking: true,
          persistAuthorization: false,
          validatorUrl: null,
        };
        if (primarySpecName) swaggerConfig["urls.primaryName"] = primarySpecName;
        window.ui = SwaggerUIBundle(swaggerConfig);
      }

      async function loadInfo() {
        renderShell("info-grid", "info");
        const rawToken = document.getElementById("token-input").value.trim();
        const token = rawToken.startsWith("Bearer ") ? rawToken.slice("Bearer ".length) : rawToken;
        if (!token) {
          for (const module of modules) {
            setModuleContent(
              "info",
              module,
              "unauthorized",
              [
                "<dt>Endpoint</dt><dd>" + escapeHtml(module.basePath + "/info") + "</dd>",
                "<dt>Action</dt><dd>Enter a bearer token to load authenticated metadata.</dd>",
              ].join(""),
            );
          }
          return;
        }

        await Promise.all(
          modules.map(async (module) => {
            try {
              const response = await fetch(module.basePath + "/info", {
                cache: "no-store",
                headers: { Authorization: "Bearer " + token },
              });
              const body = await response.json().catch(() => null);
              if (!response.ok) {
                setModuleContent(
                  "info",
                  module,
                  response.status === 401 || response.status === 403 ? "unauthorized" : "down",
                  [
                    "<dt>Endpoint</dt><dd>" + escapeHtml(module.basePath + "/info") + "</dd>",
                    "<dt>HTTP</dt><dd>" + response.status + "</dd>",
                    "<dt>Body</dt><dd><pre>" +
                      escapeHtml(JSON.stringify(body, null, 2)) +
                      "</pre></dd>",
                  ].join(""),
                );
                return;
              }

              const data = body?.data ?? {};
              setModuleContent(
                "info",
                module,
                "up",
                [
                  "<dt>Service</dt><dd>" + escapeHtml(data.service ?? "") + "</dd>",
                  "<dt>Stage</dt><dd>" + escapeHtml(data.stage ?? "") + "</dd>",
                  "<dt>Version</dt><dd>" + escapeHtml(data.version ?? "") + "</dd>",
                  "<dt>Metadata</dt><dd><pre>" +
                    escapeHtml(JSON.stringify(data, null, 2)) +
                    "</pre></dd>",
                ].join(""),
              );
            } catch (error) {
              setModuleContent(
                "info",
                module,
                "down",
                [
                  "<dt>Endpoint</dt><dd>" + escapeHtml(module.basePath + "/info") + "</dd>",
                  "<dt>Error</dt><dd>" + escapeHtml(error.message) + "</dd>",
                ].join(""),
              );
            }
          }),
        );
      }

      function showSection(id) {
        for (const sectionId of sectionIds) {
          document.getElementById(sectionId + "-section").hidden = sectionId !== id;
          document
            .querySelector('[data-section="' + sectionId + '"]')
            .classList.toggle("active", sectionId === id);
        }
        if (id === "docs") loadDocs();
      }

      for (const tab of document.querySelectorAll(".tab")) {
        tab.addEventListener("click", () => showSection(tab.dataset.section));
      }

      document.getElementById("refresh-health").addEventListener("click", loadHealth);
      document.getElementById("load-info").addEventListener("click", loadInfo);

      renderShell("info-grid", "info");
      loadHealth();
    </script>
  </body>
</html>`;
}
