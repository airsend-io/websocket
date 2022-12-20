const config = require('config');
const logger = require('./logger');



function getHost() {
    let SERVER_HOST = config.get('deployment_host');

    if (SERVER_HOST == 'AWS_VPS') {
        const execSync = require('child_process').execSync;
        SERVER_HOST = execSync('curl --silent http://169.254.169.254/latest/meta-data/public-ipv4', {encoding: 'utf-8'});  // the default is 'buffer'
        //logger.info('AWS EXTERNAL IP IS :' + SERVER_HOST);

        let hostMap = new Map();
        let ipHostMapString = config.get('websocket_iphost_map');
        if (ipHostMapString != '') {
            let mapArr = ipHostMapString.split(',');
            mapArr.forEach(entry => {
                let aMapEntry = entry.split(':');
                hostMap.set(aMapEntry[0], aMapEntry[1]);
            });
        }

        if (hostMap.get(SERVER_HOST) != null) {
            SERVER_HOST = hostMap.get(SERVER_HOST);
        }
    }

    return SERVER_HOST;
}




module.exports = getHost;