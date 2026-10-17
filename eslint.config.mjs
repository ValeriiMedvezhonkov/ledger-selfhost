import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "drizzle/**",
    "next-env.d.ts",
  ]),

  ...nextVitals,
  ...nextTs,

  // Type-aware strict rules. These are what enforce the "no `any`, no unsafe
  // escape hatches" contract; they need the TS project service to run.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message:
            "Money is stored in integer minor units. Use parseMoneyInput() from lib/money.ts.",
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            "Money is stored in integer minor units. Use parseMoneyInput() from lib/money.ts.",
        },
      ],
    },
  },

  // Server-rendered code must not read the wall clock during render, or output
  // stops being deterministic. Time enters through an explicit `now` argument.
  {
    files: ["app/**/*.tsx", "lib/stats.ts"],
    ignores: ["**/*.client.tsx", "app/**/actions.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Do not read the wall clock during render. Accept `now` as a prop/argument instead.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Do not read the wall clock during render. Accept `now` as a prop/argument instead.",
        },
      ],
    },
  },

  // Vendored code emitted by `npx shadcn add`. It is dependency source that
  // happens to live in the repo, so it keeps the base Next rules but is exempt
  // from the strict presets — otherwise every `shadcn add` would break the
  // build. Application code gets no such exemption.
  {
    files: ["components/ui/**", "hooks/use-mobile.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/array-type": "off",
    },
  },

  // Translated UI only: a bare string in JSX is a string that cannot be
  // translated. Everything user-visible goes through a key in messages/*.json.
  // Punctuation and separators are exempt — they read the same in every
  // language and keying them would be noise.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ui/**"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            "·", "—", "–", "/", "%", "+", "-", ":", ",", ".", "…",
            "(", ")", " ", " / ", " · ", "€", "404",
          ],
        },
      ],
    },
  },

  prettier,
]);

export default eslintConfig;
