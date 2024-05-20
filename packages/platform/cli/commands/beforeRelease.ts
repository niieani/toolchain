import type { Project } from "../loadProject.js";
import type {
  WorkspacePackage,
  type CollectedState,
} from "@condu/core/configTypes.js";
import * as fs from "node:fs/promises";
import sortPackageJson from "sort-package-json";
import * as path from "node:path";
import { copyFiles } from "@condu/core/utils/copy.js";
import { readPreviouslyWrittenFileCache } from "./apply/readWrite.js";
import spdxLicenseList from "spdx-license-list/full.js";
import type PackageJson from "@condu/schema-types/schemas/packageJson.gen.js";
import { partition } from "remeda";
import { getSingleMatch } from "../matchPackage.js";
import { apply } from "./apply/apply.js";
import { topo } from "@condu/workspace-utils/topo.js";

const DECLARATION_FILE_EXT_REGEXP = /\.d\.[cm]?ts$/;
const TSCONFIG_LIKE_FILENAME_REGEXP = /tsconfig\..*\.json$/;

/**
 * Prepares the packages in 'build' directory for release:
 * - Copies non-JS files from packages to the 'build' directory.
 * - Ensures there is a LICENSE
 * - Fills in package.json fields.
 */
export async function prepareBuildDirectoryPackages({
  workspaceDirAbs,
  packagesToPrepare,
  absBuildDir,
  srcDirName,
  buildDirName,
  project,
  collectedState,
}: {
  workspaceDirAbs: string;
  packagesToPrepare: readonly WorkspacePackage[];
  absBuildDir: string;
  srcDirName: string;
  buildDirName: string;
  project: Project;
  collectedState: CollectedState;
}) {
  // TODO: ensure we had run build step before this, so that the cache has been populated
  const configFileCache = await readPreviouslyWrittenFileCache(workspaceDirAbs);
  const configFileAbsolutePaths = Array.from(configFileCache.keys()).map(
    (filePath) => path.join(workspaceDirAbs, filePath),
  );

  const { queue } = topo(packagesToPrepare);
  const packagesToPrepareObj = Object.fromEntries(
    packagesToPrepare.map((pkg) => [pkg.name, pkg]),
  );

  for (const name of queue) {
    const pkg = packagesToPrepareObj[name]!;
    const { relPath: packageDir, manifest } = pkg;
    const packageBuildDir = path.join(absBuildDir, packageDir);
    const packageSourceDir = path.join(workspaceDirAbs, packageDir, srcDirName);
    console.log(
      `Copying ${packageDir} for ${manifest.name} to ${buildDirName}`,
    );
    const existingLicensePaths = new Set<string>();
    const preferredDirectoryEntries = new Map<string, string>();
    // copy all the project files
    void (await copyFiles({
      sourceDir: packageSourceDir,
      targetDir: packageBuildDir,
      filter: ({ entry, directoryPath }) => {
        const isDotFile = entry.name.startsWith(".");
        if (entry.isDirectory()) {
          const isNodeModules = entry.name === "node_modules";
          return !isNodeModules && !isDotFile;
        }
        // do not keep test files, fixtures, d.ts files, tsconfig.json, nor files generated by this tool
        // TODO: document this behavior
        const fullPath = path.join(directoryPath, entry.name);
        const isTestFile = entry.name.includes(".test.");
        const isFixtureFile = entry.name.includes(".fixture.");
        const isTypeScriptDeclarationFile = DECLARATION_FILE_EXT_REGEXP.test(
          entry.name,
        );
        const isTypeScriptConfigFile = TSCONFIG_LIKE_FILENAME_REGEXP.test(
          entry.name,
        );
        const isPackageJson = entry.name === "package.json";
        const isGeneratedConfigFile =
          configFileAbsolutePaths.includes(fullPath);
        if (entry.name === "LICENSE") {
          existingLicensePaths.add(fullPath);
        }

        const isPublishableFile =
          !isTestFile &&
          !isFixtureFile &&
          !isTypeScriptDeclarationFile &&
          !isTypeScriptConfigFile &&
          !isPackageJson &&
          !isGeneratedConfigFile &&
          !isDotFile;

        if (isPublishableFile && /\.[cm]?[jt]s$/.test(entry.name)) {
          const directoryBaseName = path.basename(directoryPath);
          const basename = path.basename(entry.name, path.extname(entry.name));
          const existingPreference =
            preferredDirectoryEntries.get(directoryPath);
          if (
            basename === "index" ||
            (basename === "main" && !existingPreference?.startsWith("index")) ||
            (!existingPreference &&
              (basename === directoryBaseName ||
                toCompareCase(basename) === toCompareCase(directoryBaseName)))
          ) {
            preferredDirectoryEntries.set(directoryPath, entry.name);
          }
        }

        return isPublishableFile;
      },
    }));

    const generatedEntrySources = Object.fromEntries(
      [...preferredDirectoryEntries].map(([dir, entry]) => {
        const pathToDir = path.relative(packageSourceDir, dir);
        const basename = path.basename(entry, path.extname(entry));
        const suffixedPath = pathToDir === "" ? pathToDir : `${pathToDir}/`;

        return [
          pathToDir === "" ? "." : `./${pathToDir}`,
          {
            types: `./${suffixedPath}${basename}.d.ts`,
            source: `./${suffixedPath}${entry}`,
            bun: `./${suffixedPath}${entry}`,
            import: `./${suffixedPath}${basename}.js`,
            // TODO: support CJS-first projects (i.e. 'js' is CJS, '.mjs' is ESM)
            require: `./${suffixedPath}${basename}.cjs`,
            default: `./${suffixedPath}${basename}.js`,
          },
        ];
      }),
    );

    const hooks = collectedState.hooksByPackage[manifest.name];
    const entrySources =
      (await hooks?.modifyEntrySourcesForRelease?.(generatedEntrySources)) ??
      generatedEntrySources;

    // TODO: logic to update package.jsons for release
    const dependencyManifestOverride = getReleaseDependencies(manifest);

    // omit 'directory' from publishConfig in the published package.json
    const { directory: _, ...publishConfig } = manifest.publishConfig ?? {};

    const newPackageJson: PackageJson = {
      ...manifest,
      ...dependencyManifestOverride,
      version: manifest.version ?? "0.0.0",
      publishConfig: {
        // access: "public",
        registry: project.config.publish?.registry,
        ...publishConfig,
      },
      exports: {
        ...entrySources,
        "./*.json": "./*.json",
        "./*.js": {
          types: `./*.d.ts`,
          bun: `./*.ts`,
          import: `./*.js`,
          require: `./*.cjs`,
          default: `./*.js`,
        },
        ...(typeof manifest.exports === "object" ? manifest.exports : {}),
      },
      main: entrySources["."]?.require,
      module: entrySources["."]?.import,
      source: entrySources["."]?.source,
      // TODO: types is probably unnecessary?
      // types: entrySources["."]?.types,
      // TODO: funding
      // TODO: support CJS-first projects (maybe?)
      type: "module",

      // TODO: add unpkg/browser support for cases when bundling (webpack or rollup)
      // jsdelivr, skypack

      // set all necessary fields for deployment:
      // main: "dist/index.js",
      // types: "dist/index.d.ts",
      // files: ["dist"],
      // publishConfig: {
      //   access: "public",
      // },
      // repository: {
      //   type: "git",
      //   url: "",
      // },
    };

    const transformedPackageJson =
      (await hooks?.modifyPublishPackageJson?.(newPackageJson)) ??
      newPackageJson;

    // save new package.json:
    await fs.writeFile(
      path.join(packageBuildDir, "package.json"),
      JSON.stringify(sortPackageJson(transformedPackageJson), undefined, 2),
    );

    const license = manifest.license ?? project.manifest.license;
    // TODO: support copying LICENSE from root of project if it exists
    if (license && license !== "UNLICENSED") {
      // in addition, copy LICENSE if it doesn't exist:
      const licenseDefinition = spdxLicenseList[license];
      if (licenseDefinition) {
        const licenseFilePath = path.join(packageBuildDir, "LICENSE");
        if (!existingLicensePaths.has(licenseFilePath)) {
          // add LICENSE where missing
          await fs.writeFile(
            licenseFilePath,
            licenseDefinition.licenseText
              // TODO: add start year based on git history
              .replace("<year>", new Date().getFullYear().toString())
              .replace(
                "<copyright holders>",
                manifest.author?.name ?? project.manifest.author?.name ?? "",
              ),
          );
        }
      }
    }
  }
}

