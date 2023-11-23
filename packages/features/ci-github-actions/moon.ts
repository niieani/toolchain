import { defineFeature } from "@repo/core/defineFeature.js";
import type GithubWorkflow from "@repo/schema-types/schemas/githubWorkflow.gen.js";
import type {
  PartialTaskConfig,
  PartialInheritedTasksConfig as Tasks,
  PartialProjectConfig as Project,
} from "@moonrepo/types";
import { otherSchemas as schemas } from "@repo/schema-types/utils/schemas.js";
import { mapValues, groupBy, uniq, partition } from "remeda";
import type { FileDef, Task } from "@repo/core/configTypes.js";
import { nonEmpty } from "@repo/core/utils/filter.js";
import { match } from "ts-pattern";

// TODO: the way this should actually work is it should be a moonCi feature that contributes "ci" commands to state
// then the Github Actions CI pulls those commands in
export const moonCi = ({}: {} = {}) =>
  defineFeature({
    name: "moonCi",
    order: { priority: "end" },
    actionFn: async (config, state) => {
      const ciWorkflow: GithubWorkflow = {
        name: "Moon CI",
        on: {
          push: { branches: [config.git.defaultBranch] },
          pull_request: {},
        },
        jobs: {
          ci: {
            name: "Moon CI",
            "runs-on": "ubuntu-latest",
            steps: [
              {
                uses: "actions/checkout@v4",
                with: { "fetch-depth": 0 },
              },
              {
                uses: "actions/setup-node@v3",
                with: {
                  "node-version": config.node.version,
                  cache: config.node.packageManager.name,
                },
              },
              { run: `${config.node.packageManager.name} install --immutable` },
              {
                run: `./node_modules/@moonrepo/cli/moon ci`,
                env: {
                  MOON_TOOLCHAIN_FORCE_GLOBALS: "true",
                },
              },
            ],
          },
        },
      };

      const projects = [
        ...(await config.project.getWorkspacePackages()),
        config.project,
      ];
      const taskList = state.tasks;
      const tasksByType: Record<
        Task["type"],
        [projectName: string, taskName: string][]
      > = {
        build: [],
        test: [],
        format: [],
        publish: [],
        start: [],
      };
      const taskFiles = projects.flatMap((project) => {
        const tasks = taskList.flatMap((task) => {
          if (task.name in tasksByType) {
            throw new Error(
              `In ${project.manifest.name}: Task name '${task.name}' is reserved for the global task type`,
            );
          }
          return match(project.manifest)
            .with(task.matchPackage ?? { kind: "workspace" }, () => {
              tasksByType[task.type].push([project.manifest.name, task.name]);
              return [[task.name, task.definition]] as const;
            })
            .otherwise(() => []);
        });
        if (tasks.length === 0 && project.manifest.kind === "package") {
          return [];
        }
        return {
          path: "moon.yml",
          content: {
            $schema: schemas.project,
            tasks:
              project.manifest.kind === "package"
                ? Object.fromEntries(tasks)
                : {
                    ...Object.fromEntries(tasks),
                    // add in type-tasks
                    ...mapValues(
                      tasksByType,
                      (tasks): PartialTaskConfig =>
                        // this groups all the tasks of the same type into a single task
                        // so that all the features implementing the same task type (e.g. 'test') can be run in parallel
                        ({
                          // ~ is self-referencing task: https://moonrepo.dev/docs/concepts/target#self-
                          deps: tasks.map(
                            ([projectName, taskName]) =>
                              `${projectName}:${taskName}`,
                          ),
                          inputs: [],
                        }),
                    ),
                  },
          } satisfies Project,
          matchPackage: {
            name: project.manifest.name,
            kind: project.manifest.kind,
          },
        } as const;
      });

      const sourceExtensionsConcatenated =
        config.conventions.sourceExtensions.join(",");

      return {
        files: [
          ...taskFiles,
          {
            path: ".github/workflows/moon-ci.yml",
            type: "committed",
            publish: false,
            content: ciWorkflow,
          },
          {
            path: ".moon/tasks.yml",
            content: {
              $schema: schemas.tasks,
              fileGroups: {
                sources: [
                  `${config.conventions.sourceDir}/**/*.{${sourceExtensionsConcatenated}}`,
                ],
                tests: [
                  `${config.conventions.sourceDir}/**/*.test.{${sourceExtensionsConcatenated}}`,
                ],
              },
            } satisfies Tasks,
          },
        ],
        flags: ["preventAdditionalTasks"],
      };
    },
  });
