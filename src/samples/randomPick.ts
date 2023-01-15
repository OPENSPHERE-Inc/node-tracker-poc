import "./env";
import {Logger} from "@opensphere-inc/symbol-service";
import assert from "assert";
import {NodeTrackerService} from "../services";
import {doTransfer} from "./common";


Logger.init({ log_level: Logger.LogLevel.DEBUG });

const main = async () => {
    assert(process.env.STATS_SERVICE_URL);
    assert(process.env.NETWORK_TYPE);
    const networkType = Number(process.env.NETWORK_TYPE);
    const nodeTracker = new NodeTrackerService(process.env.STATS_SERVICE_URL, networkType);
    Logger.info("Discovering nodes.");
    await nodeTracker.discovery();
    Logger.info(`Pinging ${nodeTracker.availableNodes.length} nodes.`);
    await nodeTracker.pingAll();

    const node = nodeTracker.pickOne(10, 1000);
    if (!node) {
        throw new Error("Couldn't picked any nodes.");
    }
    Logger.info(`Picked node: ${node?.apiStatus.restGatewayUrl} [Latency:${node?.latency} msecs]`);

    await doTransfer(node.apiStatus.restGatewayUrl, networkType);
};

main()
    .catch((e) => {
        Logger.error(e);
        process.exit(1);
    });
