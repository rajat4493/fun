import fs from "node:fs";

const required = fs.readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim().replace(/^v/, "");
const major = process.versions.node.split(".")[0];

if (major !== required) {
  console.error(`F.U.N requires Node ${required}.x. Current Node is ${process.version}.`);
  console.error(`Run: nvm install ${required} && nvm use ${required}`);
  process.exit(1);
}
