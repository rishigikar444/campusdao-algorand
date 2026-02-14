import XpWindow from './XpWindow'

interface LandingPageProps {
  onLaunch: () => void
}

const LandingPage = ({ onLaunch }: LandingPageProps) => {
  return (
    <div className="xp-desktop relative flex flex-col" style={{ height: '100vh' }}>
      {/* Desktop Icons */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <div className="xp-desktop-icon">
          <div className="text-3xl">&#128187;</div>
          <span>My Computer</span>
        </div>
        <div className="xp-desktop-icon">
          <div className="text-3xl">&#128193;</div>
          <span>My Documents</span>
        </div>
        <div className="xp-desktop-icon">
          <div className="text-3xl">&#128465;</div>
          <span>Recycle Bin</span>
        </div>
      </div>

      {/* Central Welcome Window */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingBottom: '36px' }}>
        <div className="pointer-events-auto w-full max-w-lg mx-4">
          <XpWindow title="Welcome to Campus SuperApp" showControls={false}>
            <div className="text-center py-6 px-4">
              <div className="text-5xl mb-4">&#127979;</div>
              <h1 className="text-2xl font-bold font-xp text-xp-title-blue mb-3">
                Campus SuperApp
              </h1>
              <p className="text-sm font-xp-body text-gray-700 mb-6 leading-relaxed">
                Your all-in-one campus toolkit powered by Algorand.<br />
                Manage events, treasury, and split expenses — all on-chain.
              </p>
              <button
                className="xp-btn px-8 py-2 text-base font-bold"
                onClick={onLaunch}
              >
                &#9654; Launch App
              </button>
            </div>
          </XpWindow>
        </div>
      </div>

      {/* Taskbar */}
      <div className="xp-taskbar">
        <button className="xp-start-btn">
          <span className="text-lg">&#127987;</span>
          start
        </button>
        <div className="flex-1" />
        <div className="xp-systray">
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
