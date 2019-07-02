const Migrations = artifacts.require("LinkedList");

module.exports = function(deployer) {
  deployer.deploy(Migrations);
};
