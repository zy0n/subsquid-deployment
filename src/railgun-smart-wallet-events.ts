// import { Ciphertext, CommitmentBatchEventNew, CommitmentCiphertext, CommitmentPreimage, CommitmentType, LegacyCommitmentCiphertext, LegacyEncryptedCommitment, LegacyGeneratedCommitment, Nullifier, ShieldCommitment, Token, TokenType, TransactCommitment, Unshield } from "./model";


import { EvmProcessorLog } from "./evm-log";
import { events } from "./abi/RailgunSmartWallet";
import { idFrom2PaddedBigInts, idFrom3PaddedBigInts, idFromEventLogIndex } from "./id";
import { bigIntToPad32Bytes, bigIntToPaddedBytes, bigIntToPaddedHexString, hexStringToBytes, padHexStringToEven, padTo32BytesStart} from "./utils";
import { getCiphertextData, getCiphertextIV, getCiphertextTag } from "./ciphertext";
import { createBasicToken, createToken, type BasicToken } from "./token";
import { getNoteHash } from "./hash";
import { DataHandlerContext } from "@subsquid/evm-processor";
import { Store } from "@subsquid/typeorm-store";
import { CommitmentBatch, CommitmentBatchCiphertext, EVMTransaction, Nullifier, GeneratedCommitmentBatch, GeneratedCommitmentBatchCommitment, Shield, ShieldCiphertext, ShieldCommitment, Transact, TransactCiphertext, Unshield, ActionType } from "./model";

export function entityIdFromBlockIndex(
  blockNumber: bigint | number,
  txIndex: bigint | number,
  prefix?: string
): string {
  const pad = (x: bigint | number) => BigInt(x).toString(16).padStart(64, '0')
  const id = `${pad(blockNumber)}${pad(txIndex)}`
  const output =  prefix ? `${prefix}:${id}` : id;
  // console.log('OUTPUT', output)

  return output
}

function extractNullifierData(evmLog: any): { treeNumber: bigint, nullifier: bigint[] } {
    if (evmLog.topics[0] === events.Nullified.topic) {
        const { treeNumber, nullifier } = events.Nullified.decode(evmLog);
        return {
            treeNumber: BigInt(treeNumber),
            nullifier: nullifier.map(n => BigInt(n))
        };
    }
    else if (evmLog.topics[0] === events.Nullifiers.topic) {
        return events.Nullifiers.decode(evmLog);
    }
    throw new Error("Unsupported topic");
}

export function generateTransaction (
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
) {
  const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), 'transaction');
  const transaction = new EVMTransaction({
      id,
      transactionHash: hexStringToBytes(e.transaction.hash),
      blockNumber: BigInt(e.block.height),
      blockHash: hexStringToBytes(e.block.hash),
      blockTimestamp: BigInt(e.block.timestamp),
      commitmentBatches: [],
      generatedCommitmentBatches: [],
      shields: [],
      transacts: [],
      nullifiers: [],
      unshields: []
    })
    ctx.store.upsert(transaction)
    return transaction;
}

// /*
//  *  ciphertexts: BigInt represented as hex string starting with 0x
// */
// function parseCiphertext(id: string, ciphertexts: string[]): Ciphertext {
//     const iv = getCiphertextIV(ciphertexts);
//     const tag = getCiphertextTag(ciphertexts);
//     const data = getCiphertextData(ciphertexts);
//     const cipherText = new Ciphertext({
//         id,
//         iv,
//         tag,
//         data
//     });
//     return cipherText;
// }

export function handleNullifier(
  e: EvmProcessorLog, 
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): {
  nullified: Nullifier
} {
    const data = extractNullifierData(e);
    const {treeNumber, nullifier} = data;
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Nullifier);
    // const transaction = new EVMTransaction({
    //   // id,
    //   transactionHash: hexStringToBytes(e.transaction.hash),
    // })
    // const transaction = generateTransaction(e);
    const output = new Nullifier({
      actionType: ActionType.Nullifier,
      id,
      transaction,
      treeNumber,
      nullifier: nullifier.map(bigIntToPaddedBytes)
    })
    ctx.store.upsert(output)
    output.transaction.nullifiers.push(output);
    // console.log('Nullifier', output)

    return {
      nullified: output
    }
    // let nullified = new Array<Nullifier>();
    // for (let i = 0; i < nullifiers.length; i++) {
    //     // Convert nullifier from bigInt to hex
    //     const id = idFrom2PaddedBigInts(treeNumber, nullifiers[i]);

    //     // Making compatible with subgraph
    //     const nullifier = (e.topics[0] === events.Nullified.topic) ? padTo32BytesStart(bigIntToPaddedHexString(nullifiers[i])) : bigIntToPaddedHexString(nullifiers[i]);
    //     nullified.push(new Nullifier({
    //         id,
    //         blockNumber: BigInt(e.block.height),
    //         blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //         transactionHash: hexStringToBytes(e.transaction.hash),
    //         treeNumber,
    //         nullifier: hexStringToBytes(nullifier)
    //     }));
    // }

    // return nullified;
}

