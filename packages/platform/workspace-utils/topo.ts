import { basename, dirname, join, relative, resolve } from "node:path";
import glob from "fast-glob";
import { analyze, type TTopoResult } from "toposource";
import slash from "slash";
import { readWorkspaceManifest } from "@pnpm/workspace.read-manifest";

import type {
  ITopoOptionsNormalized,
  IDepEntry,
  IDepEntryEnriched,
  IPackageDeps,
  ITopoOptions,
  ITopoContext,
  IGetManifestPaths,
  IGetWorkspaceOptions,
  IWorkspaceContext,
} from "./interface.js";
import type {
  IPackageEntry,
  ConduPackageJson,
  WriteManifestFnOptions,
} from "@condu/types/configTypes.js";
import { readProjectManifest } from "@pnpm/read-project-manifest";
import sortPackageJson from "sort-package-json";
import type PackageJson from "@condu/schema-types/schemas/packageJson.gen.js";

const defaultScopes = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export const getPackages = async (
  options: IGetWorkspaceOptions,
): Promise<Record<string, IPackageEntry>> => {
  const { pkgFilter, cwd } = options;
  const manifestsPaths = await getManifestsPaths(options);
  const entries = await Promise.all<IPackageEntry>(
    manifestsPaths.map((manifestPath) => getPackage(cwd, manifestPath)),
  );

  checkDuplicates(entries);

  return entries.reduce<Record<string, IPackageEntry>>((m, entry) => {
    if (pkgFilter(entry)) {
      m[entry.name] = entry;
    }
    return m;
  }, {});
};

