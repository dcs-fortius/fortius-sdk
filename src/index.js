const Safe = require('@safe-global/protocol-kit').default
const { SafeFactory } = require('@safe-global/protocol-kit')
const FortiusSafeFactory = require('./abis/FortiusSafeFactory.json')

class FortiusSafeFactory extends SafeFactory {
    static async create({
        ethAdapter,
        safeVersion = '1.3.0',
        isL1SafeSingleton = false,
        contractNetworks
    }) {
        const safeFactorySdk = new FortiusSafeFactory()
        await safeFactorySdk.init({ ethAdapter, safeVersion, isL1SafeSingleton, contractNetworks })
        return safeFactorySdk
    }

    async deploySafe(ethAdapter, {
        safeAccountConfig,
        options
    }) {
        const factory = new ethers.Contract(FortiusSafeFactory.address, FortiusSafeFactory.abi, ethAdapter)
        const safeAddress = await factory.deploy(safeAccountConfig.owners, safeAccountConfig.threshold, 1, options.modules)
        return Safe.create({ ethAdapter, safeAddress })
    }
}

module.exports = { FortiusSafeFactory }