// Cross-platform helper: node scripts/with-env.js KEY=value <command...>
const { spawn } = require("child_process");
const args = process.argv.slice(2);
const env = { ...process.env };
while (args[0] && /^\w+=/.test(args[0])) { const [k, ...v] = args.shift().split("="); env[k] = v.join("="); }
const p = spawn(args.join(" "), { env, stdio: "inherit", shell: true });
p.on("exit", code => process.exit(code));
