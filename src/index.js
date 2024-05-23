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
        const safeFactorySdk = new FortiusFactory()
        await safeFactorySdk.init({ ethAdapter, safeVersion, isL1SafeSingleton, contractNetworks })
        safeFactorySdk.factory = new ethers.Contract(FortiusSafeFactory.address, FortiusSafeFactory.abi, ethAdapter.getSigner())
        return safeFactorySdk
    }

    async deploySafe({
        safeAccountConfig,
        fortiusOptions
    }) {
        const safeAddress = await this.factory.deploy(fortiusOptions.name, safeAccountConfig.owners, safeAccountConfig.threshold, fortiusOptions.nonce || 2, fortiusOptions.modules)
        return Safe.create({ safeAddress })
    }

    async getName(safeAddress) {
        return this.factory.name(safeAddress)
    }
}

module.exports = { FortiusFactory }