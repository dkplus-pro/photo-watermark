const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

describe("CI/CD shell scripts", () => {
  const root = process.cwd();
  const scripts = [
    "scripts/ci.sh",
    "scripts/verify.sh",
    "scripts/deploy-github-pages.sh",
    "scripts/lib/ci-common.sh"
  ];

  test.each(scripts)("%s exists and parses as bash", (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    expect(fs.existsSync(absolutePath)).toBe(true);
    execFileSync("bash", ["-n", absolutePath], { stdio: "pipe" });
  });

  test.each(["scripts/ci.sh", "scripts/verify.sh", "scripts/deploy-github-pages.sh"])(
    "%s is executable",
    (relativePath) => {
      const mode = fs.statSync(path.join(root, relativePath)).mode;
      expect(mode & 0o111).toBeTruthy();
    }
  );
});
