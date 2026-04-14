import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

const target = process.env.TARGET || "chrome";
const outDir = target === "firefox" ? "dist-firefox" : "dist";

export default defineConfig({
    plugins: [
        webExtension({
            manifest: "./public/manifest.json",
            browser: target,
            additionalInputs: [
                "src/configuration/configuration.html",
                "src/page-hooks/page-hooks.ts"
            ]
        }),
    ],
    build: {
        outDir,
        emptyOutDir: true,
    },
});