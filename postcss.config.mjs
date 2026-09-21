import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".html"]);

function sourceFiles(path) {
  if (statSync(path).isFile()) return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  return readdirSync(path).flatMap((name) => sourceFiles(join(path, name)));
}

// CSS accumulated across several retired prototypes. Keep the source readable,
// but only ship selectors whose class tokens still exist in the live app. The
// broad token scan is deliberately conservative: false positives cost a few
// bytes, while dynamic JSX classes remain safe.
const sourceTokens = new Set(
  [...sourceFiles("src"), "index.html"]
    .flatMap((file) => readFileSync(file, "utf8").match(/[A-Za-z_][A-Za-z0-9_-]*/g) ?? []),
);

// These families are assembled dynamically (for example `bud-json-${kind}`),
// so their complete class names do not always appear as one source token.
const dynamicFamilies = [/^bud-/, /^cmdk(?:-|$)/, /^insp-/, /^rn-/, /^sk(?:-|$)/, /^t-/];
const classPattern = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g;

function classNames(selector) {
  return [...selector.matchAll(classPattern)].map((match) => match[1]);
}

function isLiveClass(name) {
  return sourceTokens.has(name) || dynamicFamilies.some((pattern) => pattern.test(name));
}

function pruneUnusedSelectors() {
  return {
    postcssPlugin: "orbitodb-prune-unused-selectors",
    Rule(rule) {
      if (!rule.selector) return;
      const liveSelectors = rule.selectors.filter((selector) => {
        const names = classNames(selector);
        return names.length === 0 || names.every(isLiveClass);
      });
      if (liveSelectors.length === 0) rule.remove();
      else if (liveSelectors.length !== rule.selectors.length) rule.selectors = liveSelectors;
    },
    OnceExit(root) {
      root.walkAtRules((rule) => {
        if (rule.nodes && rule.nodes.length === 0) rule.remove();
      });
    },
  };
}

pruneUnusedSelectors.postcss = true;

export default {
  plugins: [pruneUnusedSelectors()],
};
