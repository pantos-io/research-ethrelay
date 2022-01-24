const Web3 = require('web3');
const abiEthrelay = require('./build/contracts/Ethrelay.json').abi;
const web3 = new Web3(new Web3.providers.WebsocketProvider('http://127.0.0.1:7545'));

readEthrelayEvents(web3);

function readEthrelayEvents(web3) {
    const contractInstance = new web3.eth.Contract(abiEthrelay, process.argv[2],{});

    contractInstance.events.allEvents({
        fromBlock: 0
    }, function (error, event) {
        if (error) console.log(error);
        console.log("Date: ", new Date());
        console.log("Event: ", event.event);
        console.log("Return values:", event.returnValues);
        console.log("-----------------------------------------------------")
    });
}
