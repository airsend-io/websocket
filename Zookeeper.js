const zookeeper = require('node-zookeeper-client');
const host = require('./util/host');

class Zookeeper
{
    constructor(logger, config, consumerTopic) {

        this.logger = logger;

        this.config = config;

        this.consumerTopic = consumerTopic;

        this.zooHost = config.get('zoo_host');

        this.dataDelimiter = '#';

        // the parent node for all websocket nodes on zookeeper
        this.parentNodePath = config.get('zoo_rtm_nodes');

        // the service is not connected on construction
        this.connected = false;
    }

    connect() {
        return new Promise((resolve, reject) => {

            this.logger.info(`Trying zookeeper host: '${this.zooHost}'`);
            const zooClient = zookeeper.createClient(this.zooHost);

            zooClient.connect();

            // set the event handlers
            zooClient.on('connected', () => {
                this.connected = true;

                zooClient.exists(this.parentNodePath, (error, stat) => {
                    if (stat) {

                        // parent node exists, just include this node
                        this.logger.info(this.parentNodePath  + " node found!")
                        this.writeThisNodeToZookeeper(zooClient);

                    } else {

                        this.logger.info(this.parentNodePath + " node not found. Creating...")

                        // Parent node still doesn't exists, needs to be created
                        zooClient.create(this.parentNodePath, (error) => {
                            if (error) {
                                this.logger.error(`CRITICAL: Failed to create parent node: ${error}`);
                            }

                            this.writeThisNodeToZookeeper(zooClient);
                        });

                    }
                });

                resolve();
            });

            zooClient.on('disconnected', async () => {
                this.logger.info('ZOOKEEPER DISCONNCTED - Attempting RECONNECT');
                this.connected = false;
                await this.connect();
            });

            zooClient.on('expired', async () => {
                this.logger.info('ZOOKEEPER EXPIRED - Attempting RECONNECT');
                this.close();
                this.connected = false;
                await this.connect();
            });


            // if after 5 seconds we're not connected, reject
            setTimeout(() => {
                if (!this.connected) {
                    zooClient.close();
                    reject({message: 'Zookeeper service is not available, try again...'});
                }
            }, 5000)

        });

    }

    writeThisNodeToZookeeper(client)
    {
        const data = [
            this.config.get('websocket_protocol'),
            host(),
            this.config.get('websocket_port'),
            this.consumerTopic,
        ];
        const path = `${this.parentNodePath}/${data.join(this.dataDelimiter)}`;

        this.logger.info(`Writing node '${path}' to Zookeeper.`);

        client.exists(path, (error, stat) => {
            if (stat) {
                // Node is there, delete it first and recreate it
                client.remove(path, -1, (error) => {
                    // Create a ephemeral node to allow node to be removed on this client crash
                    client.create(path, '', zookeeper.CreateMode.EPHEMERAL, (error) => {
                        if (error) {
                            this.logger.error(error);
                        } else {
                            this.logger.info(`Ephemeral Node: '${path}' created`);
                        }
                        // Dont close this. If we close the node will be deleted
                    });
                });
            } else {
                // Create a ephemeral node to allow node to be removed on this client crash
                client.create(path, '', zookeeper.CreateMode.EPHEMERAL, (error) => {
                    if (error) {
                        this.logger.info(error);
                    } else {
                        this.logger.info(`Ephemeral Node: '${path}' created`);
                    }
                    // Dont close this. If we close the node will be deleted
                });
            }

        });


    }
}

module.exports = Zookeeper;