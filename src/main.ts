import { TypeormDatabase, type Store } from '@subsquid/typeorm-store'
import { processor } from './processor'
import { events, functions } from './abi/RailgunSmartWallet'
// import { Ciphertext, CommitmentCiphertext, CommitmentPreimage, LegacyCommitmentCiphertext, LegacyEncryptedCommitment, LegacyGeneratedCommitment, Nullifier, ShieldCommitment, Token, TransactCommitment, Transaction, Unshield } from './model';
import { entityIdFromBlockIndex, generateAction, generateTransaction, handleCommitmentBatch, handleGeneratedCommitmentBatch, handleNullifier, handleShield, handleTransact, handleUnshield } from './railgun-smart-wallet-events';
import { EvmProcessorLog } from './evm-log';
// import { handleLegacyTransactionCall, handleTransactionCall } from './railgun-smart-wallet-call';
import { Action, ActionStream, CommitmentBatch, CommitmentBatchCiphertext, EVMTransaction, GeneratedCommitmentBatch, GeneratedCommitmentBatchCommitment, Nullifier, ShieldCiphertext, ShieldCommitment, TransactCiphertext, type Shield, type Transact, type Unshield } from './model';
import { hexStringToBytes } from './utils';

const ENABLE_LOG = false;

processor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
  const contractAddress = (process.env.RAILGUN_PROXY_CONTRACT_ADDRESS || '').toLowerCase();
  if (contractAddress.length == 0)
    throw new Error("Invalid contract address");

  // let Nullifiers = new Array<Nullifier>();
  // let CommitmentBatches = new Array<CommitmentBatch>();
  // let CommitmentBatchCiphertexts = new Array<CommitmentBatchCiphertext>();
  // let GeneratedCommitmentBatches = new Array<GeneratedCommitmentBatch>();
  // let GeneratedCommitmentBatchCommitments = new Array<GeneratedCommitmentBatchCommitment>();
  // let Transacts = new Array<Transact>()
  // let TransactCiphertexts = new Array<TransactCiphertext>();
  // let Unshields = new Array<Unshield>();
  // let Shields = new Array<Shield>();
  // let ShieldCiphertexts = new Array<ShieldCiphertext>();
  // let ShieldCommitments = new Array<ShieldCommitment>();

  // let Transactions = new Array<EVMTransaction>();


  // let LegacyCommitmentCiphertexts = new Array<LegacyCommitmentCiphertext>();
  // let LegacyEncrpytedCommitments = new Array<LegacyEncryptedCommitment>();
  // let TransactCommitments = new Array<TransactCommitment>();
  // let CommitmentCiphertexts = new Array<CommitmentCiphertext>();
  // let Unshields = new Array<Unshield>();
  // let Tokens = new Map<string, Token>();
  // let ShieldCommitments = new Array<ShieldCommitment>();
  // let CommitmentPreimages = new Array<CommitmentPreimage>();
  // let LegacyGeneratedCommitments = new Array<LegacyGeneratedCommitment>();
  // let Transactions = new Array<Transaction>();


  for (let c of ctx.blocks) {
    // Handle events
    const actionStream = new ActionStream({
      id: entityIdFromBlockIndex(BigInt(c.header.height), 0n, 'actionStream' ),
      blockNumber: BigInt(c.header.height),
      blockHash: hexStringToBytes(c.header.hash),
      transactions: []
    })
    // await ctx.store.save(actionStream);
    for (let evt of c.logs) {
      if (evt.address.toLowerCase() !== contractAddress) continue;
      
      const e = evt as EvmProcessorLog;
      const transaction = await generateTransaction(e, ctx, actionStream);


      switch (e.topics[0]) {
        case events.Nullified.topic:
        case events.Nullifiers.topic:
          const extractedNullifier = await handleNullifier(e, ctx, transaction)
          // Nullifiers.push(extractedNullifier.nullified)
          break;
        case events.CommitmentBatch.topic: 
          {
            const { commitmentBatch, ciphertext } = await handleCommitmentBatch(e, ctx, transaction);
            // CommitmentBatches.push(commitmentBatch)
            // CommitmentBatchCiphertexts.push(...ciphertext)
          }
          break;
        case events.GeneratedCommitmentBatch.topic:
          {
            const { generatedCommitmentBatch, commitment } = await handleGeneratedCommitmentBatch(e, ctx, transaction);
          
            // GeneratedCommitmentBatches.push(generatedCommitmentBatch);
            // GeneratedCommitmentBatchCommitments.push(...commitment);
          } break;
        case events.Transact.topic:
          {
            const { transact, ciphertext } = await handleTransact(e, ctx, transaction);
            // Transacts.push(transact);
            // TransactCiphertexts.push(...ciphertext)
          }
          break;
        case events.Unshield.topic:
          {
            const { unshield } = await handleUnshield(e, ctx, transaction)
            // Unshields.push(unshield);
          } break;
        case events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[])'].topic:
        case events['Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])'].topic:
          {
            const { shield, commitment, ciphertext } = await handleShield(e, ctx, transaction);
            // Shields.push(shield)
            // ShieldCommitments.push(...commitment);
            // ShieldCiphertexts.push(...ciphertext)
          } break;
      }
      // if(transaction.actions.length > 0){
        // console.log()
        // console.log('length', transaction.actions.length)
        // Transactions.push(transaction)
        // actionStream.transactions.push(transaction)
        // await ctx.store.save(actionStream)
      // } 
    }

    // Handle call
    // for (let tcs of c.traces) {
    //     if (tcs.type != 'call') return;
    //     switch (tcs.action.sighash) {
    //         case functions['transact((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[])'].sighash:
    //             {
    //                 const { tokens, transactions } = await handleTransactionCall(tcs, ctx);
    //                 tokens.forEach((values, key) => {
    //                     Tokens.set(key, values);
    //                 });
    //                 Transactions.push(...transactions);
    //                 break;
    //             }
    //         case functions['transact((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),uint256,uint256[],uint256[],(uint16,uint8,address,bytes32,(uint256[4],uint256[2],uint256[])[]),(uint256,(uint8,address,uint256),uint120),address)[])'].sighash:
    //             {
    //                 const { tokens, transactions } = await handleLegacyTransactionCall(tcs, ctx);
    //                 tokens.forEach((values, key) => {
    //                     Tokens.set(key, values);
    //                 });
    //                 Transactions.push(...transactions);
    //                 break;
    //             }
    //         default:
    //             throw new Error(`Unhandled sighash: ${tcs.action.sighash}`);
    //     }
    // }
  // }

  // if (ENABLE_LOG) {
  //   console.log("Inserting data...");
  //   console.table({
  //     Nullifier: Nullifiers.length,
  //     CommitmentBatch: CommitmentBatches.length,
  //     CommitmentBatchCiphertext: CommitmentBatchCiphertexts.length,
  //     GeneratedCommitmentBatch: GeneratedCommitmentBatches.length,
  //     GeneratedCommitmentBatchCommitment: GeneratedCommitmentBatchCommitments.length,
  //     Transact: Transacts.length,
  //     TransactCiphertext: TransactCiphertexts.length,
  //     Unshield: Unshields.length,
  //     Shield: Shields.length,
  //     ShieldCiphertext: ShieldCiphertexts.length,
  //     ShieldCommitment: ShieldCommitments.length,
  //     Transaction: Transactions.length
  //   });
  }

// base records that other tables depend on
  // Step 1: Ciphertexts and other non-dependent base entries
  // await Promise.all([
  //   ctx.store.upsert(Nullifiers),
  //   ctx.store.upsert(TransactCiphertexts),
  //   ctx.store.upsert(ShieldCiphertexts),
  //   ctx.store.upsert(CommitmentBatchCiphertexts),
  // ]);

  // // Step 2: Primary batches that are required by commitments
  // await Promise.all([
  //   ctx.store.upsert(GeneratedCommitmentBatches), // ✅ must come before GCBCommitments
  //   ctx.store.upsert(CommitmentBatches),
  // ]);

  // // Step 3: Commitment records that rely on batches
  // await Promise.all([
  //   ctx.store.upsert(GeneratedCommitmentBatchCommitments),
  //   ctx.store.upsert(ShieldCommitments), // Assumes ShieldCiphertexts already inserted
  // ]);

  // // Step 4: Operations
  // await Promise.all([
  //   ctx.store.upsert(Shields),
  //   ctx.store.upsert(Unshields),
  //   ctx.store.upsert(Transactions),
  //   ctx.store.upsert(Transacts),
  // ]);

})
