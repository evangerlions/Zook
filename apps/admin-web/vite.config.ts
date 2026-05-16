import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const proxyTarget = process.env.ADMIN_API_PROXY_TARGET ?? "http://127.0.0.1:3100";

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  server: {
    proxy: {
      "/api": proxyTarget,
    },
  },
});
