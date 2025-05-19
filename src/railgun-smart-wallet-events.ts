// import { Ciphertext, CommitmentBatchEventNew, CommitmentCiphertext, CommitmentPreimage, CommitmentType, LegacyCommitmentCiphertext, LegacyEncryptedCommitment, LegacyGeneratedCommitment, Nullifier, ShieldCommitment, Token, TokenType, TransactCommitment, Unshield } from "./model";


import { EvmProcessorLog } from "./evm-log";
import { events } from "./abi/RailgunSmartWallet";
import { idFrom2PaddedBigInts, idFrom3PaddedBigInts, idFromEventLogIndex } from "./id";
import { bigIntToPad32Bytes, bigIntToPaddedBytes, bigIntToPaddedHexString, hexStringToBytes, padHexStringToEven, padTo32BytesStart} from "./utils";
import { getCiphertextData, getCiphertextIV, getCiphertextTag } from "./ciphertext";
import { createBasicToken, createToken, type BasicToken } from "./token";
import { getNoteHash } from "./hash";
import { DataHandlerContext, type BlockData } from "@subsquid/evm-processor";
import { Store } from "@subsquid/typeorm-store";
import { CommitmentBatch, CommitmentBatchCiphertext, EVMTransaction, Nullifier, GeneratedCommitmentBatch, GeneratedCommitmentBatchCommitment, Shield, ShieldCiphertext, ShieldCommitment, Transact, TransactCiphertext, Unshield, ActionType, Action, type ActionStream, CommitmentBatchEventNew } from "./model";

export function entityIdFromBlockIndex(
  blockNumber: bigint | number,
  txIndex: bigint | number,
  prefix?: string
): string {
  const pad = (x: bigint | number) => BigInt(x).toString(16).padStart(64, '0')
  const id = `${pad(blockNumber)}${pad(txIndex)}`
  const output =  prefix ? `${prefix}:${id}` : id;

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

export async function generateAction (
  e: BlockData,
  ctx: DataHandlerContext<Store>,
  type: ActionType,
  transaction: EVMTransaction,
  injected: any,
){

  const id = entityIdFromBlockIndex(BigInt(e.header.height), 0n, `action:${type}`);
  const action = new Action({
    ...injected,
    id,
    type,
    transaction
  })
  await ctx.store.save(action)
  return action;
}

export async function getAction (
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  type: ActionType,
  transaction: EVMTransaction,
){

  const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.logIndex), `action:${type}`);
  const action = new Action({
    id,
    type,
    transaction,
    eventLogIndex: e.logIndex
  })
  await ctx.store.save(action)
  return action;
}

const transactionCache = new Map<string, EVMTransaction>();
export async function generateTransaction(
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  actionStream: ActionStream
): Promise<EVMTransaction> {
  const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), 'transaction');

  const transaction = transactionCache.get(id);

  if (!transaction) {
    const _transaction = new EVMTransaction({
      id,
      transactionHash: hexStringToBytes(e.transaction.hash),
      actionStream,
    });
    transactionCache.set(id, _transaction)
    return _transaction;
  }
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

