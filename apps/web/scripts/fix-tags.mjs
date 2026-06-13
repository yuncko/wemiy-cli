import fs from "fs";
import path from "path";

const root = path.join(import.meta.dirname, "..", "src");
const badOpen = "<" + "motion";
const goodOpen = "<" + "div";
const badClose = "</" + "motion" + ">";
const goodClose = "</" + "div";

function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) {
      let t = fs.readFileSync(p, "utf8");
      const o = t;
      t = t.replaceAll(badClose, goodClose);
      t = t.replaceAll(badOpen, goodOpen);
      if (o !== t) {
        fs.writeFileSync(p, t);
        console.log("fixed", p);
      }
    }
  }
}

walk(root);
