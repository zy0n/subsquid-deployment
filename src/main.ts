import { TypeormDatabase } from '@subsquid/typeorm-store'
import { processor } from './processor'
import { events, functions } from './abi/RailgunSmartWallet'
import { Ciphertext, CommitmentCiphertext, CommitmentPreimage, LegacyCommitmentCiphertext, LegacyEncryptedCommitment, LegacyGeneratedCommitment, Nullifier, ShieldCommitment, Token, TransactCommitment, Transaction, Unshield } from './model';
import { handleCommitmentBatch, handleGeneratedCommitmentBatch, handleNullifier, handleShield, handleTransact, handleUnshield } from './railgun-smart-wallet-events';
import { EvmProcessorLog } from './evm-log';
import { handleLegacyTransactionCall, handleTransactionCall } from './railgun-smart-wallet-call';

const ENABLE_LOG = false;

processor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
    const contractAddress = (process.env.RAILGUN_PROXY_CONTRACT_ADDRESS || '').toLowerCase();
    if (contractAddress.length == 0)
        throw new Error("Invalid contract address");

    let Nullifiers = new Array<Nullifier>();
    let CipherTexts = new Array<Ciphertext>();
    let LegacyCommitmentCiphertexts = new Array<LegacyCommitmentCiphertext>();
    let LegacyEncrpytedCommitments = new Array<LegacyEncryptedCommitment>();
    let TransactCommitments = new Array<TransactCommitment>();
    let CommitmentCiphertexts = new Array<CommitmentCiphertext>();
    let Unshields = new Array<Unshield>();
    let Tokens = new Map<string, Token>();
    let ShieldCommitments = new Array<ShieldCommitment>();
    let CommitmentPreimages = new Array<CommitmentPreimage>();
    let LegacyGeneratedCommitments = new Array<LegacyGeneratedCommitment>();
    let Transactions = new Array<Transaction>();

    for (let c of ctx.blocks) {
        // Handle events
        for (let evt of c.logs) {
            if (evt.address.toLowerCase() !== contractAddress) continue;

            const e = evt as EvmProcessorLog;
            console.log('from', e.transaction.from)
            switch (e.topics[0]) {
                case events.Nullified.topic:
                case events.Nullifiers.topic:
                    Nullifiers.push(...handleNullifier(e));
                    break;
                case events.CommitmentBatch.topic:
                    {
                        const { ciphertexts, lcc, lec } = await handleCommitmentBatch(e, ctx);
                        CipherTexts.push(...ciphertexts);
                        LegacyCommitmentCiphertexts.push(...lcc);
                        LegacyEncrpytedCommitments.push(...lec);
                    }
                    break;
                case events.GeneratedCommitmentBatch.topic:
                    {
                        const { tokens, legacyGeneratedCommitments, commitmentPreImages } = await handleGeneratedCommitmentBatch(e, ctx);
                        tokens.forEach((values, key) => {
                            Tokens.set(key, values);
                        });
                        LegacyGeneratedCommitments.push(...legacyGeneratedCommitments);
                        CommitmentPreimages.push(...commitmentPreImages);
                    } break;
                case events.Transact.topic:
                    {
                        const { ciphertexts, transactCommitments, commitmentCiphertexts } = await handleTransact(e, ctx);
                        CipherTexts.push(...ciphertexts);
                        TransactCommitments.push(...transactCommitments);
                        CommitmentCiphertexts.push(...commitmentCiphertexts);
                    }
                    break;
                case events.Unshield.topic:
                    {
                        const { unshield, token } = handleUnshield(e)
                        Unshields.push(unshield);
                        Tokens.set(token.id, token);
                    } break;
                case events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].topic:
                case events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].topic:
                    {
                        const { tokens, shieldCommitments, commitmentPreimages } = await handleShield(e, ctx);
                        ShieldCommitments.push(...shieldCommitments);
                        CommitmentPreimages.push(...commitmentPreimages);
                        tokens.forEach((values, key) => {
                            Tokens.set(key, values);
                        });
                    } break;
            }
        }

        // Handle call
        for (let tcs of c.traces) {
            if (tcs.type != 'call') return;
            switch (tcs.action.sighash) {
                case functions['transact((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[])'].sighash:
                    {
                        const { tokens, transactions } = await handleTransactionCall(tcs, ctx);
                        tokens.forEach((values, key) => {
                            Tokens.set(key, values);
                        });
                        Transactions.push(...transactions);
                        break;
                    }
                case functions['transact((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),uint256,uint256[],uint256[],(uint16,uint8,address,bytes32,(uint256[4],uint256[2],uint256[])[]),(uint256,(uint8,address,uint256),uint120),address)[])'].sighash:
                    {
                        const { tokens, transactions } = await handleLegacyTransactionCall(tcs, ctx);
                        tokens.forEach((values, key) => {
                            Tokens.set(key, values);
                        });
                        Transactions.push(...transactions);
                        break;
                    }
                default:
                    throw new Error(`Unhandled sighash: ${tcs.action.sighash}`);
            }
        }
    }

    if (ENABLE_LOG) {
        console.log("Inserting data...");
        console.table({
            Nullifier: Nullifiers.length,
            CipherText: CipherTexts.length,
            LegacyCommitmentCiphertext: LegacyCommitmentCiphertexts.length,
            LegacyEncrpytedCommitment: LegacyEncrpytedCommitments.length,
            TransactCommitment: TransactCommitments.length,
            CommitmentCiphertext: CommitmentCiphertexts.length,
            Token: Tokens.size,
            Unshield: Unshields.length,
            CommitmentPreImage: CommitmentPreimages.length,
            ShieldCommitment: ShieldCommitments.length,
            LegacyGeneratedCommitment: LegacyGeneratedCommitments.length
        });
    }

    await Promise.all([
        ctx.store.upsert(Nullifiers),
        ctx.store.upsert(CipherTexts),
        ctx.store.upsert(LegacyCommitmentCiphertexts),
        ctx.store.upsert([...Tokens.values()]),
    ]);


    // LegacyEncrpyedCommitments is dependent on legacyCommitmentCipherTexts
    // Inserting at the same time doesn't work as foreign key is not found
    await Promise.all([
        ctx.store.upsert(LegacyEncrpytedCommitments),
        ctx.store.upsert(CommitmentCiphertexts),
        ctx.store.upsert(Unshields),
        ctx.store.upsert(CommitmentPreimages),
        ctx.store.upsert(Transactions)
    ]);

    await Promise.all([
        ctx.store.upsert(TransactCommitments),
        ctx.store.upsert(ShieldCommitments),
        ctx.store.upsert(LegacyGeneratedCommitments)
    ]);

})
