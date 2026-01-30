import { runDispatchWorker } from "../app/services/dispatch/run-worker.server";

runDispatchWorker()
  .then((r) => {
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
