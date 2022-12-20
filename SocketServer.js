const websocket = require('ws');
const express = require('express');
const host = require('./util/host');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const {cpu, drive:disk, mem, os} = require('node-os-utils');


class SocketServer
{
    constructor(logger, config, producer, consumerTopic) {

        // set the class logger, so the methods can use it
        this.logger = logger;

        // set the class config, so the methods can use it
        this.config = config;

        // set the producer, so the methods can use it
        this.producer = producer;

        // set the maps
        this.clientMap = new Map();
        this.socketMap = new Map();
        this.clientTimeMap = new Map();
        this.keyMap = new Map();
        this.iosSet = new Set();
        this.androidSet = new Set();

        // stats
        this.sentMessages = 0;
        this.receivedMessages = 0;
        this.sentMessageTotal = 0;
        this.receivedMessagesTotal = 0;
        this.errorOps = 0;

        // consumer topic
        this.consumerTopic = consumerTopic;

        // set supported commands
        this.supportedCommands =  [
            'ws_ephemeral_typing',
            'ws_read_notification',
            'ws_add_reaction',
            'ws_remove_reaction',
            'ws_all_read_notification',
            'ws_ping'
        ];

        // server configs
        // DO NOT CHANGE THIS WITHOUT UPDATING BACKGROUND DISPATCHER IN PHP.
        this.serverId = 'websocket_server';
        // DO NOT CHANGE THIS WITHOUT UPDATING BACKGROUND DISPATCHER IN PHP
        this.messagePrefix = 'JSONRTMOBJ#';

        // set the websocket server configs
        let serverOptions = {};
        if (config.get('server_mode') === 'https') {
            serverOptions = {
                key: fs.readFileSync('./ssl/STAR_airsend_io.key'),
                cert: fs.readFileSync('./ssl/STAR_airsend_io.pem')
            }
        }

        const app = express();
        if (app.get('env') === 'dev') {
            if (config.get('http_route')) {
                this.logger.info("HTTP Route is ENABLED");
                app.use(express.static(__dirname + '/client'));
            } else {
                this.logger.info("HTTP Route is DISABLED");
            }
        }

        const httpServer = require(config.get('server_mode'));
        const server = httpServer.createServer(serverOptions, app);
        this.wss = new websocket.Server({ server });
        this.server = server;
    }

    init() {

        return new Promise((resolve, reject) => {

            // Dump the headers when this even comes
            // this.wss.on('headers',(headers,req)=>{
            //     //logger.info(headers);
            // });

            // Wait on a connection event
            this.wss.on('connection', (ws) => {

                ws.isAlive = true;

                // We have  a connection and wait for a message event
                ws.on('message', (data) => {
                    this.processRequest(data, ws);
                });

                // Send a initial welcome message
                ws.on('open', () => {
                    ws.send('Welcome to AirSend!');
                });

                ws.on('close', () => {
                    //logger.info("Client closed");
                    this.purgeMapUsingSocket(ws);
                });

                ws.on('pong', () => {
                    ws.isAlive = true;
                });

                ws.on('ping', () => {
                    ws.pong();
                });

                ws.on('error', () => {
                    //logger.info("Client errored");
                    this.purgeMapUsingSocket(ws);
                });

            });

            // Listen on port
            this.server.listen(this.config.get('websocket_port'), () => {
                this.logger.info(`Websocket server listening on port ${this.server.address().port}`);
                resolve();
            });

            // init the timers
            this.initHeartbeatTimer(25000); // TODO - push those time configs to env...
            this.initStatsTimer(30000);

        });
    }

    initHeartbeatTimer(interval) {
        setInterval( () => {

            this.purgeExpiredSockets();

            this.wss.clients.forEach( (ws) => {

                if (ws.isAlive === false) {
                    return this.purgeMapUsingSocket(ws);
                }

                // Set client as not alive . If we dont get a pong within
                // next 25s, then this client will be terminated
                ws.isAlive = false;

                // This should create a pong back which will
                // indicate if client is alive or not
                ws.ping(()=>{});
            });
        }, interval);
    }

    initStatsTimer(interval) {

        const intervalSec = Math.floor(interval/1000);

        setInterval(async () => {
            let sendRate = 0;
            if (this.sentMessages > 0) {
                sendRate = Math.ceil(this.sentMessages/intervalSec);
                this.sentMessageTotal += this.sentMessages;
                this.sentMessages = 0;
            }

            let receiveRate = 0;
            if (this.receivedMessages > 0) {
                receiveRate = Math.ceil(this.receivedMessages/intervalSec);
                this.receivedMessagesTotal += this.receivedMessages;
                this.receivedMessages = 0;
            }

            this.logger.info("Total Connections = "+ this.clientMap.size + " iOS = " + this.iosSet.size  + " Android = " + this.androidSet.size +  " Send Rate = " + sendRate + " Receive Rate = " + receiveRate);

            let cpuUsage = await cpu.usage();
            let cpuFree = await cpu.free();
            let diskInfo = await disk.info();
            let memInfo = await mem.info();
            let osInfo = await os.oos();

            let jsonMsg = {
                command: 'ws_stats',
                source: this.serverId,
                host: host(),
                active_connections: this.clientMap.size,
                sent_total: this.sentMessageTotal,
                received_total: this.receivedMessagesTotal,
                send_rate: sendRate,
                receive_rate: receiveRate,
                errors: this.errorOps,
                cpu_usage_percent: cpuUsage,
                cpu_free_percent: cpuFree,
                disk_total_gb: diskInfo.totalGb,
                disk_free_gb: diskInfo.freeGb,
                mem_total_mb: memInfo.totalMemMb,
                mem_free_mb: memInfo.freeMemMb,
                os_info: osInfo,
                os_uptime: os.uptime(),
                os_platform: os.platform(),
                os_ip: os.ip(),
                os_hostname: host(),
                kafka_consumer_topic: this.consumerTopic,
                android_clients: this.androidSet.size,
                ios_clients: this.iosSet.size
            };

            let msg = this.messagePrefix + JSON.stringify(jsonMsg);

            this.producer.publish( msg );


        }, interval);
    }

