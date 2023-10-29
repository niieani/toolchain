import { Command, Option } from "clipanion";
import type { WorkspaceProjectDefined } from "../getProjectGlobsFromMoonConfig.js";
import { loadRepoProject } from "../loadProject.js";
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

export class BeforeReleaseCommand extends Command {
  static override paths = [["before-release"]];

  // partialPath = Option.String({ required: true });
  // name = Option.String("--as");

  target = Option.String("--target");

  project = Option.String("--project,-p");
  preset = Option.String("--preset");

  packages = Option.Rest();

  async execute() {
    const project = await loadRepoProject();
    if (!project) {
      throw new Error(`Unable to find a repo project in the current directory`);
    }
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
    const buildDirName = this.target ?? config.conventions?.buildDir ?? "dist";
    const srcDirName = config.conventions?.sourceDir ?? "src";
    const absBuildDir = path.join(projectDir, buildDirName);

    const configFileCache = await readPreviouslyWrittenFileCache(projectDir);
    const configFileAbsolutePaths = Object.keys(configFileCache).map(
      (filePath) => path.join(projectDir, filePath),
    );

    for (const pkg of packageList) {
      const { dir: packageDir, manifest } = pkg;
      const packageBuildDir = path.join(absBuildDir, packageDir);
      const sourceDir = path.join(projectDir, packageDir, srcDirName);
      console.log(
        `Copying ${packageDir} for ${manifest.name} to ${buildDirName}`,
      );
      const existingLicensePaths = new Set<string>();
      // copy all the project files
      await copyFiles({
        sourceDir,
        targetDir: packageBuildDir,
        filter: ({ entry, directoryPath }) => {
          // do not keep test files, fixtures, d.ts files, tsconfig.json, nor files generated by this tool
          // TODO: document this behavior
          const fullPath = path.join(directoryPath, entry.name);
          const isTestFile = entry.name.includes(".test.");
          const isFixtureFile = entry.name.includes(".fixture.");
          const isTypeScriptDeclarationFile = /\.d\.[cm]?ts$/.test(entry.name);
          const isTypeScriptConfigFile = /tsconfig\..*\.json$/.test(entry.name);
          const isPackageJson = entry.name === "package.json";
          const isConfigFile = configFileAbsolutePaths.includes(fullPath);
          const isNodeModules = entry.name === "node_modules";
          const isDotFile = entry.name.startsWith(".");
          if (entry.name === "LICENSE") {
            existingLicensePaths.add(fullPath);
          }

          return (
            !isTestFile &&
            !isFixtureFile &&
            !isTypeScriptDeclarationFile &&
            !isTypeScriptConfigFile &&
            !isPackageJson &&
            !isConfigFile &&
            !isNodeModules &&
            !isDotFile
          );
        },
      });
      const newPackageJson = {
        ...manifest,
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
      // save new package.json:
      await fs.writeFile(
        path.join(packageBuildDir, "package.json"),
        JSON.stringify(sortPackageJson(newPackageJson), undefined, 2),
      );
      if (manifest.license && manifest.license !== "UNLICENSED") {
        // in addition, copy LICENSE if it doesn't exist:
        const licenseDefinition = spdxLicenseList[manifest.license];
        if (licenseDefinition) {
          const licenseFilePath = path.join(packageBuildDir, "LICENSE");
          if (!existingLicensePaths.has(licenseFilePath)) {
            // add LICENSE where missing
            await fs.writeFile(licenseFilePath, licenseDefinition.licenseText);
          }
        }
      }
    }

    await buildRemappedProject({
      tsConfigFilePath: this.project ?? "tsconfig.json",
      mappingPreset: this.preset === "ts-to-mts" ? "to-to-mts" : "ts-to-cts",
    });
  }
}
