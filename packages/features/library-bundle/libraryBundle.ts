import { defineFeature } from "@repo/core/defineFeature.js";
import type { LibraryBundleConfig } from "./types.js";
import path from "node:path";

export const libraryBundle = ({
  id,
  package: pkgName,
  entry,
  moduleTarget,
  codeTarget,
  engineTarget,
  export: exportName,
  name,
}: {
  id: string;
  // TODO: make entrypoint optional and default using the same logic as in BeforeRelease for main
  /** relative path to the entrypoint to be built */
  entry: string;
  package?: string;
} & Omit<LibraryBundleConfig, "filename" | "outDir">) =>
  defineFeature({
    name: `library-bundle:${id}`,
    actionFn: async (config, state) => {
      const packages = await config.project.getWorkspacePackages();
      const matchingPackage = pkgName
        ? [config.project, ...packages].find((p) => p.manifest.name === pkgName)
        : config.project;

      if (!matchingPackage) {
        console.error(new Error(`Could not find package ${pkgName}`));
        return;
      }

      const entryPath = path.join(matchingPackage.dir, entry);
      const packageRelativePathToEntry = path.dirname(entry);
      const entryDir = path.join(
        matchingPackage.dir,
        packageRelativePathToEntry,
      );
      const builtEntryName = `${path.basename(
        entry,
        path.extname(entry),
      )}.bundle.js`;
      const outDir = path.join(config.conventions.buildDir, entryDir);
      // TODO: right now this is incorrect
      const outDirRelativeToPackageSource = path.relative(
        matchingPackage.dir,
        outDir,
      );
      const configExtension =
        config.project.manifest.name === "toolchain" ? "ts" : "js";

      // TODO: consider using an esm transpiled webpack config with WEBPACK_CLI_FORCE_LOAD_ESM_CONFIG
      const configPathRelativeToPackage = `./.config/generated/webpack.config.cjs`;
      // const configPathRelativeToPackage = path.relative(
      //   matchingPackage.dir,
      //   path.join(config.project.dir, configPath),
      // );

      // TODO: check if entry exists

      return {
        effects: [
          {
            matchPackage: { name: matchingPackage.manifest.name },
            hooks: {
              modifyEntrySourcesForRelease(entrySources) {
                const rootEntry = { ...entrySources["."]! };
                rootEntry.import = `./${path.join(
                  packageRelativePathToEntry,
                  builtEntryName,
                )}`;
                return {
                  ...entrySources,
                  ".": rootEntry,
                };
              },
            },
            // TODO: do we want these dependencies to be repo-global or per-package?
            devDependencies: [
              "webpack",
              "webpack-cli",
              "webpack-merge",
              "@swc/core",
              "swc-loader",
            ],
            files: [
              {
                // TODO: use unique filename for each library bundle feature instance, need $id to be filename-safe
                path: configPathRelativeToPackage,
                content: `const sharedWebpackConfigFn = require('@repo-feature/library-bundle/webpack.config.cjs');
module.exports = async (env, argv) => {
  const sharedConfig = sharedWebpackConfigFn(env, argv);
  try {
    const userConfig = await Promise.resolve(require('./.config/webpack.config.cjs')).then((m) => {
      return typeof m === 'function' ? m(env, argv) : m;
    });
    const webpackMerge = require('webpack-merge');
    return webpackMerge(sharedConfig, userConfig);
  } catch {
    // ignore
  }
  return sharedConfig;
};
`,
              },
              {
                path: entryPath,
                content: `import { ${exportName} } from './${entry}';
};
`,
              },
            ],
            tasks: [
              {
                type: "build",
                name: `build-library-bundle-${id}`,
                definition: {
                  command: "webpack",
                  // TODO: source dir and config only?
                  inputs: [
                    "**/*",
                    "$workspaceRoot/yarn.lock",
                    "$workspaceRoot/features/library-bundle/webpack.config.cjs",
                  ],
                  options: {
                    cache: false,
                  },
                  // TODO: add inputs and outputs
                  args: [
                    "build",
                    "--config",
                    configPathRelativeToPackage,
                    "--entry",
                    `./${entry}`,
                    ...(moduleTarget
                      ? ["--env", `moduleTarget=${moduleTarget}`]
                      : []),
                    ...(codeTarget
                      ? ["--env", `codeTarget=${codeTarget}`]
                      : []),
                    ...(engineTarget
                      ? ["--env", `engineTarget=${engineTarget}`]
                      : []),
                    ...(exportName ? ["--env", `export=${exportName}`] : []),
                    ...(name ? ["--env", `name=${name}`] : []),
                    "--env",
                    `filename=${builtEntryName}`,
                    "--env",
                    `outDir=${outDirRelativeToPackageSource}`,
                    // "--mode",
                    // // "development",
                    // "${NODE_ENV}",
                  ],
                },
              },
            ],
          },
        ],
      };
    },
  });