export async function handleCommitmentBatch(
  e: EvmProcessorLog, 
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise<{
    commitmentBatch: CommitmentBatch
    ciphertext: Array<CommitmentBatchCiphertext>
}> {

    const data = events.CommitmentBatch.decode(e);
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.CommitmentBatch);

    // const transaction = new EVMTransaction({
    //   // id,
    //   transactionHash: hexStringToBytes(e.transaction.hash),
    // })
    // const transaction = generateTransaction(e);

    
    // console.log(data);
    const [treeNumber, startPosition, hash, ciphertext] = data;

    const output = {
      actionType: ActionType.CommitmentBatch,
      id,
      blockNumber: BigInt(e.block.height),
      treeNumber, 
      startPosition, 
      hash: hash.map(bigIntToPaddedBytes),
      transaction
    }

    const commitmentBatch = new CommitmentBatch(output)
    await ctx.store.upsert(commitmentBatch)
    const innerCiphertexts = ciphertext.map(async c=>{
        const [innerCiphertext, ephemeralKeys, innerMemo] = c;
        // console.log(innerCiphertext)
        // const [iv, tag, data, data2] = innerCiphertext;
        const commitment = new CommitmentBatchCiphertext({
            id,
            batch: commitmentBatch,
            ciphertext: innerCiphertext.map(bigIntToPaddedBytes),
            ephemeralKeys: ephemeralKeys.map(bigIntToPaddedBytes),
            memo: innerMemo.map(bigIntToPaddedBytes)
        })
        await ctx.store.upsert(commitment)
        return commitment;
    });


    const ciphertexts = await Promise.all(innerCiphertexts);
    commitmentBatch.ciphertext = ciphertexts;
    commitmentBatch.transaction.commitmentBatches.push(commitmentBatch)
    await ctx.store.upsert(commitmentBatch)
    return {
        commitmentBatch,
        ciphertext: ciphertexts
    }
    // return output;

    // console.log('data', data as CommitmentBatch)

    // const ciphertexts = new Array<Ciphertext>();
    // const legacyCommitmentCiphertexts = new Array<LegacyCommitmentCiphertext>();
    // const legacyEncrpytedCommitments = new Array<LegacyEncryptedCommitment>();

    // const ciphertextStructs = data.ciphertext;
    // for (let i = 0; i < ciphertextStructs.length; ++i) {
    //     const ciphertextStruct = ciphertextStructs[i];
    //     const treePosition = data.startPosition + BigInt(i);
    //     const id = idFrom2PaddedBigInts(data.treeNumber, treePosition);
    //     const ciphertext = parseCiphertext(id, ciphertextStruct.ciphertext.map(ct => bigIntToPaddedHexString(ct)));
    //     ciphertexts.push(ciphertext);

    //     const legacyCommitmentCiphertext = new LegacyCommitmentCiphertext(
    //         {
    //             id,
    //             ciphertext,
    //             ephemeralKeys: ciphertextStruct.ephemeralKeys.map(key => bigIntToPaddedBytes(key)),
    //             memo: ciphertextStruct.memo.map(memo => bigIntToPaddedBytes(memo)),
    //         }
    //     );
    //     legacyCommitmentCiphertexts.push(legacyCommitmentCiphertext);

    //     legacyEncrpytedCommitments.push(new LegacyEncryptedCommitment({
    //         id,
    //         blockNumber: BigInt(e.block.height),
    //         blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //         transactionHash: hexStringToBytes(e.transaction.hash),
    //         treeNumber: Number(data.treeNumber),
    //         batchStartTreePosition: Number(data.startPosition),
    //         treePosition: Number(treePosition),
    //         commitmentType: CommitmentType.LegacyEncryptedCommitment,
    //         hash: data.hash[i],
    //         ciphertext: legacyCommitmentCiphertext
    //     }));
    // }

    // const id = idFrom2PaddedBigInts(BigInt(e.block.height), BigInt(e.transactionIndex));
    // await ctx.store.upsert(new CommitmentBatchEventNew({ id, treeNumber: data.treeNumber, batchStartTreePosition: data.startPosition }));

    // return {
    //     ciphertexts,
    //     lcc: legacyCommitmentCiphertexts,
    //     lec: legacyEncrpytedCommitments,
    // };
}

