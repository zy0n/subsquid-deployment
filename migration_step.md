# ENV Setup

1. RPC_ENDPOINT : \
Find Out RPC Endpoint  (best way to find out from https://chainlist.org/)
	
1. CHAIN_ID: \
 Find ChainId of the network

1. RAILGUN_PROXY_CONTRACT_ADDRESS :\
Copy Contract address from (https://github.com/Railgun-Community/deployments/blob/master/src/chains/bsc.ts)


4. RAILGUN_PROXY_DEPLOYMENT_BLOCK:\
Copy the deploymentBlock from 
https://github.com/Railgun-Community/deployments/blob/master/src/chains/bsc.ts)

5. RAILGUN_POSEIDON4_CONTRACT_ADDRESS:\
   * open the NETWORK_blockchain explorer in the browser and search the address.
   * Go to the last page of the  transaction to see when was the transaction initiated.
   * Click on the contract & click on 'read as proxy', then you will see the contract address and click on that contract address.
   * Again click on the contract then you will see the PoseidonT4 , press that one
   * Click on the contract again, you will see multiple contract from that, you need to select one contract by matching the transaction initiated age.

    FOR THE COMPARISON \
	Url will be available from: \
     https://github.com/Railgun-Community/wallet/blob/main/src/services/railgun/quick-sync/V2/graphql/.graphclientrc.yaml
