import { Command, Option } from "clipanion";
import type { WorkspaceProjectDefined } from "../getProjectGlobsFromMoonConfig.js";
import {
  loadRepoProject,
  type Project,
  type WorkspacePackage,
} from "../loadProject.js";
import * as fs from "node:fs/promises";
import sortPackageJson from "sort-package-json";
import * as path from "node:path";
import { createCommandContext } from "../createCommandContext.js";
import { $ } from "../zx.js";
import { cd } from "zx";
import { getSingleMatch } from "../matchPackage.js";
import { copyFiles } from "@repo/core/utils/copy.js";
import { readPreviouslyWrittenFileCache } from "./apply/readWrite.js";
import { buildRemappedProject } from "@repo/update-specifiers/main.js";
import spdxLicenseList from "spdx-license-list/full.js";
import type PackageJson from "@repo/schema-types/schemas/packageJson.gen.js";
import { correctSourceMaps } from "@repo/core/utils/correctSourceMaps.js";
import { apply } from "./apply/apply.js";
import type { CollectedState } from "@repo/core/configTypes.js";
import { partition } from "remeda";

export class BeforeReleaseCommand extends Command {
  static override paths = [["before-release"]];

  // partialPath = Option.String({ required: true });
  // name = Option.String("--as");

  target = Option.String("--target");
  project = Option.String("--project,-p");
  preset = Option.String("--preset");

  packages = Option.Rest();

  async execute() {
    const applyResult = await apply();
    if (!applyResult) {
      throw new Error(`Unable to find a repo project in the current directory`);
    }
    const { project, collectedState } = applyResult;
    const selectedPackagePaths = this.packages.map(
      (packageName) =>
        getSingleMatch({
          partialPath: packageName,
          projectConventions: project.projectConventions,
        }).path,
    );
    const packages = await project.getWorkspacePackages();
    const packageList =
      selectedPackagePaths.length > 0
        ? packages.filter((pkg) => selectedPackagePaths.includes(pkg.dir))
        : packages;

    const { projectDir, config } = project;
    // TODO: make conventions non-optional in a loaded project
    const buildDirName = this.target ?? config.conventions.buildDir;
    const srcDirName = config.conventions.sourceDir;
    const absBuildDir = path.join(projectDir, buildDirName);

    await correctSourceMaps({ buildDir: absBuildDir });

    await prepareBuildDirectoryPackages({
      projectDir,
      packageList,
      absBuildDir,
      srcDirName,
      buildDirName,
      project,
      collectedState,
    });

    // TODO: just run the command in parallel during build?
    console.log(`Building remapped project...`);
    await buildRemappedProject({
      tsConfigFilePath: this.project ?? "tsconfig.json",
      mappingPreset: this.preset === "ts-to-mts" ? "to-to-mts" : "ts-to-cts",
    });
  }
}

const DECLARATION_FILE_EXT_REGEXP = /\.d\.[cm]?ts$/;
const TSCONFIG_LIKE_FILENAME_REGEXP = /tsconfig\..*\.json$/;

async function prepareBuildDirectoryPackages({
  projectDir,
  packageList,
  absBuildDir,
  srcDirName,
  buildDirName,
  project,
  collectedState,
}: {
  projectDir: string;
  packageList: readonly WorkspacePackage[];
  absBuildDir: string;
  srcDirName: string;
  buildDirName: string;
  project: Project;
  collectedState: CollectedState;
}) {
  // TODO: ensure we had run build step before this, so that the cache has been populated
  const configFileCache = await readPreviouslyWrittenFileCache(projectDir);
  const configFileAbsolutePaths = Array.from(configFileCache.keys()).map(
    (filePath) => path.join(projectDir, filePath),
  );

  for (const pkg of packageList) {
    const {
      dir: packageDir,
      manifest: { path: _p, kind: _k, ...manifest },
    } = pkg;
    const packageBuildDir = path.join(absBuildDir, packageDir);
    const packageSourceDir = path.join(projectDir, packageDir, srcDirName);
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

    const dependencyManifestOverride = getReleaseDependencies(manifest);

    const newPackageJson: PackageJson = {
      ...manifest,
      ...dependencyManifestOverride,
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
              .replace("<copyright holders>", manifest.author?.name ?? ""),
          );
        }
      }
    }
  }
}

const toCompareCase = (str: string) =>
  str.replace(/[^\dA-Za-z]/g, "").toLowerCase();

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
