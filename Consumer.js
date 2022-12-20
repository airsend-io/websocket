const Kafka = require('node-rdkafka');
const host = require('./util/host');

class Consumer
{
    constructor(logger, config, socketServer) {

        this.logger = logger;

        this.socketServer = socketServer;

        this.consumer = new Kafka.KafkaConsumer({
            'group.id': 'websocketgroup',
            'metadata.broker.list': config.get('kafka_host'),
            'client.id': `websocket-${host()}`,
        }, {});




    }

    connect(kafkaTopic) {
        return new Promise((resolve, reject) => {

            this.consumer.connect({}, () => {
                reject({message: 'Kafka service is not available, try again...'});
            });

            this.consumer.on('event.error', (err) => {
                reject("Consumer Error: " + err);
            });

            // when the connection is ready to consume, resolve it
            this.consumer.on('ready', () => {
                this.consumer.subscribe([kafkaTopic]);

                // Consume from the topic.
                // No callback required. Will cause data event to be raised
                this.consumer.consume();
                resolve();
            });

            // set the data handler
            this.consumer.on('data', (message) => {
                // Output the actual message contents
                const data = message.value.toString();
                //logger.info(data);

                try {
                    let dataObj = JSON.parse(data);
                    let key = dataObj.token.user_id + "_" + dataObj.token.finger_print;
                    // Send to clients
                    this.socketServer.sendToClient(key, JSON.stringify(dataObj.rtm_payload));
                } catch (e) {
                    this.logger.error(e);
                }
            });

        });
    }

}

module.exports = Consumer;