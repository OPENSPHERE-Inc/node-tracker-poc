import axios from "axios";
import {firstValueFrom, Subject} from "rxjs";
import {NetworkType, RepositoryFactoryHttp} from "symbol-sdk";
import assert from "assert";
import WebSocket from "isomorphic-ws";
import moment from "moment";
import { v4 as uuidv4 } from "uuid";


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
    cacheTimestamp?: number;
    noWebSocketChallenge?: boolean;
    webSocketTimeout?: number;
    maxParallels?: number;
}

export class NodeTrackerService {

    private _availableNodes: NodeStatistics[];
    private _discoveredAt?: number;
    private readonly _pingObserver = new Subject<{ node: NodeStatistics, index: number, total: number }>();
    private readonly _noWebSocketChallenge: boolean;
    private readonly _webSocketTimeout: number;
    private readonly _maxParallels: number;
    private _aborting = false;
    private _webSockets = new Map<string, WebSocket>();

    public constructor(
        private _statsServiceURL: string,
        private _networkType: NetworkType,
        options?: NodeTrackerServiceOptions,
    ) {
        this._noWebSocketChallenge = !!options?.noWebSocketChallenge;
        this._webSocketTimeout = options?.webSocketTimeout || 60000;
        this._maxParallels = options?.maxParallels || 10;
        this._availableNodes = this.validateNodes(options?.cachedNodes || []);
        this._discoveredAt = options?.cacheTimestamp;

        assert(this._webSocketTimeout);
        assert(this._maxParallels);
    }

    public get availableNodes() {
        return this._availableNodes;
    }

    public get discoveredAt() {
        return this._discoveredAt;
    }

    public get pingObserver() {
        return this._pingObserver;
    }

    public get isAborting() {
        return this._aborting;
    }

    public get numActiveWebSockets() {
        return this._webSockets.size;
    }

    private async challengeWebSocket(url: string) {
        if (this._aborting) {
            return false;
        }

        const id = uuidv4();
        const websocket = new WebSocket(url);
        this._webSockets.set(id, websocket);

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
                this._webSockets.delete(id);
                resolve(result);
            });

            websocket.addEventListener("error", () => {
                this._webSockets.delete(id);
                resolve(false);
            });
        })).finally(() => {
            clearTimeout(timeout)
        });
    }

    private async ping(node: NodeStatistics) {
        try {
            const repositoryFactory = new RepositoryFactoryHttp(node.apiStatus.restGatewayUrl);
            const networkHttp = repositoryFactory.createNetworkRepository();
            const startAt = moment.now();

            // Try to network properties
            await firstValueFrom(networkHttp.getNetworkProperties());
            const latency = moment.now() - startAt;

            // Try to open WebSocket connection
            if (!this._noWebSocketChallenge && !await this.challengeWebSocket(node.apiStatus.webSocket.url)) {
                node.latency = undefined;
                node.latest_error = "WebSocket connection interrupted.";
            } else {
                node.latency = latency;
                node.latest_error = undefined;
            }
        } catch (e) {
            node.latency = undefined;
            node.latest_error = String(e);
        }

        return node;
    }

    private validateNodes(unsafeNodes: NodeStatistics[]) {
        const safeNodes = new Array<NodeStatistics>();
        for (const node of unsafeNodes) {
            // Only https/wss enabled nodes are allowed
            try {
                if (node.networkIdentifier !== this._networkType ||
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
                safeNodes.push(node);
            } catch (e) {}
        }
        return safeNodes;
    }

    public async discovery(nodeUrls?: string[]) {
        this._availableNodes = await axios.get<NodeStatistics[]>(
            this._statsServiceURL,
            { responseType: "json" }
        ).then((res) =>
            this.validateNodes(res.data)
                .filter((node) => !nodeUrls?.length || nodeUrls.includes(node.apiStatus.restGatewayUrl))
        );

        this._discoveredAt = moment.now();
        return this._availableNodes;
    }

    public async pingAll() {
        this._aborting = false;
        const nodes = [ ...this._availableNodes ];
        const nextNode = () => nodes.splice(0, 1).shift();

        const workers = new Array<Promise<void>>();
        let index = 0;
        for (let i = 0; i < this._maxParallels; i++) {
            workers.push(new Promise(async (resolve) => {
                for (let node = nextNode(); node; node = nextNode()) {
                    if (this._aborting) {
                        return resolve();
                    }
                    await this.ping(node);
                    this._pingObserver.next({ node, index: index++, total: this._availableNodes.length });
                }
                resolve();
            }));
        }
        await Promise.allSettled(workers);

        return this._availableNodes;
    }

    public abortPinging() {
        this._aborting = true;
        // Close all available websockets
        for (const [,socket] of this._webSockets.entries()) {
            socket.close();
        }
    }

    private createNodeTable(maxLatency: number = Number.MAX_SAFE_INTEGER) {
        const safeLatency = (latency?: number) => latency || Number.MAX_SAFE_INTEGER;
        return this._availableNodes
            .filter((node) =>
                node.networkIdentifier === this._networkType &&
                !node.latest_error &&
                safeLatency(node.latency) <= maxLatency)
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
        const nodeTable = this.createNodeTable(maxLatency).slice(0, top);
        const result = new Array<NodeStatistics>();

        for (let i = 0 ; i < count && nodeTable.length; i++) {
            const node = nodeTable.splice(
                Math.floor(nodeTable.length * Math.random()),
                1
            ).shift();
            assert(node);
            result.push(node);
        }

        return result;
    }

    public async checkHealth(nodeUrl: string, maxLatency = Number.MAX_SAFE_INTEGER) {
        this._aborting = false;
        const node = this._availableNodes.find(
            (node) =>
                node.networkIdentifier === this._networkType &&
                node.apiStatus.restGatewayUrl === nodeUrl
        );
        if (node) {
            await this.ping(node);
        }
        return node?.latency !== undefined && !node.latest_error && node.latency <= maxLatency
            ? node
            : undefined;
    }

}