const logger = require('./util/logger');
const config = require('config');
const Producer = require('./Producer');
const Consumer = require('./Consumer');
const SocketServer = require('./SocketServer');
const Zookeeper = require('./Zookeeper');
const host = require('./util/host');

(async () => {

    // kafka consumer, socket server and kafka producer are initialized synchronously for safety

    // first we need to be able to produce to kafka (nothing works without this)
    logger.info('Initializing the producer...');
    const producer = new Producer(logger, config);

    logger.info('Waiting for kafka service...');
    // try until kafka is up...
    while (true) {

        try {
            await producer.connect();
        } catch (e) {

            // keep trying until kafka is available
            logger.error(e.message);
            continue;
        }

        logger.info('Kafka producer is ready!');
        break;
    }

    // Initialize the websocket
    logger.info('Initializing the websocket server...');

    const consumerTopic = `as_rtm_websockets_${host()}`.replace('.','_');

    const socketServer = new SocketServer(logger, config, producer, consumerTopic);

    // wait until the socket server is up
    await socketServer.init();

    // Initialize the consumer
    logger.info('Initializing the consumer...');
    const consumer = new Consumer(logger, config, socketServer);

    logger.info('Waiting for kafka service...');
    // try until kafka is up... (it's important to ensure it now)
    while (true) {
        try {
            await consumer.connect(consumerTopic);
        } catch (e) {
            // keep trying until kafka is available
            logger.error(e.message);
            continue;
        }

        logger.info('Kafka consumer is ready!');
        break;
    }


    // Notify zookeeper that we're alive!
    logger.info(`Connecting to Zookeeper...`);
    const zookeeper = new Zookeeper(logger, config, consumerTopic);

    logger.info('Waiting for Zookeeper service...');
    // try until Zookeeper is up... (it's important to ensure it now)
    while (true) {
        try {
            await zookeeper.connect();
        } catch (e) {
            // keep trying until zookeeper is available
            logger.error(e.message);
            continue;
        }

        logger.info('Connected to zookeeper.');
        break;
    }


})();