export async function handleGeneratedCommitmentBatch(
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise<{
  generatedCommitmentBatch: GeneratedCommitmentBatch
  commitment: Array<GeneratedCommitmentBatchCommitment>
}> {
    const data = events.GeneratedCommitmentBatch.decode(e);
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.GeneratedCommitmentBatch);

    // const transaction = new EVMTransaction({
    //   transactionHash: hexStringToBytes(e.transaction.hash),
    // })
    // const transaction = generateTransaction(e);

    const [treeNumber, startPosition, commitments, encryptedRandom] = data;
    const generatedCommitmentBatch = new GeneratedCommitmentBatch({
      actionType: ActionType.GeneratedCommitmentBatch,
      id,
      treeNumber,
      startPosition,
      encryptedRandom: encryptedRandom.map(e=>e.map(bigIntToPaddedBytes)),
      transaction
    })
    await ctx.store.upsert(generatedCommitmentBatch)

    const innerCommitments = commitments.map(async c=>{
        const [npk, token, value] = c;
        const { tokenType, tokenAddress, tokenSubID } = token;
        const tokenData = createToken(tokenType, tokenAddress, tokenSubID);
        await ctx.store.upsert(tokenData);

        const generatedCommitmentBatchCommitment = new GeneratedCommitmentBatchCommitment({
            id,
            batch: generatedCommitmentBatch,
            npk,
            token: tokenData,
            value
        })
        await ctx.store.upsert(generatedCommitmentBatchCommitment)
        return generatedCommitmentBatchCommitment
    })
    const _commitments = await Promise.all(innerCommitments)
    generatedCommitmentBatch.commitments = _commitments
    generatedCommitmentBatch.transaction.generatedCommitmentBatches.push(generatedCommitmentBatch)
    console.log(generatedCommitmentBatch)

    await ctx.store.upsert(generatedCommitmentBatch);

    return {
      generatedCommitmentBatch,
      commitment: _commitments
    }
    // const output = {
    //     treeNumber,
    //     startPosition,
    //     encryptedRandom,
    //     commitments: innerCommitments,
    // }

    // console.log('generatedCommitment', output)
    // const commitments = data.commitments;

    // const tokens = new Map<string, Token>();
    // const legacyGeneratedCommitments = new Array<LegacyGeneratedCommitment>();
    // const commitmentPreImages = new Array<CommitmentPreimage>();

    // for (let i = 0; i < commitments.length; i++) {
    //     const commitment = commitments[i];

    //     const treePosition = data.startPosition + BigInt(i);
    //     const id = idFrom2PaddedBigInts(data.treeNumber, treePosition);

    //     const { tokenType, tokenAddress, tokenSubID } = commitment.token;
    //     const token = createToken(tokenType, tokenAddress, tokenSubID);
    //     tokens.set(token.id, token);

    //     const preimage = new CommitmentPreimage({
    //         id,
    //         npk: hexStringToBytes(bigIntToPaddedHexString(commitment.npk)),
    //         token,
    //         value: commitment.value
    //     });

    //     commitmentPreImages.push(preimage);

    //     const commitmentHash = await getNoteHash(
    //         ctx,
    //         commitment.npk,
    //         BigInt(token.id),
    //         commitment.value,
    //     );

    //     const legacyGeneratedCommitment = new LegacyGeneratedCommitment({
    //         id,
    //         blockNumber: BigInt(e.block.height),
    //         blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //         transactionHash: hexStringToBytes(e.transaction.hash),
    //         treeNumber: Number(data.treeNumber),
    //         batchStartTreePosition: Number(data.startPosition),
    //         treePosition: Number(treePosition),
    //         commitmentType: CommitmentType.LegacyGeneratedCommitment,
    //         hash: commitmentHash as bigint,
    //         preimage,
    //         encryptedRandom: data.encryptedRandom[i].map(random => bigIntToPaddedBytes(random)),
    //     });
    //     legacyGeneratedCommitments.push(legacyGeneratedCommitment);
    // }

    // const id = idFrom2PaddedBigInts(BigInt(e.block.height), BigInt(e.transactionIndex));
    // await ctx.store.upsert(new CommitmentBatchEventNew({ id, treeNumber: data.treeNumber, batchStartTreePosition: data.startPosition }));

    // return { tokens, legacyGeneratedCommitments, commitmentPreImages };
}

