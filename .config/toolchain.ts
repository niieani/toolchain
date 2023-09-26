import { gitignore } from "../packages/features/gitignore/gitignore.js";
import { moon } from "../packages/features/moon/moon.js";
import { moonCi } from "../packages/features/ci-github-actions/moon.js";
import { configure } from "../packages/platform/core/configTypes.js";

export default configure({
  engine: "bun",
  projects: [
    { parentPath: "packages/features", nameConvention: "@repo-feature/*" },
    { parentPath: "packages/platform", nameConvention: "@repo/*" },
  ],
  features: [moon(), moonCi(), gitignore({ ignore: [".swc/"] })],
});
