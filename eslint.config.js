// eslint.config.js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";

export default [
  // Ignore generated files
  {
    ignores: ["dist/**", "examples/**", "node_modules/**", ".prettierrc.cjs"],
  },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Global settings (Node globals)
  {
    languageOptions: {
      globals: {
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        exports: "readonly",
        __filename: "readonly",
        module: "readonly",
      },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // TypeScript source files – use project tsconfig
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json" },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // Test files – no project, allow Node globals, disable require and no-undef
  {
    files: ["tests/**/*.ts", "tests/**/*.js"],
    languageOptions: {
      parserOptions: { ecmaVersion: 2020 },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Example files – similar to tests
  {
    files: ["examples/**/*.ts", "examples/**/*.js"],
    languageOptions: {
      parserOptions: { ecmaVersion: 2020 },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },

  // Adapter files – allow any and unused vars
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
