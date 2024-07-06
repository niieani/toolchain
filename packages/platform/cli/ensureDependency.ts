import { createNpmResolver } from "@pnpm/npm-resolver";
import { getCacheDir } from "@condu/core/utils/dirs.js";
import { createFetchFromRegistry } from "@pnpm/fetch";
import { createGetAuthHeaderByURI } from "@pnpm/network.auth-header";
import type PackageJson from "@condu/schema-types/schemas/packageJson.gen.js";
import type { DependencyDef } from "@condu/core/configTypes.js";

const registry = "https://registry.npmjs.org/";
const { resolveFromNpm } = createNpmResolver(
  createFetchFromRegistry({}),
  // async (url) => {
  //   // @ts-expect-error pnpm types are wrong, it used node-fetch internally which isn't necessary
  //   const result: Promise<import("node-fetch").Response> = fetch(url);
  //   return result;
  // },
  createGetAuthHeaderByURI({ allSettings: {} }),
  // (uri) => {
  //   return undefined;
  // },
  { offline: false, cacheDir: getCacheDir(process) },
);

export async function ensureDependency({
  packageAlias,
  manifest,
  versionOrTag = "latest",
  target = "dependencies",
  skipIfExists = true,
}: DependencyDef & {
  manifest: PackageJson;
}) {
  const targetDependencyList = (manifest[target] ||= {});
  if (skipIfExists && targetDependencyList[packageAlias]) {
    return false;
  }
  const dependency = await resolveFromNpm(
    { alias: packageAlias, pref: versionOrTag },
    { registry },
  );
  if (!dependency || !dependency.manifest) {
    throw new Error(`no ${packageAlias} dependency found in the repository`);
  }

  const pkgDescriptor = `${
    dependency.manifest.name !== packageAlias
      ? `npm:${dependency.manifest.name}@`
      : ""
  }^${dependency.manifest.version}`;
  if (targetDependencyList[packageAlias] === pkgDescriptor) {
    return false;
  }
  targetDependencyList[packageAlias] = pkgDescriptor;
  return true;
}