export async function handleTransact(
  e: EvmProcessorLog, 
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise<{
    transact: Transact,
    ciphertext: Array<TransactCiphertext>
}> {
    const data = events.Transact.decode(e);

    const [treeNumber, startPosition, hash, ciphertext] = data;
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Transact);

    // const transaction = new EVMTransaction({
    //   transactionHash: hexStringToBytes(e.transaction.hash),
    // })

    const transact = new Transact({
      actionType: ActionType.Transact,
      id,
      treeNumber,
      startPosition,
      hash: hash.map(hexStringToBytes),
      transaction
    })
    await ctx.store.upsert(transact)
    const innerCiphertext = ciphertext.map(async c=>{
        const [
            ciphertext,
            blindedSenderViewingKey,
            blindedReceiverViewingKey,
            annotationData,
            memo,
        ] = c;

        const transactionCiphertext = new TransactCiphertext({
            id,
            transact,
            ciphertext: ciphertext.map(hexStringToBytes),
            blindedSenderViewingKey: BigInt(blindedSenderViewingKey), // TODO: Check if we should use bytes here...
            blindedReceiverViewingKey: BigInt(blindedReceiverViewingKey),
            annotationData: BigInt(annotationData),
            memo: BigInt(memo)
        })
        await ctx.store.upsert(transactionCiphertext)
        return transactionCiphertext;
    });
    const _ciphertext = await  Promise.all(innerCiphertext)
    transact.ciphertext = _ciphertext
    transact.transaction.transacts.push(transact)

    // const output = {
    //     treeNumber,
    //     startPosition,
    //     hash,
    //     ciphertext: innerCiphertext
    // }

    return {
      transact,
      ciphertext: _ciphertext
    }

    // console.log("Transact", output)

    // const ciphertextStructs = data.ciphertext;

    // const ciphertexts = new Array<Ciphertext>();
    // const transactCommitments = new Array<TransactCommitment>();
    // const commitmentCiphertexts = new Array<CommitmentCiphertext>();

    // for (let i = 0; i < ciphertextStructs.length; i++) {
    //     const ciphertextStruct = ciphertextStructs[i];

    //     const treePosition = data.startPosition + BigInt(i);
    //     const id = idFrom2PaddedBigInts(data.treeNumber, treePosition);
    //     const ciphertext = parseCiphertext(id, ciphertextStruct.ciphertext.map((ct) => padHexStringToEven(ct)));
    //     ciphertexts.push(ciphertext);

    //     const commitmentCiphertext = new CommitmentCiphertext({
    //         id,
    //         ciphertext,
    //         blindedSenderViewingKey: hexStringToBytes(ciphertextStruct.blindedSenderViewingKey),
    //         blindedReceiverViewingKey: hexStringToBytes(ciphertextStruct.blindedReceiverViewingKey),
    //         annotationData: hexStringToBytes(ciphertextStruct.annotationData),
    //         memo: hexStringToBytes(ciphertextStruct.memo),
    //     });
    //     commitmentCiphertexts.push(commitmentCiphertext);

    //     transactCommitments.push(new TransactCommitment({
    //         id,
    //         blockNumber: BigInt(e.block.height),
    //         blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //         transactionHash: hexStringToBytes(e.transaction.hash),
    //         treeNumber: Number(data.treeNumber),
    //         batchStartTreePosition: Number(data.startPosition),
    //         treePosition: Number(treePosition),
    //         commitmentType: CommitmentType.TransactCommitment,
    //         hash: BigInt(data.hash[i]),
    //         ciphertext: commitmentCiphertext
    //     }));
    // }

    // const id = idFrom2PaddedBigInts(BigInt(e.block.height), BigInt(e.transactionIndex));
    // await ctx.store.upsert(new CommitmentBatchEventNew({ id, treeNumber: data.treeNumber, batchStartTreePosition: data.startPosition }));

    // return {
    //     ciphertexts,
    //     transactCommitments,
    //     commitmentCiphertexts
    // };
}