const toCompareCase = (str: string) =>
  str.replace(/[^\dA-Za-z]/g, "").toLowerCase();

/**
 * If 'publishDependencies' are defined in the package.json,
 * returns the new fields for the package.json to be published.
 */
function getReleaseDependencies(manifest: PackageJson) {
  const keepDependencies = Array.isArray(manifest["publishDependencies"])
    ? manifest["publishDependencies"]
    : undefined;
  const dependencyEntries = Object.entries(manifest.dependencies ?? {});
  const [finalDependencyEntries, removedDependencyEntries] = keepDependencies
    ? partition(dependencyEntries, ([dep]) =>
        keepDependencies.some((keepDep) =>
          keepDep.startsWith("@") ? dep.startsWith(keepDep) : dep === keepDep,
        ),
      )
    : ([dependencyEntries, []] as const);

  const dependencyManifestOverride = {
    dependencies: Object.fromEntries(finalDependencyEntries),
    ...(removedDependencyEntries.length > 0
      ? {
          peerDependencies: {
            ...manifest.peerDependencies,
            ...Object.fromEntries(removedDependencyEntries),
          },
          peerDependenciesMeta: {
            ...manifest.peerDependenciesMeta,
            ...Object.fromEntries(
              removedDependencyEntries.map(([dep]) => [
                dep,
                { optional: true },
              ]),
            ),
          },
        }
      : {}),
  };
  return dependencyManifestOverride;
}

