import { useEffect, useMemo } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgodConfigFromViteEnvironment, getIndexerConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

export function useAlgorand() {
  const { activeAddress, transactionSigner } = useWallet()
  const algodConfig = getAlgodConfigFromViteEnvironment()
  const indexerConfig = getIndexerConfigFromViteEnvironment()

  const algorand = useMemo(
    () => AlgorandClient.fromConfig({ algodConfig, indexerConfig }),
    [algodConfig, indexerConfig],
  )

  useEffect(() => {
    algorand.setDefaultSigner(transactionSigner)
  }, [algorand, transactionSigner])

  return { algorand, activeAddress, transactionSigner, algodConfig, indexerConfig }
}