export async function handleNullifier(
  e: EvmProcessorLog, 
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
):Promise <{
  nullified: Nullifier
}> {
    const data = extractNullifierData(e);
    const {treeNumber, nullifier} = data;
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Nullifier);
    // TODO: make this a function
    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)

    const output = new Nullifier({
      actionType: ActionType.Nullifier,
      id,
      transaction,
      treeNumber,
      nullifier: nullifier.map(bigIntToPaddedBytes)
    })
    const action = await getAction(
      e,
      ctx,
      ActionType.Nullifier,
      transaction,
   
    );
    action.nullifier = output;
    await ctx.store.save(output)
    await ctx.store.save(action);

    return {
      nullified: output
    }
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
    const [treeNumber, startPosition, hash, ciphertext] = data;

    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)
    const commitmentBatch = new CommitmentBatch({
      actionType: ActionType.CommitmentBatch,
      id,
      treeNumber, 
      startPosition, 
      hash: hash.map(bigIntToPaddedBytes),
      transaction
    })
    await ctx.store.save(commitmentBatch)
    const innerCiphertexts = ciphertext.map(async c=>{
        const [innerCiphertext, ephemeralKeys, innerMemo] = c;
        const commitment = new CommitmentBatchCiphertext({
            id,
            batch: commitmentBatch,
            ciphertext: innerCiphertext.map(bigIntToPaddedBytes),
            ephemeralKeys: ephemeralKeys.map(bigIntToPaddedBytes),
            memo: innerMemo.map(bigIntToPaddedBytes)
        })
        await ctx.store.save(commitment)
        return commitment;
    });


    const ciphertexts = await Promise.all(innerCiphertexts);
    commitmentBatch.ciphertext = ciphertexts;

    const action = await getAction(
      e,
      ctx,
      ActionType.CommitmentBatch,
      transaction,
  
    );
    action.commitmentBatch = commitmentBatch;

    

    // store commitmentBatchEventNew
    const commitmentBatchEventNew = new CommitmentBatchEventNew({
      id: entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), 'commitment-batch-new'),
      // id,
      treeNumber,
      batchStartTreePosition: startPosition,
      // action
    })
    action.batchEventNew = commitmentBatchEventNew

    await ctx.store.save(commitmentBatch)
    await ctx.store.save(action);

    await ctx.store.save(commitmentBatchEventNew)

    return {
        commitmentBatch,
        ciphertext: ciphertexts
    }
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

    const [treeNumber, startPosition, commitments, encryptedRandom] = data;

    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)

    const generatedCommitmentBatch = new GeneratedCommitmentBatch({
      actionType: ActionType.GeneratedCommitmentBatch,
      id,
      treeNumber,
      startPosition,
      encryptedRandom: encryptedRandom.map(e=>e.map(bigIntToPaddedBytes)),
      transaction
    })
    await ctx.store.save(generatedCommitmentBatch)

    const innerCommitments = commitments.map(async c=>{
        const [npk, token, value] = c;
        const { tokenType, tokenAddress, tokenSubID } = token;
        const tokenData = createToken(tokenType, tokenAddress, tokenSubID);
        await ctx.store.save(tokenData);

        const generatedCommitmentBatchCommitment = new GeneratedCommitmentBatchCommitment({
            id,
            batch: generatedCommitmentBatch,
            npk,
            token: tokenData,
            value
        })
        await ctx.store.save(generatedCommitmentBatchCommitment)
        return generatedCommitmentBatchCommitment
    })
    const _commitments = await Promise.all(innerCommitments)
    generatedCommitmentBatch.commitments = _commitments


    const action = await getAction(
      e,
      ctx,
      ActionType.GeneratedCommitmentBatch,
      transaction,
    );


    action.generatedCommitmentBatch = generatedCommitmentBatch;


    // store commitmentBatchEventNew
    const commitmentBatchEventNew = new CommitmentBatchEventNew({
      // id,
      id: entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), 'commitment-batch-new'),
      treeNumber,
      batchStartTreePosition: startPosition,
      // action
    })
    action.batchEventNew = commitmentBatchEventNew

    await ctx.store.save(generatedCommitmentBatch);
    await ctx.store.save(action)

    await ctx.store.save(commitmentBatchEventNew)

    return {
      generatedCommitmentBatch,
      commitment: _commitments
    }
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


    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)

    const transact = new Transact({
      actionType: ActionType.Transact,
      id,
      treeNumber,
      startPosition,
      hash: hash.map(hexStringToBytes),
      transaction
    })
    await ctx.store.save(transact)
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
            memo: BigInt(memo == "0x" ? '0x0' : memo)
        })
        await ctx.store.save(transactionCiphertext)
        return transactionCiphertext;
    });
    const _ciphertext = await  Promise.all(innerCiphertext)
    transact.ciphertext = _ciphertext

    
    const action = await getAction(
      e,
      ctx,
      ActionType.Transact,
      transaction,
     
    );
    action.transact = transact;


    // store commitmentBatchEventNew
    const commitmentBatchEventNew = new CommitmentBatchEventNew({
      // id,
      id: entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), 'commitment-batch-new'),
      treeNumber,
      batchStartTreePosition: startPosition,
      // action
    })
    action.batchEventNew = commitmentBatchEventNew
    await ctx.store.save(transact)
    await ctx.store.save(action)

    await ctx.store.save(commitmentBatchEventNew)


    return {
      transact,
      ciphertext: _ciphertext
    }

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
    await ctx.store.save(token);
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Unshield);

    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)

    const unshield = new Unshield({
      actionType: ActionType.Unshield,
      id,
      npk: BigInt(npk),
      token,
      transaction,
      amount,
      fee
    })

    const action = await getAction(
      e,
      ctx,
      ActionType.Unshield,
      transaction,
    );
    action.unshield = unshield;
    await ctx.store.save(unshield)
    await ctx.store.save(action)

    return {
      unshield
    }
}

export async function handleShield(
  e: EvmProcessorLog,
  ctx: DataHandlerContext<Store>,
  transaction: EVMTransaction
): Promise<{
    shield: Shield
    ciphertext: Array<ShieldCiphertext>
    commitment: Array<ShieldCommitment>
}> {
    let data = null;
    if (e.topics[0] === events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].topic) {
        data = events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].decode(e);
    }
    else if (e.topics[0] === events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].topic) {
        data = events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].decode(e) // ShieldLegacyPreMar23
    }
    else throw new Error("Undefined shield event");

    const [treeNumber, startPosition, commitments, shieldCiphertext, fees] = data;
    const id = entityIdFromBlockIndex(BigInt(e.block.height), BigInt(e.transactionIndex), ActionType.Shield);

    await ctx.store.save(transaction.actionStream)
    await ctx.store.save(transaction)

    const shield = new Shield({
      actionType: ActionType.Shield,
      id,
      treeNumber,
      startPosition,
      transaction
    })

    await ctx.store.save(shield);
    const innerCommitments = commitments.map(async c=>{
        const [npk, innerToken, value] = c;
        const [tokenType, tokenAddress, tokenSubID] = innerToken;
        const token = createToken(tokenType, tokenAddress, tokenSubID);
        await ctx.store.save(token);

        const commitment = new ShieldCommitment({
            id,
            shield,
            npk: BigInt(npk), // TODO: Bytes?
            token,
            value
        })
        await ctx.store.save(commitment)
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
        await ctx.store.save(ciphertext)
        return ciphertext;
    })

    if(typeof fees !== 'undefined'){
      // fix this to be auto array
      if(Array.isArray(fees)){
        const feeArr = fees as bigint[]
        shield.fees = feeArr.map(e=>bigIntToPaddedBytes(e))
      } else {
        shield.fees = [bigIntToPaddedBytes(fees)]
      }
    } else {
      shield.fees = []
    }

    const _commitments = await Promise.all(innerCommitments);
    const _ciphertexts = await Promise.all(innerShieldCiphertexts);
    shield.commitments = _commitments
    shield.shieldCiphertext = _ciphertexts

    const action = await getAction(
      e,
      ctx,
      ActionType.Shield,
      transaction,
    );
    action.shield = shield;
    await ctx.store.save(shield);
    await ctx.store.save(action);

    return {
      shield,
      ciphertext: _ciphertexts,
      commitment: _commitments
    }
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