import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only endpoint that writes the db snapshot straight to the committed seed file, so the `#db`
 * "Export snapshot" button can save without a copy-paste round-trip. Only mounted by the dev server;
 * on the static GitHub Pages build this route doesn't exist and the button falls back to clipboard.
 */
function snapshotWriter(): Plugin {
  const target = path.resolve(__dirname, "src/db/seed.snapshot.json");
  return {
    name: "snapshot-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__write-snapshot", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("POST only");
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const json = JSON.stringify(JSON.parse(body), null, 2) + "\n"; // validate + normalise
            await writeFile(target, json);
            res.statusCode = 200;
            res.end("ok");
          } catch (e) {
            res.statusCode = 400;
            res.end(String((e as Error).message));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "/glycogen/",
  plugins: [react(), tailwindcss(), snapshotWriter()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
