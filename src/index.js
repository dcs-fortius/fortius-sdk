const { ethers } = require('ethers')
const Safe = require('@safe-global/protocol-kit').default
const { SafeFactory } = require('@safe-global/protocol-kit')
const FortiusSafeFactory = require('./abis/FortiusSafeFactory.json')

const ProxyCreation_TOPIC = "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235"

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
        const txResponse = await this.factory.deploy(
            fortiusOptions.name,
            safeAccountConfig.owners,
            safeAccountConfig.threshold,
            fortiusOptions.nonce || 2,
            fortiusOptions.modules
        )
        const txReceipt = await txResponse.wait()
        const events = txReceipt.logs || []
        for (let event of events) {
            if (event.topics[0] == ProxyCreation_TOPIC) {
                const safeAddress = (ethers.AbiCoder.defaultAbiCoder().decode(
                    ['address', 'address'],
                    event.data
                ))[0];
                return Safe.create({ ethAdapter: super.getEthAdapter(), safeAddress })
            }
        }
        throw new Error('SafeProxy was not deployed correctly')
    }

    async getName(safeAddress) {
        return this.factory.name(safeAddress)
    }
}

module.exports = { FortiusFactory }