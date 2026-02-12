import { useWallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import ConnectWallet from './components/ConnectWallet'
import EventsTab from './components/EventsTab'
import TreasuryTab from './components/TreasuryTab'
import SplitwiseTab from './components/SplitwiseTab'
import { ellipseAddress } from './utils/ellipseAddress'

type Tab = 'events' | 'treasury' | 'splitwise'

const Home = () => {
  const [openWalletModal, setOpenWalletModal] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('events')
  const { activeAddress } = useWallet()

  const toggleWalletModal = () => setOpenWalletModal(!openWalletModal)

  return (
    <div className="min-h-screen bg-gradient-to-tr from-teal-400 via-cyan-300 to-sky-400">
      {/* Header */}
      <header className="navbar bg-base-100/80 backdrop-blur-md shadow-md sticky top-0 z-20 px-4">
        <div className="flex-1">
          <span className="text-xl font-extrabold text-teal-700">Campus SuperApp</span>
        </div>
        <div className="flex-none gap-2">
          {activeAddress && (
            <span className="text-sm font-mono text-gray-600 hidden sm:inline">
              {ellipseAddress(activeAddress)}
            </span>
          )}
          <button
            data-test-id="connect-wallet"
            className="btn btn-accent btn-sm rounded-full"
            onClick={toggleWalletModal}
          >
            {activeAddress ? 'Wallet Connected' : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex justify-center pt-4 px-4">
        <div className="tabs tabs-boxed bg-base-100/80 backdrop-blur-md">
          <button
            className={`tab tab-lg ${activeTab === 'events' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Events
          </button>
          <button
            className={`tab tab-lg ${activeTab === 'treasury' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('treasury')}
          >
            Treasury
          </button>
          <button
            className={`tab tab-lg ${activeTab === 'splitwise' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('splitwise')}
          >
            Splitwise
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="backdrop-blur-md bg-white/70 rounded-2xl p-6 shadow-xl">
          {!activeAddress ? (
            <div className="text-center py-12">
              <h2 className="text-2xl font-bold text-gray-600 mb-4">Connect your wallet to get started</h2>
              <button className="btn btn-accent" onClick={toggleWalletModal}>Connect Wallet</button>
            </div>
          ) : (
            <>
              {activeTab === 'events' && <EventsTab />}
              {activeTab === 'treasury' && <TreasuryTab />}
              {activeTab === 'splitwise' && <SplitwiseTab />}
            </>
          )}
        </div>
      </main>

      <ConnectWallet openModal={openWalletModal} closeModal={toggleWalletModal} />
    </div>
  )
}

export default Home
