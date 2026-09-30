const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.{js,mjs}"],
    testTimeout: 10000,
    server: {
      deps: {
        // Inline these CJS deps so vi.mock() intercepts the source module's
        // internal require() calls (org token + auth + token refresh paths).
        inline: ["firebase-admin", "axios"],
      },
    },
  },
});