    purgeExpiredSockets() {

        this.clientTimeMap.forEach( (ws, key) => {

            let now = new Date();
            let expiration = new Date(key);

            if (now > expiration) {
                let okey = this.socketMap.get(ws);
                if (okey !== undefined) {
                    let details = this.keyMap.get(okey);
                    this.logger.info("Client " + details.user_name + "(" + details.client_ip + ") token expired [" + expiration + "]");
                    this.purgeMapUsingSocket(ws);
                    this.clientTimeMap.delete(key);
                }
            }

        });
    }

    purgeMapUsingSocket(ws, terminate=true) {

        if (this.socketMap.get(ws) != null) {
            let okey = this.socketMap.get(ws);
            let details = this.keyMap.get(okey);
            if (details != undefined) {
                this.logger.info("Disconnecting " + details.user_name + "(" + details.client_ip + ") Agent = " + details.user_agent);
            }
            this.socketMap.delete(ws);

            if (this.clientMap.get(okey) != null) {
                this.clientMap.delete(okey);
                this.keyMap.delete(okey);
                if (this.androidSet.has(okey)) {
                    this.androidSet.delete(okey);
                }
                if (this.iosSet.has(okey)) {
                    this.iosSet.delete(okey);
                }
            }

            let msg = {
                command: 'ws_purge_connection'
            }
            this.publishOnMQ(okey, msg);

        }

        if (terminate) {
            ws.terminate();
        }
    }

    processRequest(data, ws) {
        try {
            this.receivedMessages++;

            let jsonMsg = JSON.parse(data);
            if (jsonMsg.command === 'ws_auth') {
                // This means we got auth request
                return this.authenticateClient(ws, jsonMsg);
            } else if (jsonMsg.command === 'ws_ping') {
                ws.send(JSON.stringify({'event': 'pong'}));
                return;
            } else {
                // Validate this request first that we know about this client
                if (this.isKnownClientConnection(ws)) {
                    // Process the commands
                    if (this.supportedCommands.includes(jsonMsg.command)) {
                        return this.publishOnMQ(this.socketMap.get(ws), jsonMsg);
                    }
                    // Fall through to terminate the connection
                }
            }

            // No other message is really allowed from client at this point.
            this.logger.info("Unknown message received. Terminating client");
        }
        catch(e) {
            this.logger.info('Invalid JSON received: Terminating the connection ' + data);
            this.errorOps++;
        }

        // If we are here, the socket should be terminated
        this.purgeMapUsingSocket(ws);
    }

    isKnownClientConnection(ws) {
        return (this.socketMap.get(ws) !== null)
    }

    authenticateClient(socket, jsonMsg) {
        try {

            // If this socket exists before, then this is a refresh call. Remove old entry
            // Connection should NOT be killed. This is only to remove the old fingerprint information
            this.purgeMapUsingSocket(socket, false);
            // This  is used in rtm opt to generate the token
            let decoded = jwt.verify(jsonMsg.auth_token, 'fe95e913-ff6e-4b50-a700-6383b7c95d85');
            //log(decoded);
            this.logger.info("Airsend User: " + decoded.user_name + "(" + decoded.user_id + ") from  [" + decoded.client_ip + "] Using [" + decoded.user_agent  +"] Expiring [" + decoded.expiry + "]");
            let key = decoded.user_id + "_" + decoded.finger_print;
            this.clientMap.set(key, socket);
            this.socketMap.set(socket, key);
            this.clientTimeMap.set(decoded.expiry, socket);

            this.keyMap.set(key, decoded);

            if (decoded.user_agent.includes('iOS')) {
                this.iosSet.add(key);
            }

            if (decoded.user_agent.includes('Android')) {
                this.androidSet.add(key);
            }

            let msg = {
                command: 'ws_cache_connection',
                user_id: decoded.user_id,
                user_name: decoded.user_name,
                client_ip: decoded.client_ip,
                user_agent: decoded.user_agent,
                expiry: decoded.expiry,
                finger_print: decoded.finger_print,
                topic: decoded.topic
            };
            this.publishOnMQ(key, msg);

        }
        catch (error) {
            this.logger.error("Client failed auth: " + error + ":  Terminating");
            socket.terminate();
            this.errorOps++;
        }
    }

    publishOnMQ(userSignature, jsonMsg) {

        if (userSignature == null) {
            return;
        }

        // Lets add the actual user associated with this ws
        jsonMsg.user_signature = userSignature;
        jsonMsg.source = this.serverId;
        jsonMsg.host = host();


        let msg = this.messagePrefix + JSON.stringify(jsonMsg);
        this.producer.publish( msg );
    }

    sendToClient(key, message) {
        if (this.clientMap.get(key) != null) {
            //logger.info("Sending msg to " + key);
            this.clientMap.get(key).send(message);
            this.sentMessages++;
        }
    }
}

module.exports = SocketServer;