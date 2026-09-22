const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [1, "always", 120],
    "footer-max-line-length": [1, "always", 120],
    "scope-case": [2, "always", ["kebab-case", "lower-case"]],
    "subject-case": [2, "never", ["pascal-case", "sentence-case", "start-case", "upper-case"]]
  }
};

export default config;
