import "./env";
import {Logger} from "@opensphere-inc/symbol-service";
import assert from "assert";
import {NodeTrackerService} from "../services";
import prompts from "prompts";
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

    const nodes = nodeTracker.pickMulti(10, 10, 1000)
        .sort(
            (n1, n2) =>
                (n1.latency || Number.MAX_SAFE_INTEGER) - (n2.latency || Number.MAX_SAFE_INTEGER)
        );

    const inputData = await prompts([
        {
            type: "select",
            name: "node",
            message: "Please choose node",
            stdout: process.stderr,
            initial: 1,
            choices: nodes.map((node) => ({
                title: `${node.apiStatus.restGatewayUrl} [${node.latency} msecs]`,
                value: node,
            }))
        }
    ]);

    if (!inputData.node) {
        throw new Error("Canceled by user.");
    }

    await doTransfer(inputData.node.apiStatus.restGatewayUrl, networkType);
};

main()
    .catch((e) => {
        Logger.error(e);
        process.exit(1);
    });
