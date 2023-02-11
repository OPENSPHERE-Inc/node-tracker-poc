import "./env";
import {NodeTrackerService} from "../services";
import assert from "assert";

let nodeTracker: NodeTrackerService;

assert(process.env.STATS_SERVICE_URL);
assert(process.env.NETWORK_TYPE);
nodeTracker = new NodeTrackerService(
    process.env.STATS_SERVICE_URL,
    Number(process.env.NETWORK_TYPE),
    {maxParallels: 5}
);

const main = async () => {
    await nodeTracker.discovery();

    // Repeat 5 times
    for (let i = 0; i < 20; i++) {
        console.debug(`No.${i}`);
        const subscription = await nodeTracker.pingObserver.subscribe(({node, index, total}) => {
            if (node.latency) {
                console.debug(`${index + 1} of ${total}: ${node.apiStatus.restGatewayUrl} [${node.latency} msecs]`);
            } else {
                console.debug(`${index + 1} of ${total}: ${node.apiStatus.restGatewayUrl} [${node.latest_error}]`);
            }
        });
        await new Promise((resolve) => {
            nodeTracker.pingAll().then(resolve);
            setTimeout(() => {
                try {
                    nodeTracker.abortPinging()
                } catch (e) {
                    console.error(e);
                }
            }, 2000);
        }).finally(() => subscription.unsubscribe());
    }
};

main()
    .catch((e) => {
        console.error(`error: ${e}`);
        process.exit(1);
    });