export async function handleUnshield(
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise< {
    unshield: Unshield
}> {
    const data = events.Unshield.decode(e);

    const [npk, innerToken, amount, fee] = data;
    const { tokenType, tokenAddress, tokenSubID } = innerToken;
    const token = createToken(tokenType, tokenAddress, tokenSubID);
    await ctx.store.upsert(token);
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Unshield);

    // const transaction = generateTransaction(e);

    const unshield = new Unshield({
      actionType: ActionType.Unshield,
      id,
      npk: BigInt(npk),
      token,
      transaction,
      amount,
      fee
    })
    unshield.transaction.unshields.push(unshield)
    await ctx.store.upsert(unshield)
    // const output = {
    //     npk, 
    //     token,
    //     amount,
    //     fee
    // }


    return {
      unshield
    }
    // console.log("UNSHIELD:", output)
    // const id = idFromEventLogIndex(e);

    // const token = createToken(tokenType, tokenAddress, tokenSubID);
    // // const { tokenType, tokenAddress, tokenSubID } = data.token;

    // const unshield = new Unshield({
    //     id,
    //     blockNumber: BigInt(e.block.height),
    //     blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //     transactionHash: hexStringToBytes(e.transaction.hash),
    //     to: hexStringToBytes(data.to),
    //     token,
    //     amount: data.amount,
    //     fee: data.fee,
    //     eventLogIndex: BigInt(e.logIndex)
    // })

    // return { token, unshield };
}

export async function handleShield(
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise<{
    // tokens: Map<string, Token>,
    // commitmentPreimages: Array<CommitmentPreimage>
    // shieldCommitments: Array<ShieldCommitment>

    shield: Shield
    ciphertext: Array<ShieldCiphertext>
    commitment: Array<ShieldCommitment>
}> {
    let data = null;
    if (e.topics[0] === events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].topic) {
        data = events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].decode(e);
        console.log("USING LATEST SHIELD EVENT")
    }
    else if (e.topics[0] === events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].topic) {
        data = events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].decode(e) // ShieldLegacyPreMar23
    }
    else throw new Error("Undefined shield event");

    // const transaction = generateTransaction(e)
    const [treeNumber, startPosition, commitments, shieldCiphertext, fees] = data;
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Shield);

    const shield = new Shield({
      actionType: ActionType.Shield,
      id,
      treeNumber,
      startPosition,
      transaction
    })

    await ctx.store.upsert(shield);
    const innerCommitments = commitments.map(async c=>{
        const [npk, innerToken, value] = c;
        const [tokenType, tokenAddress, tokenSubID] = innerToken;
        const token = createToken(tokenType, tokenAddress, tokenSubID);
        await ctx.store.upsert(token);

        const commitment = new ShieldCommitment({
            id,
            shield,
            npk: BigInt(npk), // TODO: Bytes?
            token,
            value
        })
        await ctx.store.upsert(commitment)
        return commitment;
    });

    const innerShieldCiphertexts = shieldCiphertext.map(async s=>{
        const [encryptedBundle, shieldKey] = s;
        const ciphertext = new ShieldCiphertext({
            id,
            shield,
            encryptedBundle: encryptedBundle.map(hexStringToBytes),
            shieldKey: BigInt(shieldKey)
        })
        await ctx.store.upsert(ciphertext)
        return ciphertext;
    })



    // const output: {
    //     treeNumber: bigint;
    //     startPosition: bigint;
    //     commitments: {
    //         npk: string,
    //         token: BasicToken,
    //         value: bigint
    //     }[];
    //     shieldCiphertext: {encryptedBundle: string[], shieldKey: string}[];
    //     fees?: bigint | bigint[]
    // } = {
    //     treeNumber,
    //     startPosition,
    //     commitments: innerCommitments,
    //     shieldCiphertext: innerShieldCiphertexts,
    // }

    if(typeof fees !== 'undefined'){
      // fix this to be auto array
      if(Array.isArray(fees)){
        const feeArr = fees as bigint[]
        shield.fees = feeArr.map(e=>bigIntToPaddedBytes(e))
      } else {
        shield.fees = [bigIntToPaddedBytes(fees)]
      }
        // output.fees = fees as any
        // console.log("SHIELD", output)
    } else {
      shield.fees = []
    }

    const _commitments = await Promise.all(innerCommitments);
    const _ciphertexts = await Promise.all(innerShieldCiphertexts);
    shield.commitments = _commitments
    shield.shieldCiphertext = _ciphertexts
    shield.transaction.shields.push(shield)


    return {
      shield,
      ciphertext: _ciphertexts,
      commitment: _commitments
    }

    // let tokens = new Map<string, Token>();
    // let commitmentPreimages = new Array<CommitmentPreimage>();
    // let shieldCommitments = new Array<ShieldCommitment>();

    // for (let i = 0; i < commitments.length; i++) {
    //     const commitment = commitments[i];

    //     const treePosition = data.startPosition + BigInt(i)
    //     const id = idFrom2PaddedBigInts(data.treeNumber, treePosition);

    //     const { tokenType, tokenAddress, tokenSubID } = commitment.token;
    //     const token = createToken(tokenType, tokenAddress, tokenSubID);
    //     tokens.set(token.id, token);

    //     const preimage = new CommitmentPreimage({
    //         id,
    //         npk: hexStringToBytes(commitment.npk),
    //         token,
    //         value: commitment.value
    //     });
    //     commitmentPreimages.push(preimage);

    //     const commitmentHash = await getNoteHash(
    //         ctx,
    //         BigInt(commitment.npk),
    //         BigInt(token.id),
    //         commitment.value,
    //     );

    //     // fee is not present in new LegacyShield
    //     const fee = (data as any).fees ? (data as any).fees[i] : null;
    //     const encryptedBundle = data.shieldCiphertext[i].encryptedBundle.map(bundle => bigIntToPad32Bytes(BigInt(bundle)));
    //     const shieldCommitment = new ShieldCommitment({
    //         id,
    //         blockNumber: BigInt(e.block.height),
    //         blockTimestamp: BigInt(e.block.timestamp) / 1000n,
    //         transactionHash: hexStringToBytes(e.transaction.hash),
    //         treeNumber: Number(data.treeNumber),
    //         batchStartTreePosition: Number(data.startPosition),
    //         treePosition: Number(treePosition),
    //         commitmentType: CommitmentType.ShieldCommitment,
    //         hash: commitmentHash as bigint,
    //         preimage,
    //         encryptedBundle,
    //         shieldKey: hexStringToBytes(data.shieldCiphertext[i].shieldKey),
    //         fee
    //     });
    //     shieldCommitments.push(shieldCommitment);
    // }

    // return {
    //     tokens,
    //     commitmentPreimages,
    //     shieldCommitments
    // };
}

