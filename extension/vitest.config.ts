import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "stoplight-wasm-generated": resolve(
        __dirname,
        "src/shared/generated-wasm.stub.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
