const Web3 = require('web3');
const abiTestimonium = require('./build/contracts/LinkedList.json').abi;
const web3 = new Web3(new Web3.providers.WebsocketProvider('http://localhost:7545'));
const account = web3.eth.accounts.wallet.add('0x1ab7e4534afb18687b9f68872e0f3d6c750628ed6c26b64ccb1aad01b785164d');

readTestimoniumEvents(web3);

function readTestimoniumEvents(web3) {
    const contractInstance = new web3.eth.Contract(abiTestimonium, "0xBcA729959391a8d64cF8d08C71b26f3d0e25E83F",{
    });

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
