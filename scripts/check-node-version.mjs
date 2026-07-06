const major = Number(process.versions.node.split(".")[0]);

if (major !== 20) {
  console.error(`F.U.N requires Node 20.x. Current Node is ${process.version}.`);
  console.error('Run: export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 20');
  process.exit(1);
}
