import axios from "axios";
import {firstValueFrom, Subject} from "rxjs";
import {NetworkType, RepositoryFactoryHttp} from "symbol-sdk";
import moment = require("moment");
import assert from "assert";
import WebSocket from "isomorphic-ws";


interface NodeStatistics {
    peerStatus: {
        isAvailable: boolean;
        lastStatusCheck: number;
    };
    apiStatus: {
        restGatewayUrl: string;
        isAvailable: boolean;
        lastStatusCheck: number;
        nodeStatus: {
            apiNode: string;
            db: string;
        };
        isHttpsEnabled: boolean;
        finalization: {
            height: number;
            epoch: number;
            point: number;
            hash: string;
        };
        restVersion: string;
        webSocket: {
            isAvailable: boolean;
            wss: boolean;
            url: string;
        };
    };
    _id: string;
    version: string;
    publicKey: string;
    networkGenerationHashSeed: string;
    roles: number;
    port: number;
    networkIdentifier: number;
    host: string;
    friendlyName: string;
    __v: number;

    // Filled by NodeTrackerService
    latency?: number;
    latest_error?: string;
}

export interface NodeTrackerServiceOptions {
    cachedNodes?: NodeStatistics[];
}

export class NodeTrackerService {

    private _availableNodes: NodeStatistics[];
    private _pingObserver = new Subject<NodeStatistics>();

    public constructor(
        private statsServiceURL: string,
        private networkType: NetworkType,
        options?: NodeTrackerServiceOptions,
    ) {
        this._availableNodes = options?.cachedNodes || [];
    }

    public get availableNodes() {
        return this._availableNodes;
    }

    public get pingObserver() {
        return this._pingObserver;
    }

    private async ping(node: NodeStatistics) {
        try {
            const repositoryFactory = new RepositoryFactoryHttp(node.apiStatus.restGatewayUrl);
            const networkHttp = repositoryFactory.createNetworkRepository();
            const startAt = moment.now();

            // Try to access REST Gateway and measure latency
            const networkType = await firstValueFrom(networkHttp.getNetworkType());
            let latency: number | undefined;
            if (networkType !== this.networkType) {
                node.latency = undefined;
                node.latest_error = "The network type is mismatched.";
                return;
            } else {
                latency = moment.now() - startAt;
            }

            // Try to open WebSocket connection
            const websocket = new WebSocket(node.apiStatus.webSocket.url);
            await (new Promise<void>(async (resolve, reject) => {
                websocket.addEventListener("message",() => {
                    // We should receive `uid` when connecting websocket gateway first.
                    resolve();
                });
                setTimeout(() => {
                    reject("WebSocket connection timeout.");
                }, 5000);
            })).finally(() => websocket.close());

            node.latency = latency;
            node.latest_error = undefined;
        } catch (e) {
            node.latency = undefined;
            node.latest_error = String(e);
        }

        this._pingObserver.next(node);
    }

    public async discovery() {
        this._availableNodes = await axios.get<NodeStatistics[]>(
            this.statsServiceURL,
            { responseType: "json" }
        ).then((res) => {
            const result = new Array<NodeStatistics>();
            const nodes = res.data;
            for (const node of nodes) {
                // Only https/wss enabled nodes are allowed
                try {
                    if (node.networkIdentifier !== this.networkType ||
                        !node.apiStatus.isAvailable ||
                        node.apiStatus.nodeStatus.apiNode !== 'up' ||
                        node.apiStatus.nodeStatus.db !== 'up' ||
                        !node.apiStatus.isHttpsEnabled ||
                        !node.apiStatus.webSocket.isAvailable ||
                        !node.apiStatus.webSocket.wss
                    ) {
                        // Skip unavailable node
                        continue;
                    }
                    result.push(node);
                } catch (e) {}
            }
            return result;
        });

        return this._availableNodes;
    }

    public async pingAll() {
        const promises = this._availableNodes.map((node) => this.ping(node));
        await Promise.allSettled(promises);

        return this._availableNodes;
    }

    private createNodeTable(maxLatency: number = Number.MAX_SAFE_INTEGER) {
        const safeLatency = (latency?: number) => latency || Number.MAX_SAFE_INTEGER;
        return this._availableNodes
            .filter((node) =>
                !node.latest_error && safeLatency(node.latency) <= maxLatency)
            .sort((n1, n2) => safeLatency(n1.latency) - safeLatency(n2.latency));
    }

    public pickOne(top: number = this._availableNodes.length, maxLatency: number = Number.MAX_SAFE_INTEGER) {
        return this.pickMulti(1, top, maxLatency).shift();
    }

    public pickMulti(
        count: number,
        top: number = this._availableNodes.length,
        maxLatency: number = Number.MAX_SAFE_INTEGER
    ) {
        const nodeTable = this.createNodeTable(maxLatency);
        const result = new Array<NodeStatistics>();

        for (let i = 0 ; i < count && nodeTable.length; i++) {
            const node = nodeTable.splice(
                Math.floor(Math.min(top, nodeTable.length) * Math.random()),
                1
            ).shift();
            assert(node);
            result.push(node);
        }

        return result;
    }

    public async checkHealth(nodeUrl: string) {
        const node = this._availableNodes.find((node) => node.apiStatus.restGatewayUrl === nodeUrl);
        node && await this.ping(node);
        return node?.latency !== undefined && !node.latest_error ? node : undefined;
    }
}