export async function beforeReleasePipeline({
  ci = Boolean(process.env["CI"]),
  ...input
}: {
  packages: string[];
  ci?: boolean;
}) {
  const applyResult = await apply({ throwOnManualChanges: true });
  if (!applyResult) {
    throw new Error(`Unable to find a condu project in the current directory`);
  }
  const { project, collectedState } = applyResult;
  const selectedPackagePaths = input.packages.map(
    (packageName) =>
      getSingleMatch({
        partialPath: packageName,
        projectConventions: project.projectConventions,
      }).path,
  );
  const packages = await project.getWorkspacePackages();

  const [selectedPackages, unselectedPackages] =
    selectedPackagePaths.length > 0
      ? partition(packages, (pkg) => selectedPackagePaths.includes(pkg.relPath))
      : [packages, []];

  if (selectedPackages.length === 0) {
    throw new Error(`No packages found to prepare for release.`);
  }

  const { absPath: workspaceDirAbs, config } = project;
  // TODO: make conventions non-optional in a loaded project
  const buildDirName = config.conventions.buildDir;
  const srcDirName = config.conventions.sourceDir;
  const absBuildDir = path.join(workspaceDirAbs, buildDirName);

  // await correctSourceMaps({ buildDir: absBuildDir });

  await prepareBuildDirectoryPackages({
    workspaceDirAbs,
    packagesToPrepare: selectedPackages,
    absBuildDir,
    srcDirName,
    buildDirName,
    project,
    collectedState,
  });

  if (ci) {
    // mark all the non-selected packages as private in the package.json
    await Promise.all(
      unselectedPackages
        .filter((pkg) => !pkg.manifest.private)
        .map((pkg) =>
          pkg.writeProjectManifest({
            ...pkg.manifest,
            $internal$: true,
            private: true,
          }),
        ),
    );
  }
}
