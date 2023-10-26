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

export class BeforeReleaseCommand extends Command {
  static override paths = [["before-release"]];

  // partialPath = Option.String({ required: true });
  // name = Option.String("--as");

  target = Option.String("--target");
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
    const target = this.target ?? config.conventions?.distDir ?? "dist";
    const distDir = path.join(projectDir, target);
    for (const pkg of packageList) {
      const { dir: packageDir, manifest } = pkg;
      const packageDistDir = path.join(distDir, packageDir);
      const sourceDir = path.join(projectDir, packageDir);
      console.log(`Copying ${packageDir} for ${manifest.name} to ${target}`);
      // copy all the project files
      await copyFiles({
        sourceDir,
        targetDir: packageDistDir,
        // TODO: do not keep test files, fixtures, d.ts files, tsconfig.json, files generated by this tool
        filter: ({ entry: { name } }) => !name.startsWith("."),
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
        path.join(packageDistDir, "package.json"),
        JSON.stringify(sortPackageJson(newPackageJson), undefined, 2),
      );
      // in addition, copy LICENSE if it doesn't exist:
    }
  }
}
