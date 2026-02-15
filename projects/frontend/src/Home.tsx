import { useWallet } from '@txnlab/use-wallet-react'
import { useState, useEffect } from 'react'
import ConnectWallet from './components/ConnectWallet'
import EventsTab from './components/EventsTab'
import CreateEventTab from './components/CreateEventTab'
import SplitwiseTab from './components/SplitwiseTab'
import MarketsTab from './components/MarketsTab'
import CreateMarketTab from './components/CreateMarketTab'
import CreateGroupTab from './components/CreateGroupTab'
import ResolveMarketTab from './components/ResolveMarketTab'
import LaunchpadTab from './components/LaunchpadTab'
import CreateProjectTab from './components/CreateProjectTab'
import XpWindow from './components/XpWindow'
import { ellipseAddress } from './utils/ellipseAddress'

type Tab = 'events' | 'createEvent' | 'splitwise' | 'createGroup' | 'markets' | 'createMarket' | 'resolveMarket' | 'launchpad' | 'createProject'

const TAB_LABELS: Record<Tab, string> = {
  events: 'Events',
  createEvent: 'Create Event',
  splitwise: 'Splitwise',
  createGroup: 'Create Group',
  markets: 'Markets',
  createMarket: 'Create Market',
  resolveMarket: 'Resolve Market',
  launchpad: 'Launchpad',
  createProject: 'Launch Project',
}

// Tabs visible in the tab strip (createEvent/createMarket are navigated to, not shown in strip)
const VISIBLE_TABS: Tab[] = ['events', 'splitwise', 'markets', 'launchpad']

const Home = () => {
  const [openWalletModal, setOpenWalletModal] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('events')
  const { activeAddress } = useWallet()
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const toggleWalletModal = () => setOpenWalletModal(!openWalletModal)

  return (
    <div className="xp-desktop relative" style={{ paddingBottom: '36px' }}>
      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <XpWindow title={`Campus SuperApp - [${TAB_LABELS[activeTab]}]`}>
          {/* Tab Strip */}
          <div className="flex items-end gap-0 px-2 -mb-px" style={{ borderBottom: '1px solid #808080' }}>
            {VISIBLE_TABS.map((tab) => (
              <button
                key={tab}
                className={activeTab === tab ? 'xp-tab-active' : 'xp-tab-inactive'}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
            {/* Show Create Event tab only when active */}
            {activeTab === 'createEvent' && (
              <button className="xp-tab-active">
                {TAB_LABELS.createEvent}
              </button>
            )}
            {/* Show Create Group tab only when active */}
            {activeTab === 'createGroup' && (
              <button className="xp-tab-active">
                {TAB_LABELS.createGroup}
              </button>
            )}
            {/* Show Create Market tab only when active */}
            {activeTab === 'createMarket' && (
              <button className="xp-tab-active">
                {TAB_LABELS.createMarket}
              </button>
            )}
            {/* Show Resolve Market tab only when active */}
            {activeTab === 'resolveMarket' && (
              <button className="xp-tab-active">
                {TAB_LABELS.resolveMarket}
              </button>
            )}
            {/* Show Create Project tab only when active */}
            {activeTab === 'createProject' && (
              <button className="xp-tab-active">
                {TAB_LABELS.createProject}
              </button>
            )}
          </div>

          {/* Tab Content */}
          <div className="p-4" style={{ backgroundColor: '#ECE9D8', borderTop: '1px solid #808080' }}>
            {!activeAddress ? (
              <div className="text-center py-12">
                <h2 className="text-xl font-bold font-xp text-xp-title-blue mb-4">
                  Connect your wallet to get started
                </h2>
                <button className="xp-btn px-6 py-2" onClick={toggleWalletModal}>
                  Connect Wallet
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'events' && (
                  <EventsTab onNavigateToCreate={() => setActiveTab('createEvent')} />
                )}
                {activeTab === 'createEvent' && (
                  <CreateEventTab onBack={() => setActiveTab('events')} />
                )}
                {activeTab === 'splitwise' && (
                  <SplitwiseTab onNavigateToCreate={() => setActiveTab('createGroup')} />
                )}
                {activeTab === 'createGroup' && (
                  <CreateGroupTab onBack={() => setActiveTab('splitwise')} />
                )}
                {activeTab === 'markets' && (
                  <MarketsTab
                    onNavigateToCreate={() => setActiveTab('createMarket')}
                    onNavigateToResolve={() => setActiveTab('resolveMarket')}
                  />
                )}
                {activeTab === 'createMarket' && (
                  <CreateMarketTab onBack={() => setActiveTab('markets')} />
                )}
                {activeTab === 'resolveMarket' && (
                  <ResolveMarketTab onBack={() => setActiveTab('markets')} />
                )}
                {activeTab === 'launchpad' && (
                  <LaunchpadTab onNavigateToCreate={() => setActiveTab('createProject')} />
                )}
                {activeTab === 'createProject' && (
                  <CreateProjectTab onBack={() => setActiveTab('launchpad')} />
                )}
              </>
            )}
          </div>
        </XpWindow>
      </div>

      {/* XP Taskbar */}
      <div className="xp-taskbar">
        <button className="xp-start-btn">
          <span className="text-lg">&#127987;</span>
          start
        </button>

        {/* Taskbar Tab Items */}
        <div className="flex items-center gap-1 ml-2 flex-1 overflow-hidden">
          {VISIBLE_TABS.map((tab) => (
            <button
              key={tab}
              className={`xp-taskbar-item ${activeTab === tab ? 'xp-taskbar-item-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* System Tray */}
        <div className="xp-systray">
          {activeAddress && (
            <button
              className="hover:underline cursor-pointer"
              onClick={toggleWalletModal}
              title={activeAddress}
            >
              {ellipseAddress(activeAddress)}
            </button>
          )}
          {!activeAddress && (
            <button
              className="hover:underline cursor-pointer"
              onClick={toggleWalletModal}
            >
              Connect
            </button>
          )}
          <span className="border-l border-blue-400 pl-2">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      <ConnectWallet openModal={openWalletModal} closeModal={toggleWalletModal} />
    </div>
  )
}

export default Home
