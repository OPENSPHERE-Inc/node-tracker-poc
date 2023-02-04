import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import { NodeTrackerService, NodeStatistics } from "node-tracker-poc";
import {LoadingBlock} from "../Loading";
import createPersistedState from "use-persisted-state";


type LoadingState = "loading" | "pinging" | "aborting" | "completed";

const statsServiceUrl = process.env.REACT_APP_STATS_SERVICE_URL || "https://testnet.symbol.services/nodes";
const networkType = Number(process.env.REACT_APP_NETWORK_TYPE || "152");

interface NodeTrackerLocalState {
    availableNodes: NodeStatistics[];
}

const useNodeTrackerLocalState = createPersistedState<NodeTrackerLocalState>("node-tracker-local-state");

export interface NodeTrackerDialogProps {
    onSelect?: (node: NodeStatistics) => any,
    onCancel?: () => any,
}

const AvailableNodeList = ({ availableNodes, onSelect, loadingState }: {
    availableNodes: NodeStatistics[],
    onSelect?: (node: NodeStatistics) => any,
    loadingState: LoadingState,
}) => {
    const nodeList = useMemo(
        () => availableNodes.sort((n1, n2) =>
            (n1.latency || Number.MAX_SAFE_INTEGER) - (n2.latency || Number.MAX_SAFE_INTEGER)),
        [availableNodes]
    );

    return <div>
        <table className="table is-hoverable">
            <tbody>
                { nodeList.map((node, index) => <tr key={index}>
                    <td>
                        <a onClick={() => onSelect?.(node)} title={node.apiStatus.restGatewayUrl}>
                            { node.friendlyName || node.host }
                        </a>
                    </td>
                    { !node.latest_error
                        ? node.latency !== undefined
                            ? <td className="nowrap">{ node.latency }ms</td>
                            : loadingState === "completed"
                                ? <td>N/A</td>
                                : <td><LoadingBlock /></td>
                        : <td className="nowrap"><span className="has-text-danger" title={node.latest_error}>Error!</span></td>
                    }
                </tr>) }
            </tbody>
        </table>
    </div>;
};

export const NodeTrackerDialog = (props: NodeTrackerDialogProps) => {
    const [ localState, setLocalState ] = useNodeTrackerLocalState();
    const [ availableNodes, setAvailableNodes ] = useState<NodeStatistics[]>([]);
    const [ loadingState, setLoadingState ] = useState<LoadingState>("loading");
    const nodeTrackerServiceRef = useRef<NodeTrackerService>(
        new NodeTrackerService(
            statsServiceUrl,
            networkType,
            { cachedNodes: localState?.availableNodes, maxParallels: 50, noWebSocketChallenge: false }
        )
    );

    useEffect(() => {
        const subscription = nodeTrackerServiceRef.current.pingObserver.subscribe(() => {
            setAvailableNodes([ ...nodeTrackerServiceRef.current.availableNodes ]);
        });

        if (nodeTrackerServiceRef.current.availableNodes.length) {
            setAvailableNodes( [ ...nodeTrackerServiceRef.current.availableNodes ]);
            setLoadingState("completed");
        } else {
            nodeTrackerServiceRef.current.discovery()
                .then(async (nodes) => {
                    setAvailableNodes( [ ...nodes ]);
                    setLoadingState("pinging");
                    return nodeTrackerServiceRef.current.pingAll();
                })
                .finally(() => {
                    setLoadingState("completed");
                });
        }

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        setLocalState({ availableNodes });
    }, [availableNodes]);

    const reload = useCallback(async () => {
        try {
            setLoadingState("loading");
            await nodeTrackerServiceRef.current.discovery();
            setLoadingState("pinging");
            await nodeTrackerServiceRef.current.pingAll();
        } finally {
            setLoadingState("completed");
        }
    }, []);

    const stop = useCallback( async () => {
        nodeTrackerServiceRef.current.abortPinging();
        setLoadingState("aborting");
    }, []);

    return <div className="component-node-selector-dialog modal is-active">
        <div className="modal-background"></div>
        <div className="modal-card">
            <header className="modal-card-head">
                <p className="modal-card-title mb-0">
                    Please choose one of nodes
                </p>
                <button type="button"
                        className="delete"
                        aria-label="close"
                        onClick={props.onCancel}>
                </button>
            </header>
            <section className="modal-card-body">
                { loadingState !== "loading"
                    ? availableNodes.length
                        ? <AvailableNodeList
                            availableNodes={availableNodes}
                            onSelect={props.onSelect}
                            loadingState={loadingState}
                        />
                        : <div>No nodes found.</div>
                    : <LoadingBlock label="Now loading..." />
                }
            </section>
            <footer className="modal-card-foot">
                { loadingState === "completed"
                    ? <button type="button"
                              className="button is-link"
                              onClick={reload}
                    >
                        Reload
                    </button>
                    : <button type="button"
                              className="button is-warning"
                              onClick={stop}
                              disabled={loadingState === "aborting"}
                    >
                        <span className="icon">
                            <img src="/loading.svg" alt="Loading..." />
                        </span>
                        <span>Stop</span>
                    </button>
                }
                <button type="button"
                        className="button"
                        onClick={props.onCancel}
                >
                    Cancel
                </button>
            </footer>
        </div>
    </div>;
};