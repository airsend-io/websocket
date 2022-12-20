const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { createLogger, format, transports } = winston;

const logger = winston.createLogger({
    format: format.combine(
        format.timestamp(),
        format.printf(i => `${i.timestamp} | ${i.message}`)
    ),
    defaultMeta: { service: 'websocket' },
    transports: [
        //
        // - Write to all logs with level `info` and below to `combined.log`
        // - Write all logs error (and below) to `error.log`.
        //
        new winston.transports.Console({
            colorize: true,
        }),
        new (DailyRotateFile)({
            filename: 'logs/ws-error-%DATE%.log',
            datePattern: 'YYYY-MM-DD-HH',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
            level: 'error',
        }),
        new (DailyRotateFile)({
            filename: 'logs/ws-combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD-HH',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d',
        })
    ]
});




module.exports = logger;