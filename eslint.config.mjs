// @ts-check

import eslint from "@eslint/js";
import pluginSimpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    name: "message-bus/languages",
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.es2022,
    },
  },
  {
    name: "message-bus/ignores",
    ignores: ["coverage", "dist", "docs"],
  },
  {
    name: "message-bus/files",
    files: ["**/*.?(c|m){j,t}s"],
  },
  {
    name: "message-bus/eslint",
    extends: [
      {
        name: "eslint/recommended",
        ...eslint.configs.recommended,
      },
    ],
    rules: {
      "no-use-before-define": [
        "error",
        {
          classes: true,
          functions: false,
          variables: false,
          allowNamedExports: false,
        },
      ],
      "no-param-reassign": "error",
    },
  },
  {
    name: "message-bus/typescript",
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
        },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-namespace": [
        "error",
        {
          allowDeclarations: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        {
          allowThrowingAny: true,
          allowThrowingUnknown: true,
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allow: [
            {
              from: "file",
              name: "Topic",
              path: "src/topic.ts",
            },
            {
              from: "file",
              name: "UnicastTopic",
              path: "src/topic.ts",
            },
          ],
        },
      ],
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-var": "off",
    },
  },
  {
    name: "simple-import-sort/all",
    plugins: {
      "simple-import-sort": pluginSimpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
);
