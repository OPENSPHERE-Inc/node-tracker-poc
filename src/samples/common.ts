import prompts from "prompts";
import {Account, Address, Mosaic, NetworkType} from "symbol-sdk";
import {Logger, SymbolService} from "@opensphere-inc/symbol-service";


export const doTransfer = async (nodeUrl: string, networkType: NetworkType) => {
    const inputData = await prompts([
        {
            type: "password",
            name: "senderPrivateKey",
            message: "Sender's Private Key?",
            stdout: process.stderr,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "text",
            name: "recipientAddress",
            message: "Recipient Address?",
            stdout: process.stderr,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "number",
            name: "amount",
            message: "Amount (XYM)?",
            stdout: process.stderr,
            float: true,
            round: 6,
            min: 0.000001,
            max: 50000,
            increment: 0.000001,
            initial: 1,
        }, {
            type: "text",
            name: "message",
            message: "Message [Enter:skip]?",
            stdout: process.stderr,
            initial: "NodeTracker for Symbol Random Pick Sample",
        }
    ]);

    if (!inputData.senderPrivateKey || !inputData.recipientAddress || !inputData.amount || !inputData.message) {
        throw new Error("Canceled by user.");
    }

    const senderAccount = Account.createFromPrivateKey(inputData.senderPrivateKey, networkType);
    const recipientAddress = Address.createFromRawAddress(inputData.recipientAddress);
    const symbolService = new SymbolService({ node_url: nodeUrl });
    const { networkCurrencyMosaicId, networkGenerationHash } = await symbolService.getNetwork();

    // Create a transfer transaction
    const transferTx1 = await symbolService.createTransferTx(
        senderAccount.publicAccount,
        recipientAddress,
        new Mosaic(networkCurrencyMosaicId, SymbolService.toMicroXYM(inputData.amount)),
        inputData.message || "",
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
        throw new Error("Transaction failed.");
    } else {
        Logger.info("The transaction has been succeeded.");
    }
};