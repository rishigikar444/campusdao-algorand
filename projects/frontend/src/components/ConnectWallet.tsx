import { useWallet, Wallet, WalletId } from '@txnlab/use-wallet-react'
import Account from './Account'
import XpWindow from './XpWindow'

interface ConnectWalletInterface {
  openModal: boolean
  closeModal: () => void
}

const ConnectWallet = ({ openModal, closeModal }: ConnectWalletInterface) => {
  const { wallets, activeAddress } = useWallet()

  const isKmd = (wallet: Wallet) => wallet.id === WalletId.KMD

  if (!openModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md mx-4">
        <XpWindow title="Connect Wallet" onClose={closeModal}>
          <div className="flex flex-col gap-3">
            {activeAddress && (
              <>
                <Account />
                <hr className="border-gray-400" />
              </>
            )}

            {!activeAddress &&
              wallets?.map((wallet) => (
                <button
                  data-test-id={`${wallet.id}-connect`}
                  className="xp-btn flex items-center gap-2 py-2"
                  key={`provider-${wallet.id}`}
                  onClick={() => wallet.connect()}
                >
                  {!isKmd(wallet) && (
                    <img
                      alt={`wallet_icon_${wallet.id}`}
                      src={wallet.metadata.icon}
                      style={{ objectFit: 'contain', width: '24px', height: 'auto' }}
                    />
                  )}
                  <span>{isKmd(wallet) ? 'LocalNet Wallet' : wallet.metadata.name}</span>
                </button>
              ))}

            <div className="flex justify-end gap-2 mt-2 pt-2" style={{ borderTop: '1px solid #808080' }}>
              <button
                data-test-id="close-wallet-modal"
                className="xp-btn"
                onClick={closeModal}
              >
                Close
              </button>
              {activeAddress && (
                <button
                  className="xp-btn"
                  data-test-id="logout"
                  onClick={async () => {
                    if (wallets) {
                      const activeWallet = wallets.find((w) => w.isActive)
                      if (activeWallet) {
                        await activeWallet.disconnect()
                      } else {
                        localStorage.removeItem('@txnlab/use-wallet:v3')
                        window.location.reload()
                      }
                    }
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </XpWindow>
      </div>
    </div>
  )
}
export default ConnectWallet