const checkDuplicates = (named: { name: string }[]): void | never => {
  const duplicates = named
    .map((m) => m.name)
    .filter((e, i, a) => a.lastIndexOf(e) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicated pkg names: ${duplicates.join(", ")}`);
  }
};

export const getPackage = async (
  workspaceRootDirectory: string,
  manifestPath = join(workspaceRootDirectory, "package.json"),
): Promise<IPackageEntry> => {
  const absPath = dirname(manifestPath);
  const relPath = relative(workspaceRootDirectory, absPath) || ".";
  const manifestRelPath = relative(workspaceRootDirectory, manifestPath);

  // readProjectManifest uses pnpm's types for package.json, we need to cast it to our own type
  const pnpmProjectManifestResult = await readProjectManifest(absPath);
  const manifest = pnpmProjectManifestResult.manifest as ConduPackageJson;
  const writeProjectManifest =
    pnpmProjectManifestResult.writeProjectManifest as (
      manifest: PackageJson,
      force?: boolean,
    ) => Promise<void>;

  return {
    name: manifest.name ?? basename(absPath),
    manifestRelPath,
    manifestAbsPath: manifestPath,
    manifest,
    relPath,
    absPath,
    writeProjectManifest: (
      pJson: PackageJson,
      { force, merge }: WriteManifestFnOptions = {},
    ) =>
      writeProjectManifest(
        sortPackageJson({
          ...(merge ? manifest : {}),
          ...pJson,
        }),
        force,
      ),
  };
};

export const topo = (
  packages: readonly IPackageEntry[],
  {
    depFilter = (_) => true,
    scopes = defaultScopes,
  }: Pick<ITopoOptions, "depFilter"> & { scopes?: string[] } = {},
) => {
  const { edges, nodes } = getGraph(
    packages.map((p) => p.manifest),
    depFilter,
    scopes,
  );
  const analysis = analyze([...edges, ...nodes.map<[string]>((n) => [n])]);

  return {
    edges,
    nodes,
    ...analysis,
  };
};

export const getWorkspace = async (
  options: Partial<IGetWorkspaceOptions>,
): Promise<IWorkspaceContext> => {
  const {
    cwd = process.cwd(),
    filter = (_) => true,
    pkgFilter = filter,
    workspaces,
    workspacesExtra = [],
  } = options;
  const root = await getPackage(cwd, resolve(cwd, "package.json"));
  const _options: IGetWorkspaceOptions = {
    cwd,
    filter,
    pkgFilter,
    workspacesExtra,
    workspaces: [
      ...(workspaces || (await extractWorkspaces(root))),
      ...workspacesExtra,
    ],
  };
  const packages = await getPackages(_options);
  return {
    packages,
    root,
    options: _options,
  };
};

export const topoFromWorkspace = async (
  options: Partial<ITopoOptions> = {},
): Promise<ITopoContext> => {
  const workspace = await getWorkspace(options);
  const { pkgFilter = workspace.options.filter, depFilter = (_) => true } =
    options;
  const _options: ITopoOptionsNormalized = {
    ...workspace.options,
    depFilter,
    pkgFilter,
  };
  const analysis = topo(Object.values(workspace.packages), _options);

  return {
    ...workspace,
    ...analysis,
  };
};

export const extractWorkspaces = async (root: IPackageEntry) =>
  (Array.isArray(root.manifest.workspaces)
    ? root.manifest.workspaces
    : root.manifest.workspaces?.packages) ||
  root.manifest.bolt?.workspaces ||
  (await readWorkspaceManifest(root.absPath))?.packages ||
  [];

export const getGraph = (
  manifests: ConduPackageJson[],
  depFilter: ITopoOptionsNormalized["depFilter"],
  scopes = defaultScopes,
): {
  nodes: string[];
  edges: [dependencyName: string, packageName: string][];
} => {
  const nodes = manifests.map(({ name }) => name).sort(deterministicSort);
  const edges = manifests
    .reduce<[string, string][]>((edges, pkg) => {
      const m = new Set();
      iterateDeps(
        pkg,
        ({ name, version, scope }) => {
          if (
            !m.has(name) &&
            nodes.includes(name) &&
            depFilter({ name, version, scope })
          ) {
            m.add(name);
            edges.push([name, pkg.name]);
          }
        },
        scopes,
      );

      return edges;
    }, [])
    .sort((a, b) => deterministicSort(a.join(), b.join()));

  return {
    edges,
    nodes,
  };
};

const DEFAULT_IGNORE = ["**/node_modules/**", "**/bower_components/**"];

// deterministically sort the packages by name
export const deterministicSort = <T>(a: T, b: T) =>
  a > b ? 1 : a < b ? -1 : 0;

export const getManifestsPaths = async ({
  workspaces,
  cwd,
}: IGetManifestPaths) =>
  (
    await glob(
      workspaces.map((w) => slash(join(w, "package.json"))),
      {
        cwd,
        onlyFiles: true,
        absolute: true,
        ignore: DEFAULT_IGNORE,
      },
    )
  ).sort(deterministicSort);

export const traverseQueue = async ({
  queue,
  prev,
  cb,
}: {
  queue: TTopoResult["queue"];
  prev: TTopoResult["prev"];
  cb: (name: string) => any;
}) => {
  const acc: Record<string, Promise<void>> = {};

  return Promise.all(
    queue.map(
      (name) =>
        (acc[name] = (async () => {
          await Promise.all((prev.get(name) || []).map((p) => acc[p]));
          await cb(name);
        })()),
    ),
  );
};

export const traverseDeps = async ({
  packages,
  pkg: parent,
  scopes = defaultScopes,
  cb,
}: {
  pkg: IPackageEntry;
  packages: Record<string, IPackageEntry>;
  scopes?: string[];
  cb(depEntry: IDepEntryEnriched): any;
}) => {
  const { manifest } = parent;
  const results: Promise<void>[] = [];

  iterateDeps(
    manifest,
    ({ name, version, scope, deps }) => {
      const pkg = packages[name];
      if (!pkg) return;
      results.push(
        Promise.resolve(cb({ name, version, scope, deps, pkg, parent })),
      );
    },
    scopes,
  );

  await Promise.all(results);
};

export const iterateDeps = (
  manifest: ConduPackageJson,
  cb: (ctx: IDepEntry & { deps: IPackageDeps }) => any,
  scopes = defaultScopes,
) => {
  for (const scope of scopes) {
    const deps = manifest[scope as keyof ConduPackageJson] as IPackageDeps;
    if (!deps) continue;

    for (let [name, version] of Object.entries(deps)) {
      cb({ name, version, deps, scope });
    }
  }
};
