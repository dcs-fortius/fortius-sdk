const { ethers } = require('ethers')
const Safe = require('@safe-global/protocol-kit').default
const { SafeFactory } = require('@safe-global/protocol-kit')
const FortiusSafeFactory = require('./abis/FortiusSafeFactory.json')

class FortiusFactory extends SafeFactory {
    static async create({
        ethAdapter,
        safeVersion = '1.3.0',
        isL1SafeSingleton = false,
        contractNetworks
    }) {
        this.factory = new ethers.Contract(FortiusSafeFactory.address, FortiusSafeFactory.abi, ethAdapter.getSigner())
        const safeFactorySdk = new FortiusFactory()
        await safeFactorySdk.init({ ethAdapter, safeVersion, isL1SafeSingleton, contractNetworks })
        return safeFactorySdk
    }

    async deploySafe({
        safeAccountConfig,
        options
    }) {
        const safeAddress = await this.factory.deploy(options.name, safeAccountConfig.owners, safeAccountConfig.threshold, 1, options.modules)
        return Safe.create({ ethAdapter: super.getEthAdapter(), safeAddress })
    }

    async getName(safeAddress) {
        return this.factory.name(safeAddress)
    }
}

module.exports = { FortiusFactory }