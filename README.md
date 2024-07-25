# project codename: condu

NOTE: the codename "condu" is not final and is likely to change.

One config to rule them all.

Configuration as code. Think about condu as terraform for your repository configuration.

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

`condu` fixes [this](https://twitter.com/WarrenInTheBuff/status/1672839156647575552) long list of files in your root of repo:

- tsconfig.json
- .eslintrc
- .prettierrc
- .babel.config.js (implied child .babelrc)
- .webpack.config.js
- jest.config.js
- .env
- docker-compose.yml
- gitlab-ci.yml
- .npmrc
- .editorconfig

and [this](https://deno.com/blog/node-config-hell)

and [this](https://www.youtube.com/watch?v=wYdnJPYFTIE),

and [this](https://x.com/_swanson/status/1715073746073973203).

and [this](https://twitter.com/mattpocockuk/status/1792270311334854822)

`condu` is here to help out.

## Philosophy / conventions

- Publish and expose all files
- So often it happens that a package has a function that's even exported, but the package uses a build system, that ends up making it private.

## More

Embrace convention over configuration, but allow for easy configuration overrides.

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
    - passes [arethetypeswrong](https://arethetypeswrong.github.io/) tests with flying colors
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
  - dependency management strategies
    - lerna
    - yarn workspaces
    - pnpm
    - syncpack (ensuring version ranges sync across packages)
  - ide strategy
    - vscode
      - automatically hide all generated config files from the folder, but create symlinks in .config so they can be previewed in the IDE
      - local workspace settings ([#40233](https://github.com/microsoft/vscode/issues/40233))
  - project website/docs strategy
    - docusaurus
    - storybook
  - static hosting strategy
    - github pages
  - security
    - support [npm package provenance](https://github.blog/2023-04-19-introducing-npm-package-provenance/) OOTB

- Config:
  - add custom strategies via .config/strategies/... -- could re-export existing ones with custom config

## API

Just like VSCode plugins can "contribute" features, commands, settings, `condu` plugins can contribute features, tasks, files to `condu`. They can also use shared config scope to coordinate what they output.

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

names ideas:

- condu (with shorter the CLI command: `co`)
- repo
- strata (the idea of layers or strata, relating to the project's feature-based architecture)
- automi

```shell
$ condu use test-jest test-eslint

# use a customized version:
$ condu use @niieani/jest @niieani/eslint

$ condu use storybook

# autogenerate config override file
$ condu use test-jest --override
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

## other things to talk about:

- I consider the default of `exports` [encapsulation](https://nodejs.org/api/packages.html#package-entry-points) harmful to the Node JS ecosystem. `exports` are usually set without much attention to detail, leading to conservative settings - often times you need to use an utility of a dependency, rather than a function exposed on the main API, yet you can't access that utility due to the encapsulation. It is also not a real guarrantee of privacy, since as Node itself mentions:

> It is not a strong encapsulation since a direct require of any absolute subpath of the package such as require('/path/to/node_modules/pkg/subpath.js') will still load subpath.js.

- Files named 'index' or 'main' are not too useful, prefer using real names (automation)
- default exports are considered an anti-pattern due to complexities with ESM/CJS interop

## How to setup in your project

TODO: this should be automated by running `npx condu install`, which would generate a template config and run apply.

1. add postinstall script: `test -f .config/condu.ts && yarn condu apply`
2. if using yarn, add plugin
3. configure features you'd like to use