/*
// Engine V3 (Nov 2022)
export async function handleShieldLegacyPreMar23(e: EvmProcessorLog, ctx: any): Promise<{
    tokens: Map<string, Token>,
    commitmentPreimages: Array<CommitmentPreimage>
    shieldCommitments: Array<ShieldCommitment>
}> {
    const data = events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].decode(e);
    const commitments = data.commitments;

    let tokens = new Map<string, Token>();
    let commitmentPreimages = new Array<CommitmentPreimage>();
    let shieldCommitments = new Array<ShieldCommitment>();

    for (let i = 0; i < commitments.length; i++) {
        const commitment = commitments[i];
        const treePosition = data.startPosition + BigInt(i)
        const id = idFrom2PaddedBigInts(data.treeNumber, treePosition);

        const { tokenType, tokenAddress, tokenSubID } = commitment.token;
        const token = createToken(tokenType, tokenAddress, tokenSubID);
        tokens.set(token.id, token);

        const preimage = new CommitmentPreimage({
            id,
            npk: hexStringToBytes(commitment.npk),
            token,
            value: commitment.value
        });
        commitmentPreimages.push(preimage);

        const commitmentHash = await getNoteHash(
            ctx,
            BigInt(commitment.npk),
            BigInt(token.id),
            commitment.value,
        );

        const encryptedBundle = data.shieldCiphertext[i].encryptedBundle.map(bundle => bigIntToPaddedBytes(BigInt(bundle)));
        const shieldCommitment = new ShieldCommitment({
            id,
            blockNumber: BigInt(e.block.height),
            blockTimestamp: BigInt(e.block.timestamp),
            transactionHash: hexStringToBytes(e.transaction.hash),
            treeNumber: Number(data.treeNumber),
            batchStartTreePosition: Number(data.startPosition),
            treePosition: Number(treePosition),
            commitmentType: CommitmentType.ShieldCommitment,
            hash: commitmentHash as bigint,
            preimage,
            encryptedBundle,
            shieldKey: hexStringToBytes(data.shieldCiphertext[i].shieldKey),
            fee: null
        });
        shieldCommitments.push(shieldCommitment);
    }
    return { tokens, commitmentPreimages, shieldCommitments };
}
*/