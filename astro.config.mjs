import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import devLocal from "./plugins/vite-dev-local.mjs";

export default defineConfig({
  site: "https://mutbot.ai",
  vite: {
    plugins: [tailwindcss(), devLocal()],
  },
});
