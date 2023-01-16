import {useCallback, useState} from "react";
import {useForm} from "react-hook-form";
import {NodeStatistics} from "node-tracker-poc";
import {Account, Address, Mosaic} from "symbol-sdk";
import {SymbolService} from "@opensphere-inc/symbol-service";


interface FormData {
    sender_private_key: string;
    recipient_address: string;
    amount: number;
    message: string;
}

export const TransferForm = ({ node }: { node: NodeStatistics }) => {
    const [ error, setError ] = useState<string>();
    const [ txHash, setTxHash] = useState<string>();
    const { handleSubmit, register, formState: { errors, isValid, isSubmitting } } = useForm<FormData>({
        mode: "onBlur",
        defaultValues: {
            amount: 1,
            message: "NodeTracker for Symbol Browser (React) Sample"
        },
    });

    const doTransfer = useCallback(async (data: FormData) => {
        const symbolService = new SymbolService({
            node_url: node.apiStatus.restGatewayUrl,
            repo_factory_config: {
                websocketInjected: WebSocket,
                websocketUrl: node.apiStatus.webSocket.url,
            }
        });
        const { networkType, networkCurrencyMosaicId, networkGenerationHash } = await symbolService.getNetwork();

        const senderAccount = Account.createFromPrivateKey(data.sender_private_key, networkType);
        const recipientAddress = Address.createFromRawAddress(data.recipient_address);

        // Create a transfer transaction
        const transferTx1 = await symbolService.createTransferTx(
            senderAccount.publicAccount,
            recipientAddress,
            new Mosaic(networkCurrencyMosaicId, SymbolService.toMicroXYM(data.amount)),
            data.message || "",
        );

        // Compose aggregate and sign
        const aggregateTx = await symbolService.composeAggregateCompleteTx(
            await symbolService.getFeeMultiplier(0.23),
            0,
            [ transferTx1 ]
        );
        const signedTx = senderAccount.sign(aggregateTx, networkGenerationHash);

        // Announce and wait
        await symbolService.announceTxWithCosignatures(signedTx, []);
        const result = (await symbolService.waitTxsFor(senderAccount, signedTx.hash, "confirmed")).shift();

        if (result?.error) {
            setError("Transaction error.");
        } else {
            setTxHash(signedTx.hash);
        }
    }, [node]);

    return <form onSubmit={handleSubmit(doTransfer)}>
        <h3 className="title is-5">Transfer Form</h3>

        <div className="field">
            <label className="label">Sender Private Key (*)</label>
            <div className="control">
                <input className={`input ${errors.sender_private_key ? "is-danger" : ""}`}
                       type="password"
                       autoComplete="off"
                       disabled={isSubmitting}
                       { ...register("sender_private_key", { required: "Required field." }) }
                />
            </div>
        </div>
        { errors.sender_private_key && <div className="field">
            <p className="help is-danger">
                { errors.sender_private_key.message }
            </p>
        </div> }

        <div className="field">
            <label className="label">Recipient Address (*)</label>
            <div className="control">
                <input className={`input ${errors.recipient_address ? "is-danger" : ""}`}
                       type="text"
                       disabled={isSubmitting}
                       { ...register("recipient_address", { required: "Required field." }) }
                />
            </div>
        </div>
        { errors.recipient_address && <div className="field">
            <p className="help is-danger">
                { errors.recipient_address.message }
            </p>
        </div> }

        <div className="field">
            <label className="label">Amount (* XYM)</label>
            <div className="control">
                <input className={`input ${errors.amount ? "is-danger" : ""}`}
                       type="number"
                       step="0.000001"
                       max="50000"
                       min="0.000001"
                       disabled={isSubmitting}
                       { ...register("amount", { required: "Required field." }) }
                />
            </div>
        </div>
        { errors.amount && <div className="field">
            <p className="help is-danger">
                { errors.amount.message }
            </p>
        </div> }

        <div className="field">
            <label className="label">Message</label>
            <div className="control">
                <input className={`input ${errors.message ? "is-danger" : ""}`}
                       type="text"
                       maxLength={1000}
                       disabled={isSubmitting}
                       { ...register("message") }
                />
            </div>
        </div>
        { errors.message && <div className="field">
            <p className="help is-danger">
                { errors.message.message }
            </p>
        </div> }

        <div className="buttons is-centered">
            <button className={`button is-primary ${isSubmitting ? "is-loading" : ""}`}
                    disabled={!isValid || isSubmitting}
            >
                Execute
            </button>
        </div>

        { error ? <div className="notification is-danger is-light">
            { error }
        </div> : null }

        { txHash ? <div className="notification is-success is-light">
            Transaction succeeded: { txHash }
        </div> : null }
    </form>;
};