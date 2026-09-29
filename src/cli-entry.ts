import {main} from "./cli";
export {main};
if (require.main === module) process.exitCode = main(process.argv.slice(2));
