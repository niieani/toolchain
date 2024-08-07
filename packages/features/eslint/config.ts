import type { Linter, ESLint } from "eslint";
import importPlugin from "eslint-plugin-import-x";
import importPluginTypeScript from "eslint-plugin-import-x/config/typescript.js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser, {
  type ParserOptions,
} from "@typescript-eslint/parser";
import noExtraneousDependencies from "./rules/no-extraneous-dependencies.js";
import unicornPlugin from "eslint-plugin-unicorn";
import type { ConduConfigWithInferredValuesAndProject } from "@condu/types/configTypes.js";

export const getConfigs = ({
  conventions,
  projects = [],
}: Pick<
  ConduConfigWithInferredValuesAndProject,
  "conventions" | "projects"
>) => {
  const { generatedSourceFileNameSuffixes, sourceExtensions, buildDir } =
    conventions;
  const packageNameConventions = projects.filter(
    (p): p is { nameConvention: string; parentPath: string } =>
      typeof p === "object" &&
      "parentPath" in p &&
      p.nameConvention !== undefined,
  );
  const executableExtensionsList = conventions.sourceExtensions
    .filter((ext) => ext !== "json")
    .join(",");

  const ignores = [
    `**/*{${generatedSourceFileNameSuffixes.join(",")}}.{${sourceExtensions.join(",")}}`,
    `${buildDir}/**`,
    `**/.config/**`,
    ".moon/**",
    ".yarn/**",
    "integration-tests/**",
  ];

  const x = 123;

  return [
    {
      // https://eslint.org/docs/latest/use/configure/configuration-files#globally-ignoring-files-with-ignores
      ignores,
    },
    {
      // TODO: use files from config
      files: [`**/*.{${executableExtensionsList}}`],
      plugins: {
        "import-x": {
          ...importPlugin,
          ...importPluginTypeScript,
          rules: {
            ...importPlugin.rules,
            ...(importPluginTypeScript.rules as unknown as ESLint.Plugin["rules"]),
            "no-extraneous-dependencies": noExtraneousDependencies,
          },
        },
        unicorn: unicornPlugin,
        "@typescript-eslint": typescriptEslint as unknown as ESLint.Plugin,
      },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parser: typescriptParser,
        parserOptions: {
          ecmaFeatures: {
            // TODO: parametrize based on config
            jsx: true,
          },
        } satisfies ParserOptions,
        // globals: {
        //   ...globals.browser,
        // },
      },
      rules: {
        // turn on errors for missing imports
        "import-x/no-unresolved": [
          "error",
          {
            // ignore: ["^bun:"]
          },
        ],
        "import-x/no-relative-packages": "error",
        "import-x/no-duplicates": ["error", { "prefer-inline": true }],
        "import-x/no-extraneous-dependencies": [
          "error",
          // TODO: make dynamic based on conventions
          {
            devDependencies: [
              `**/*.test.{${executableExtensionsList}}`,
              "**/.config/**",
              `**/*.config.{${executableExtensionsList}}`,
            ],
            autoFixVersionMapping: packageNameConventions.map(
              ({ nameConvention }) => [nameConvention, "workspace:^"],
            ),
            // ...packageNameConventions.map(({ nameConvention }) => [
            //   nameConvention,
            //   "workspace:^",
            // ]),
            // ["@condu/", "workspace:^"],
            // ["@condu-feature/", "workspace:^"],
            // ["condu", "workspace:^"],
            autoFixFallback: "^",
          },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { disallowTypeAnnotations: false },
        ],
        "@typescript-eslint/no-import-type-side-effects": "error",
        // for compatibility with deno, we want node: prefixes
        // https://docs.deno.com/runtime/manual/node/node_specifiers
        "unicorn/prefer-node-protocol": "error",

        // others:
        "unicorn/prefer-regexp-test": "error",
        "unicorn/better-regex": "error",
        "unicorn/new-for-builtins": "error",
        "unicorn/consistent-function-scoping": "error",
        "unicorn/custom-error-definition": "error",
        "unicorn/escape-case": "error",

        // TODO: opinionated rules (these should not be defaults)
        "unicorn/no-null": "error",
        "unicorn/no-typeof-undefined": "error",
        "unicorn/filename-case": [
          "error",
          {
            cases: {
              camelCase: true,
              pascalCase: true,
              kebabCase: true,
            },
            ignore: [`\\.d\\.ts$`],
          },
        ],
        "unicorn/no-abusive-eslint-disable": "error",
        "unicorn/no-array-for-each": "error",
        "unicorn/no-array-method-this-argument": "error",
        "unicorn/no-document-cookie": "error",
        "unicorn/no-for-loop": "error",
        "unicorn/no-hex-escape": "error",
        "unicorn/no-instanceof-array": "error",
        "unicorn/no-invalid-remove-event-listener": "error",
        // TODO: review the rest https://github.com/sindresorhus/eslint-plugin-unicorn/tree/main?tab=readme-ov-file
      },
      settings: {
        // "import-x/parsers": {
        //   "@typescript-eslint/parser": [".ts", ".tsx"],
        // },
        "import-x/resolver": {
          typescript: {
            alwaysTryTypes: true, // always try to resolve types under `<root>@types` directory even it doesn't contain any source code, like `@types/unist`

            // Choose from one of the "project" configs below or omit to use <root>/tsconfig.json by default

            // use <root>/path/to/folder/tsconfig.json
            // project: "path/to/folder",

            // Multiple tsconfigs (Useful for monorepos)

            // use a glob pattern
            // project: "packages/*/tsconfig.json",

            // // use an array
            // project: [
            //   "packages/module-a/tsconfig.json",
            //   "packages/module-b/tsconfig.json",
            // ],

            // // use an array of glob patterns
            // project: [
            //   "packages/*/tsconfig.json",
            //   "other-packages/*/tsconfig.json",
            // ],
          },
        },
      },
    },
  ] satisfies Linter.Config[];
};
