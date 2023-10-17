# project codename: repo

NOTE: the codename "repo" is not final and is likely to change.

The un-template / un-boilerplate / un-scaffold / un-generator.
Keep ALL of your project configuration up to date, and easily override it, using a single language.

Managing the JavaScript ecosystem can be a full time job.
Upgrades to transpiles, migrations across builder systems, migrating or adding support for new engines (deno, bun), correct support for CommonJS and ESM, linting, testing, etc.
And if you maintain more than one package, multiply all of that work by each one!

Annoyed by ecosystem/tooling churn? Hard to maintain dependencies? Tired of manually updating configs?

Tired of various tools having different configuration formats?
Some starting with dot, some in their own folders, some in .json,
others in [.yaml](https://news.ycombinator.com/item?id=37687060), JavaScript, or even .toml?

Configure everything with code! In TypeScript, neatly organized inside of a `.config` folder.

Additionally, reuse your configuration across projects, and easily update them all at once.
Override only the parts you need to in your given project, and keep the rest up to date.

Scaffolding seems great at first, but isn't good enough, because it's not maintainable.
The ecosystem moves too fast, and there are no configuration management tools in the JavaScript ecosystem.

`repo` fixes [this](https://twitter.com/WarrenInTheBuff/status/1672839156647575552) and [this](https://deno.com/blog/node-config-hell) and [this](https://www.youtube.com/watch?v=wYdnJPYFTIE).

`repo` is here to help out.

- Simple repo management system:

  - Immutable/reconstructable configs (nix-os philosophy)
  - Allow custom build strategy
  - Allow overrides for any config
  - Allow search and replace for any config
  - Monorepo support
  - Set build strategy (simple, e.g. library-webpack or web-vite)
  - General repo strategy (Github actions)
  - Easy migrations?
  - Config can be (should be?) in TypeScript ESM

- Tools supported:

  - node
  - bun
  - pnpm or yarn?
    - probably yarn (more features, and plugin support)
  - electron
  - react native
  - ? deno
  - ? reasonml
  - maybe [moon](https://moonrepo.dev/) or wireit?

- Functionality:

  - setup node/bun version
  - simple CLI to manage the repo
  - extendable plain files (autogenerated):
    - gitignore, npmignore, etc.
  - typescript
    - auto-project references
  - dummy config strategies (doesn't do anything, but multiple strategies can use the config)
    - target strategy (node/web/react)
    - execution strategy (cli/browser/service/none)
  - dev+build strategies
    - library-types (tsc)
    - library-esm (build + creates esm/package.json with type: "module")
    - library-cjs (build + creates cjs/package.json with type: "commonjs")
    - library-umd (webpack, single file -- needs config for globalName, optionally output file)
    - [denoland/dnt](https://twitter.com/deno_land/status/1676264059585560578) for compiling maybe?
    - web-vite
    - app-electron
    - app-react-native (use Ignite? w/ expo)
  - test strategies
    - jest
    - vitest (?)
    - benchmarking
    - pure bun
    - pure node test runner?
    - eslint
    - rome.tools (now [biome](https://biomejs.dev/)) linting + formatter ?
  - ci strategies
    - github actions
      - conditionally creates testing + release based on other strategies
  - package release strategies
    - semantic-release
    - [auto](https://github.com/intuit/auto)
  - dependency update automation
    - renovate
    - dependabot
  - ide strategy
    - vscode
      - automatically hide all generated config files from the folder, but create symlinks in .config so they can be previewed in the IDE
  - project website/docs strategy
    - docusaurus
    - storybook
  - static hosting strategy
    - github pages

- Config:
  - add custom strategies via .config/strategies/... -- could re-export existing ones with custom config

## API

Just like VSCode plugins can "contribute" features, commands, settings, `repo` plugins can contribute features, tasks, files to `repo`. They can also use shared config scope to coordinate what they output.

something like:

```ts
import { gitignore, npmignore, editorconfig, license } from "@niieani/scaffold";
export const config: import("@niieani/scaffold").RepoConfig = {
  engine: "node", // or bun
  engineVersion: "20", // optional
  monorepo: false, // optional
  // infer name, author and license from package.json
  features: [gitignore(), npmignore(), editorconfig(), license()],
};
```

example implementation:

```ts
type FeatureActionFn = (
  config: RepoConfig,
  state: { files: [File] },
) => { files: [File] };

const defineFeature = ({
  actionFn,
  ...config
}: {
  name: string;
  actionFn: FeatureActionFn;
  /** set the order execution */
  after?: string[];
}) => Object.assign(actionFn, config);

const gitignore = ({ ignore }: { ignore?: string[] } = {}) =>
  defineFeature({
    name: "gitignore",
    actionFn: (config: RepoConfig, state: { files: [File] }) => {
      return {
        files: [
          {
            path: ".gitignore",
            content: ["node_modules", ...ignore].join("\n"),
          },
        ],
      };
    },
  });
```

## simple CLI to manage the repo

alternative names:

- condu (with the CLI command: `co`)

```shell
$ repo use test-jest test-eslint

# use a customized version:
$ repo use @niieani/jest @niieani/eslint

$ repo use storybook

# autogenerate config override file
$ repo use test-jest --override
```

common config might need (optionally overridable) things like:

```ts
const config = {
  main: "src/main.ts",
};
```

## eslint info

- [eslint resolver](https://github.com/import-js/eslint-import-resolver-typescript)
- potentially eslint-plugin-i
