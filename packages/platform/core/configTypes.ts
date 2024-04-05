import type { PartialProjectConfig, PartialTaskConfig } from "@moonrepo/types";
import type { WorkspaceProjectsConvention } from "@condu/cli/getProjectGlobsFromMoonConfig.js";
import type PackageJson from "@condu/schema-types/schemas/packageJson.gen.js";
import type { Pattern } from "ts-pattern";
import type { Project } from "@condu/cli/loadProject.js";

export interface DependencyDef {
  packageAlias: string;
  versionOrTag?: string;
  target?: "dependencies" | "devDependencies" | "optionalDependencies";
  skipIfExists?: boolean;
}

export interface Task {
  // TODO: allow matching which package the task belongs to, like with Files (matchPackage)
  name: string;
  type: "test" | "build" | "publish" | "format" | "start";
  definition: PartialTaskConfig;
}

export interface FileDef {
  /**
   * should this file be ephemeral and is always regenerated by the apply tool (default),
   * or should it be committed?
   * will affect the behavior for features like gitignore
   **/
  type?: "ephemeral" | "committed";
  /** should this file be published when making a distributable package */
  publish?: boolean;
  /**
   * if you need to access 'state' (e.g. to list all files or tasks),
   * using a function is preferable, as it will be executed *after* all the state had been collected,
   * rather than during its collection, as is the case with pure string or object.
   *
   * if returned an object, the correct stringifier is chosen based on the file extension
   * if a string is returned, it will be written as-is
   **/
  // TODO: support function (previousContent, packageJson) => string | object
  content?:
    | string
    | object
    | ((opts: {
        manifest: RepoPackageJson;
        getExistingContentAndMarkAsUserEditable: () =>
          | Promise<string | object | undefined>
          | string
          | object
          | undefined;
      }) => Promise<string | object> | string | object);
  path: string;
}

/*
what if enabling the features is done by a simple list file (defaults),
but if you want to customize, you then create a config file?
*/

export interface RepoPackageConfig
  extends Pick<
    PartialProjectConfig,
    "language" | "platform" | "tags" | "type"
  > {}

export interface RepoPackageJson extends PackageJson {
  // name is mandatory
  name: string;
  condu?: RepoPackageConfig;
  /** absolute directory of the package */
  path: string;
  /** relative directory of the package (from workspace dir) */
  workspacePath: string;
  kind: "workspace" | "package";
}

export interface CollectedTaskDef extends Task {
  featureName: string;
  target: RepoPackageJson;
}

export interface CollectedFileDef extends FileDef {
  featureName: string;
  /**
   * set to true if the file should not be ignored,
   * or list the feature names by which it should be ignored
   *
   * prefer to use type: 'committed' instead, this is used internally
   **/
  skipIgnore?: boolean | string[];
  targetDir: string;
  target: RepoPackageJson;
}

export type EntrySources = Record<
  string,
  {
    types: string;
    source: string;
    bun: string;
    import: string;
    require: string;
    default: string;
  }
>;

export interface Hooks {
  modifyPublishPackageJson: (
    packageJson: PackageJson,
  ) => PackageJson | Promise<PackageJson>;
  modifyEntrySourcesForRelease: (
    entrySources: EntrySources,
  ) => EntrySources | Promise<EntrySources>;
}

export interface CollectedState {
  /** these files will be created during execution */
  files: CollectedFileDef[];
  /** we'll ensure these dependencies are installed during execution */
  devDependencies: (string | DependencyDef)[];
  tasks: CollectedTaskDef[];
  hooksByPackage: {
    [packageName: string]: Partial<Hooks>;
  };
}

export interface StateFlags {
  preventAdditionalTasks?: boolean;
}

export type ToIntermediateState<T> = {
  [P in keyof T]?: T[P] extends Array<infer O>
    ? ReadonlyArray<O | false | undefined>
    : T[P];
};

export type Effects = {
  /** these files will be created during execution */
  files?: ReadonlyArray<FileDef | false | undefined>;
  tasks?: ReadonlyArray<Task | false | undefined>;
  hooks?: Partial<Hooks>;

  /** we'll ensure these dependencies are installed during execution */
  devDependencies?: (string | DependencyDef)[];

  /**
   * ts-pattern for package.jsons that the state applies to. Defaults to workspace.
   * @default { kind: "workspace" }
   * */
  matchPackage?: Pattern.Pattern<RepoPackageJson> | Partial<RepoPackageJson>;
};

export interface FeatureResult {
  effects?: (Effects | null | undefined | false)[];
  flags?: ReadonlyArray<keyof StateFlags>;
}

export type FeatureActionFn = (
  config: RepoConfigWithInferredValuesAndProject,
  /**
   * TODO: consider lifting 'state' argument to 'content' function of files
   * since the state here is only "collected till now"
   **/
  state: CollectedState,
) => FeatureResult | Promise<FeatureResult | void> | void;

export interface FeatureDefinition {
  actionFn: FeatureActionFn;
  name: string;
  order?: {
    after?: Array<string>;
    priority?: "beginning" | "end";
  };
}

export interface Conventions {
  /** @default 'src' */
  sourceDir?: string;
  sourceExtensions?: string[];
  buildDir?: string;
}

type GitConfig = {
  /** inferred from git if empty */
  defaultBranch?: string;
};

type NodeConfig = {
  /** @default 'yarn' */
  packageManager?: {
    name: "yarn" | "npm" | "pnpm";
    version?: string;
  };
  version?: string;
};

export interface RepoConfig {
  /** primary engine used to run the tool */
  engine: "node" | "bun";
  // node: PartialNodeConfig;
  node?: NodeConfig;
  git?: GitConfig;
  features: FeatureDefinition[];
  /** when present, assumes monorepo */
  projects?: WorkspaceProjectsConvention[];
  conventions?: Conventions;
}

export const CONFIGURED = Symbol.for("Configured");

export interface ConfiguredRepoConfig extends RepoConfig {
  [CONFIGURED]: true;
}

export const configure = (config: RepoConfig): ConfiguredRepoConfig => ({
  ...config,
  [CONFIGURED]: true,
});

export interface RepoConfigWithInferredValues extends ConfiguredRepoConfig {
  // TODO: add error / warning functions
  workspaceDir: string;
  configDir: string;
  conventions: Required<Conventions>;
  git: Required<GitConfig>;
  node: Required<NodeConfig>;
}

export interface RepoConfigWithInferredValuesAndProject
  extends RepoConfigWithInferredValues {
  project: Omit<Project, "writeProjectManifest">;
}
