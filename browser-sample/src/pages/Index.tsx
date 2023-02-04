import React, {useState} from "react";
import {NodeTrackerDialog} from "../components/dialogs/NodeTrackerDialog";
import {NodeStatistics} from "node-tracker-poc";
import {TransferForm} from "../components/forms/TransferForm";

const Index = () => {
    const [ nodeSelectorDialogShow, setNodeSelectorDialogShow ] = useState<boolean>(false);
    const [ selectedNode, setSelectedNode ] = useState<NodeStatistics>();

    return <div className="content">
        <h1 className="title is-3">Node Tracker Sample</h1>

        <div className="buttons is-centered">
            <button className="button is-primary" onClick={() => setNodeSelectorDialogShow(true)}>
                Open Node Tracker
            </button>
        </div>
        { nodeSelectorDialogShow
            ? <NodeTrackerDialog
                onSelect={(node) => {
                    if (!node.latest_error) {
                        setSelectedNode(node);
                        setNodeSelectorDialogShow(false);
                    } else {
                        alert(`Couldn't select this node with error\n${node.latest_error}`);
                    }
                }}
                onCancel={() => setNodeSelectorDialogShow(false)}
            />
            : null
        }

        { selectedNode ? <>
            <div className="notification is-success">
                You selected the node: <strong>{ selectedNode.friendlyName || selectedNode.host }</strong>
            </div>

            <TransferForm node={selectedNode} />
        </> : null }
    </div>;
};

export default Index;
