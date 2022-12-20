const Kafka = require('node-rdkafka');
const host = require('./util/host');

class Producer
{

    constructor(logger, config) {

        this.logger = logger;

        this.producer =  new Kafka.HighLevelProducer({
            'client.id' : 'websocket-' + host(),
            'metadata.broker.list': config.get('kafka_host'),
            'batch.num.messages': '1',
            'queue.buffering.max.ms':'25',
            'socket.blocking.max.ms':'25',
            'socket.nagle.disable':'true',
            'request.required.acks':'1',
        });

    }


    connect() {
        return new Promise((resolve, reject) => {

            this.producer.connect({}, () => {
                reject({message: 'Kafka service is not available, try again...'});
            });

            this.producer.on('event.error', (err) => {
                reject("Producer Error: " + err);
            });

            // when the connection is ready to produce, resolve
            this.producer.on('ready', () => {
                resolve();
            });

        });
    }

    publish(message) {

        //console.log(message);
        const errorHandler = (err, offset) => {
            if (err) {
                // TODO - Retry?
                this.logger.error(err);
            }
        };

        this.producer.produce('as_parallel_bg_queue_low_priority', // The topic
            null,   // The partition - Let it auto select
            Buffer.from(message),  // The message to send
            null,  // No keys
            Date.now(),
            errorHandler
        );

    }
}

module.exports = Producer;
