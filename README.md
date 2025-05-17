# Migration using Scripts

1. Run docker

   > **_NOTE:_** This is needed if we want to generate the migration file that is located under the folder "db". Any changes in the schema(graphql file) is only reflected after generating migration files.  
   > If the "db" folder is missing or the empty then we have to generate it.
   > schema.graphql content change
   > You need to run an instance of docker to generate db file.

2. Build the squid
   ```bash
      ./build
   ```
3. Compile the chain to generate .yaml file in "build" directory
   ```bash
   # chainId can be any valid supported chainId or '*' to compile all chain
   yarn compile-chain chainId=[chainId]
   ```
4. Deploy the squid. The deploy script looks in the build folder and deploy all the yaml file
   ```bash
   ./deploy-chain
   ```

# How to Migrate Manually

### Steps to run locally

1. Generate the DB entities from the schema
   ```bash
    sqd codegen
    sqd build
   ```
2. Start local database instance and generate migrations using entities (Note: start an instance of docker)
   ```bash
    sqd up
    sqd migration:generate
   ```
3. Generate typing from the ABI
   ```bash
    sqd typegen
   ```
4. Start processing the data / Run processor
   ```bash
    sqd process
   ```
   > **_NOTE:_** This bailout in local when the block reaches the final block or exceed it while processing in batch
5. Serve the indexed data

   ```bash
    sqd serve
   ```

   Inspect the auto-generated GraphQL API using an interactive playground at  
   <a target="_blank"> http://localhost:4350/graphql </a>

### Steps to deploy on subsquid cloud

> **_NOTE:_** Before deploying in the cloud, please make sure the secrets defined in the subsquid.yaml are set in the subsquid cloud. Secrets are global to all the squid. Some value specific to squid maybe need to be set in squid.yaml

1. Generate key from subsquid cloud by going to the profile  
   <a target="_blank"> https://app.subsquid.io/profile/auth-key </a>
2. Add key in the project to authenticate
   ```bash
    sqd auth -k <key>
   ```
3. Generate squid.yaml file to deploy
   ```bash
    npm run compile-chain chainId=[chainId]
   ```
   > ** _NOTE_** Different config for chainId can be found on chain-squid-config.ts file which is replaced to squid template yaml file
4. Deploy the squid
   ```bash
   sqd deploy -m [YAML_FILE_NAME] --hard-reset -o [organization_name]
   E.g. sqd deploy -m squid-arbitrum.yaml -o rail-squid
   ```
   > **_NOTE:_** --hard-reset flag is used to start the indexing from the starting block. If that is not the case, we can remove it. But do note that any changes to the schema needs to be build and deployed from the starting block
