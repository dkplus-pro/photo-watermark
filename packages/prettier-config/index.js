/** @type {import("prettier").Config} */
const config = {
  arrowParens: "always",
  endOfLine: "lf",
  plugins: ["prettier-plugin-packagejson"],
  printWidth: 100,
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "none"
};

export default config;
