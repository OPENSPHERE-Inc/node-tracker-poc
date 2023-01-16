import axios from "axios";
import {firstValueFrom, Subject} from "rxjs";
import {NetworkType, RepositoryFactoryHttp} from "symbol-sdk";
import moment = require("moment");
import assert from "assert";
import WebSocket from "isomorphic-ws";


export interface NodeStatistics {
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
    noWebSocketChallenge?: boolean;
    webSocketTimeout?: number;
    maxParallels?: number;
}

export class NodeTrackerService {

    private _availableNodes: NodeStatistics[];
    private readonly _pingObserver = new Subject<NodeStatistics>();
    private readonly _noWebSocketChallenge: boolean;
    private readonly _webSocketTimeout: number;
    private readonly _maxParallels: number;

    public constructor(
        private statsServiceURL: string,
        private networkType: NetworkType,
        options?: NodeTrackerServiceOptions,
    ) {
        this._availableNodes = options?.cachedNodes || [];
        this._noWebSocketChallenge = !!options?.noWebSocketChallenge;
        this._webSocketTimeout = options?.webSocketTimeout || 60000;
        this._maxParallels = options?.maxParallels || 10;

        assert(this._webSocketTimeout);
        assert(this._maxParallels);
    }

    public get availableNodes() {
        return this._availableNodes;
    }

    public get pingObserver() {
        return this._pingObserver;
    }

    private async challengeWebSocket(url: string) {
        const websocket = new WebSocket(url);

        const timeout = setTimeout(() => {
            websocket.close();
        }, this._webSocketTimeout);

        return (new Promise<boolean>(async (resolve) => {
            let result = false;
            websocket.addEventListener("message",() => {
                // We should receive `uid` when connecting websocket gateway first.
                result = true;
                websocket.close();
            });
            websocket.addEventListener("close", () => {
                resolve(result);
            });
        })).finally(() => clearTimeout(timeout));
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
            if (!this._noWebSocketChallenge && !await this.challengeWebSocket(node.apiStatus.webSocket.url)) {
                node.latency = undefined;
                node.latest_error = "WebSocket connection timeout.";
            } else {
                node.latency = latency;
                node.latest_error = undefined;
            }
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
        const nodes = [ ...this._availableNodes ];
        const nextNode = () => nodes.splice(0, 1).shift();

        const workers = new Array<Promise<void>>();
        for (let i = 0; i < this._maxParallels; i++) {
            workers.push(new Promise(async (resolve) => {
                for (let node = nextNode(); node; node = nextNode()) {
                    await this.ping(node);
                }
                resolve();
            }));
        }
        await Promise.allSettled(workers);

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